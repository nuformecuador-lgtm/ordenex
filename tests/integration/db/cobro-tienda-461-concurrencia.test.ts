import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { anularCobroTiendaAction, registrarCobroTiendaAction } from "@/lib/actions/wallet-tienda";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { acreditar459, conCandado459, limpiar459, sembrarPersonas459, type Personas459 } from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 461 / T B.8 — CONCURRENCIA del cobro (R15, R68), contra Postgres, con filas COMMITEADAS.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Dos peticiones A LA VEZ por la action real (dos transacciones distintas del composition root):
//   · dos registros con la MISMA clave → `ok` + `ya_registrado`; un debito, un cargo, un historial.
//     La barrera es el indice UNIQUE de la clave: la transaccion perdedora sale ANTES del historial y
//     de la linea de caja (R68).
//   · dos anulaciones del mismo cobro → `ok` + `ya_anulado`; una constancia, un credito, un reverso.
//     La barrera es el `UNIQUE(cobro_id)` (R15): la perdedora se revierte entera.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("461/T B.8 — concurrencia del cobro a una tienda (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function conPersonas(cuerpo: (p: Personas459) => Promise<void>): Promise<void> {
    await conCandado459(prisma, async () => {
      let p: Personas459 | null = null;
      try {
        p = await sembrarPersonas459(prisma);
        await cuerpo(p);
      } finally {
        await limpiar459(prisma, p);
      }
    });
  }

  it("R68: dos registros SIMULTANEOS con la misma clave -> `ok` + `ya_registrado`; un debito, un cargo, un historial", async () => {
    await conPersonas(async (p) => {
      const deps = { getActor: async () => p.maestro };
      const entrada = { claveIdempotencia: randomUUID(), tiendaId: p.tiendaId, monto: "1500.00", descripcion: "Carrera" };
      const respuestas = await Promise.all([
        registrarCobroTiendaAction(entrada, deps),
        registrarCobroTiendaAction(entrada, deps),
      ]);
      expect(respuestas.map((r) => r.status).sort()).toEqual(["ok", "ya_registrado"]);
      const ids = new Set(respuestas.map((r) => (r.status === "ok" || r.status === "ya_registrado" ? r.cobro.id : "?")));
      expect(ids.size).toBe(1);
      const [cobroId] = [...ids];
      expect(await prisma.walletTiendaMovimiento.count({ where: { tiendaId: p.tiendaId, categoria: "cobro_manual" } })).toBe(1);
      expect(await prisma.walletMovimiento.count({ where: { origenTipo: "cobro_tienda", origenId: cobroId } })).toBe(1);
      expect(await prisma.historialAccion.count({ where: { entidadId: cobroId } })).toBe(1);
    });
  }, 120_000);

  it("R15: dos anulaciones SIMULTANEAS del mismo cobro -> `ok` + `ya_anulado`; una constancia, un credito, un reverso, un historial", async () => {
    await conPersonas(async (p) => {
      await acreditar459(prisma, p.tiendaId, "5000.00");
      const deps = { getActor: async () => p.maestro };
      const r = await registrarCobroTiendaAction(
        { claveIdempotencia: randomUUID(), tiendaId: p.tiendaId, monto: "2500.50", descripcion: "Etiquetas" },
        deps,
      );
      if (r.status !== "ok") throw new Error(`registro: ${JSON.stringify(r)}`);
      const cobroId = r.cobro.id;
      const respuestas = await Promise.all([
        anularCobroTiendaAction({ cobroId, motivo: "uno" }, deps),
        anularCobroTiendaAction({ cobroId, motivo: "dos" }, deps),
      ]);
      expect(respuestas.map((x) => x.status).sort()).toEqual(["ok", "ya_anulado"]);
      expect(await prisma.cobroTiendaAnulacion.count({ where: { cobroId } })).toBe(1);
      expect(
        (await prisma.walletTiendaMovimiento.findMany({ where: { origenTipo: "cobro_tienda", origenId: cobroId } })).map((m) => m.categoria),
      ).toEqual(["cobro_tienda_anulado"]);
      expect(
        (await prisma.walletMovimiento.findMany({ where: { origenTipo: "cobro_tienda", origenId: cobroId } })).map((m) => m.categoria).sort(),
      ).toEqual(["egreso_reverso_cobro_tienda", "ingreso_cobro_tienda"]);
      expect(await prisma.historialAccion.count({ where: { entidadId: cobroId, accion: "cobro_tienda_anulado" } })).toBe(1);
      // El saldo de la tienda vuelve al centimo: 5 000 − 2 500,50 + 2 500,50.
      const ok = respuestas.find((x) => x.status === "ok");
      if (ok?.status === "ok") expect(ok.saldo.saldo).toBe("5000.00");
    });
  }, 120_000);
});
