import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import {
  anularPagoPorCuentaTiendaAction,
  registrarPagoPorCuentaTiendaAction,
} from "@/lib/actions/pago-por-cuenta-tienda";
import { listarMovimientosAction } from "@/lib/actions/wallet";
import type { WalletMovimientoCategoria, WalletMovimientoDTO } from "@/lib/types/wallet";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import {
  acreditar459,
  conCandado459,
  formData459,
  limpiar459,
  sembrarPersonas459,
  type Personas459,
} from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 459 / T B.16 — el `documento` de las filas del libro, POR LAS ACTIONS, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El test de servicio (`wallet-service.test.ts`) mide con dobles QUÉ filas llevan documento y
// cuántas consultas cuesta. Lo que un doble no ve es el composition root (que `buildService()`
// de `lib/actions/wallet.ts` pase los lectores REALES) ni el `WHERE` de `estadoDeDocumentos`
// contra la base. Aquí se registra y se anula un pago por cuenta por sus actions y se lee el
// libro por `listarMovimientosAction`, sin inyectar servicio: solo el actor.
//
// El libro lo comparten otros archivos que corren a la vez, así que se filtra por categoría y
// se buscan las filas por el `origenId` del documento (nunca «las N primeras»).

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("459/T B.16 — el libro de la caja trae el documento de sus filas (Postgres real)", () => {
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

  const deps = (actor: Personas459["maestro"]) => ({ getActor: async () => actor });

  async function registrar(p: Personas459, beneficiario: string): Promise<string> {
    const r = await registrarPagoPorCuentaTiendaAction(
      formData459({
        claveIdempotencia: randomUUID(),
        tiendaId: p.tiendaId,
        beneficiario,
        monto: "1000.00",
        metodo: "efectivo",
        motivo: "Prueba del libro",
      }),
      deps(p.maestro),
    );
    if (r.status !== "ok") throw new Error(`registro: ${r.status}`);
    return r.pago.id;
  }

  async function filasDe(
    p: Personas459,
    categoria: WalletMovimientoCategoria,
  ): Promise<WalletMovimientoDTO[]> {
    const r = await listarMovimientosAction({ page: 1, pageSize: 100, categoria }, deps(p.maestro));
    if (r.status !== "ok") throw new Error(`listado: ${r.status}`);
    return r.data.movimientos;
  }

  it("R66/R67: el original vigente y el anulado llevan su documento; el contra-asiento no", async () => {
    await conPersonas(async (p) => {
      await acreditar459(prisma, p.tiendaId, "5000.00");
      const vigente = await registrar(p, "Facebook");
      const anulado = await registrar(p, "Jet Cargo");
      const anulacion = await anularPagoPorCuentaTiendaAction(
        { pagoId: anulado, motivo: "Registrado dos veces" },
        deps(p.maestro),
      );
      expect(anulacion.status).toBe("ok");

      const salidas = await filasDe(p, "egreso_pago_por_cuenta_tienda");
      const deVigente = salidas.filter((m) => m.origenId === vigente);
      const deAnulado = salidas.filter((m) => m.origenId === anulado);
      // Anti-vacuidad: las dos filas existen en el listado.
      expect(deVigente).toHaveLength(1);
      expect(deAnulado).toHaveLength(1);
      expect(deVigente[0].documento).toEqual({
        tipo: "pago_por_cuenta_tienda",
        anulado: false,
        tieneComprobante: false,
      });
      expect(deAnulado[0].documento).toEqual({
        tipo: "pago_por_cuenta_tienda",
        anulado: true,
        tieneComprobante: false,
      });

      const reversos = await filasDe(p, "ingreso_reverso_pago_por_cuenta_tienda");
      const contraAsiento = reversos.filter((m) => m.origenId === anulado);
      expect(contraAsiento).toHaveLength(1);
      expect(contraAsiento[0].documento).toBeNull();
    });
  }, 60000);
});
