import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { listarMovimientosAction } from "@/lib/actions/wallet";
import { anularCobroTiendaAction, registrarCobroTiendaAction } from "@/lib/actions/wallet-tienda";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";
import { acreditar459, conCandado459, limpiar459, sembrarPersonas459, type Personas459 } from "./_fixtures/escrituras-459";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 461 / T B.8 — EL COBRO Y SU ANULACION POR LAS SERVER ACTIONS, contra Postgres (COMMITEADO).
// (R1, R4, R7, R9, R10, R12, R13, R15, R17, R18, R20, R37, R55, R66, R68.)
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Se entra por `registrarCobroTiendaAction` / `anularCobroTiendaAction` SIN inyectar el servicio: lo
// construye el `buildCobroTiendaService()` real con `getPrismaClient()` —el composition root que la
// 381 dejo sin caja y que la 461 obliga a cablear (R9). Solo se inyecta el actor. Lo que se afirma se
// lee DE LA BASE y del libro de la caja por `listarMovimientosAction` (el `documento` de cada fila).
//
// Las cifras de la tarjeta (R4, R25, R26) se miden en `caja-invariante-tiendas.test.ts`, en REPEATABLE
// READ: aqui se commitea y el libro de la caja lo comparten otros archivos que corren a la vez.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

describeSiHayBase("461/T B.8 — cobrar y anular por las actions (Postgres real)", () => {
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

  const deps = (actor: Personas459["maestro"] | null) => ({ getActor: async () => actor });

  async function filaDelLibro(actor: Personas459["maestro"], id: string) {
    // El tope del borde es 100; las filas de este test son las mas recientes del libro (orden desc).
    const libro = await listarMovimientosAction({ page: 1, pageSize: 100 }, deps(actor));
    if (libro.status !== "ok") throw new Error(`libro: ${libro.status}`);
    return libro.data.movimientos.find((m) => m.id === id) ?? null;
  }

  it("R1/R7/R9/R20/R55: UNA action escribe el debito, el CARGO en la caja (mismo monto, mismo instante, con la tienda en la descripcion) y el historial; el libro ofrece el documento del cobro", async () => {
    await conPersonas(async (p) => {
      await acreditar459(prisma, p.tiendaId, "10000.00");
      const clave = randomUUID();
      const r = await registrarCobroTiendaAction(
        { claveIdempotencia: clave, tiendaId: p.tiendaId, monto: "2500.5", descripcion: "  Etiquetas de septiembre  " },
        deps(p.admin),
      );
      expect(r.status).toBe("ok");
      if (r.status !== "ok") throw new Error("imposible");
      expect(r.saldo.saldo).toBe("7499.50");
      expect(r.cobro).toMatchObject({ tipo: "debito", categoria: "cobro_manual", monto: "2500.50", descripcion: "Etiquetas de septiembre" });

      const debito = await prisma.walletTiendaMovimiento.findUniqueOrThrow({ where: { id: r.cobro.id } });
      expect(debito.claveIdempotencia).toBe(clave); // R66/R67
      expect(debito.registradoPor).toBe(p.admin.usuarioId);

      // R1/R2/R4: el cargo, con la liquidez «cargo» (no es efectivo), vinculado por (cobro_tienda, id).
      const cargos = await prisma.walletMovimiento.findMany({ where: { origenTipo: "cobro_tienda", origenId: r.cobro.id } });
      expect(cargos).toHaveLength(1);
      expect(cargos[0]).toMatchObject({ tipo: "ingreso", categoria: "ingreso_cobro_tienda", registradoPor: p.admin.usuarioId, claveIdempotencia: null });
      expect(cargos[0].monto.toFixed(2)).toBe("2500.50");
      expect(cargos[0].fechaMovimiento.getTime()).toBe(debito.fechaMovimiento.getTime()); // R3: el MISMO instante
      // R7: el nombre de la tienda y la descripcion, sin ningun id.
      expect(cargos[0].descripcion).toBe(`${p.tiendaNombre} · Etiquetas de septiembre`);
      expect(cargos[0].descripcion).not.toContain(r.cobro.id);

      // R55: el historial, con el nombre de la tienda y el importe.
      const historial = await prisma.historialAccion.findMany({ where: { entidadId: r.cobro.id } });
      expect(historial.map((h) => h.accion)).toEqual(["cobro_tienda_registrado"]);
      expect(historial[0].monto?.toFixed(2)).toBe("2500.50");

      // R20/R37: la linea del cobro en el libro lleva su documento; se puede anular.
      const fila = await filaDelLibro(p.maestro, cargos[0].id);
      expect(fila?.documento).toEqual({ tipo: "cobro_tienda", anulado: false, tieneComprobante: false });
      expect(fila?.dueno).toBe("propio");
    });
  }, 120_000);

  it("R68: el doble envio (misma clave) responde `ya_registrado` con el cobro ORIGINAL y no escribe nada mas", async () => {
    await conPersonas(async (p) => {
      const clave = randomUUID();
      const entrada = { claveIdempotencia: clave, tiendaId: p.tiendaId, monto: "100.00", descripcion: "Doble clic" };
      const primero = await registrarCobroTiendaAction(entrada, deps(p.maestro));
      const segundo = await registrarCobroTiendaAction(entrada, deps(p.maestro));
      if (primero.status !== "ok") throw new Error("primero");
      expect(segundo.status).toBe("ya_registrado");
      if (segundo.status !== "ya_registrado") throw new Error("imposible");
      expect(segundo.cobro.id).toBe(primero.cobro.id);
      expect(segundo.saldo.saldo).toBe("-100.00");
      expect(await prisma.walletTiendaMovimiento.count({ where: { tiendaId: p.tiendaId, categoria: "cobro_manual" } })).toBe(1);
      expect(await prisma.walletMovimiento.count({ where: { origenTipo: "cobro_tienda", origenId: primero.cobro.id } })).toBe(1);
      expect(await prisma.historialAccion.count({ where: { entidadId: primero.cobro.id } })).toBe(1);
    });
  }, 120_000);

  it("R10/R12/R13/R15/R37: anular deja constancia, credito a la tienda y reverso del cargo por el monto DEL COBRO, mismo instante, historial; el libro marca el cargo como anulado y el reverso sin documento; el segundo intento es `ya_anulado`", async () => {
    await conPersonas(async (p) => {
      await acreditar459(prisma, p.tiendaId, "10000.00");
      const r = await registrarCobroTiendaAction(
        { claveIdempotencia: randomUUID(), tiendaId: p.tiendaId, monto: "2500.50", descripcion: "Etiquetas" },
        deps(p.maestro),
      );
      if (r.status !== "ok") throw new Error("registro");
      const cobroId = r.cobro.id;
      const cargo = await prisma.walletMovimiento.findFirstOrThrow({ where: { origenTipo: "cobro_tienda", origenId: cobroId } });

      // R13: el monto no viaja; `.strict()` lo rechaza sin escribir nada.
      const conMonto = await anularCobroTiendaAction({ cobroId, motivo: "x", monto: "1.00" }, deps(p.maestro));
      expect(conMonto.status).toBe("validation_error");
      expect(await prisma.cobroTiendaAnulacion.count({ where: { cobroId } })).toBe(0);

      const a = await anularCobroTiendaAction({ cobroId, motivo: "  Cobro equivocado  " }, deps(p.admin));
      expect(a.status).toBe("ok");
      if (a.status !== "ok") throw new Error("imposible");
      expect(a.saldo.saldo).toBe("10000.00"); // el saldo vuelve al centimo

      const constancia = await prisma.cobroTiendaAnulacion.findUniqueOrThrow({ where: { cobroId } });
      expect(constancia).toMatchObject({ motivo: "Cobro equivocado", anuladoPor: p.admin.usuarioId });

      const credito = await prisma.walletTiendaMovimiento.findFirstOrThrow({ where: { origenTipo: "cobro_tienda", origenId: cobroId, categoria: "cobro_tienda_anulado" } });
      const reverso = await prisma.walletMovimiento.findFirstOrThrow({ where: { origenTipo: "cobro_tienda", origenId: cobroId, categoria: "egreso_reverso_cobro_tienda" } });
      expect(credito.tipo).toBe("credito");
      expect(credito.monto.toFixed(2)).toBe("2500.50");
      expect(reverso.tipo).toBe("egreso");
      expect(reverso.monto.toFixed(2)).toBe("2500.50");
      expect(reverso.fechaMovimiento.getTime()).toBe(credito.fechaMovimiento.getTime()); // R11: el MISMO instante
      expect(reverso.fechaMovimiento.getTime()).toBeGreaterThan(cargo.fechaMovimiento.getTime()); // el dia de la anulacion, no el del cobro
      expect(reverso.descripcion).toBe(`Anulación · ${p.tiendaNombre} · Etiquetas`);
      expect(credito.descripcion).toBe("Anulación · Etiquetas");

      const historial = await prisma.historialAccion.findMany({ where: { entidadId: cobroId }, orderBy: { createdAt: "asc" } });
      expect(historial.map((h) => h.accion)).toEqual(["cobro_tienda_registrado", "cobro_tienda_anulado"]);
      expect(historial[1].entidadEtiqueta).toContain(p.tiendaNombre.split(" ")[0]);
      expect(historial[1].entidadEtiqueta).not.toContain("Cobro equivocado"); // el motivo NUNCA va al historial

      expect((await filaDelLibro(p.maestro, cargo.id))?.documento).toEqual({ tipo: "cobro_tienda", anulado: true, tieneComprobante: false });
      expect((await filaDelLibro(p.maestro, reverso.id))?.documento).toBeNull();

      // R15: la segunda vez, `ya_anulado` y ni una fila mas.
      const otra = await anularCobroTiendaAction({ cobroId, motivo: "Otra vez" }, deps(p.maestro));
      expect(otra).toEqual({ status: "ya_anulado" });
      expect(await prisma.cobroTiendaAnulacion.count({ where: { cobroId } })).toBe(1);
      expect(await prisma.walletMovimiento.count({ where: { origenTipo: "cobro_tienda", origenId: cobroId } })).toBe(2);
      expect(await prisma.walletTiendaMovimiento.count({ where: { origenTipo: "cobro_tienda", origenId: cobroId } })).toBe(1);
    });
  }, 120_000);

  it("R16/R17/R18: un cobro legado SIN linea de caja es `no_anulable` (sin_linea_de_caja); un id que no es cobro, `no_encontrado`; adminTienda, `forbidden`; sin sesion, `unauthenticated` — y nada se escribe", async () => {
    await conPersonas(async (p) => {
      const legado = await prisma.walletTiendaMovimiento.create({
        data: { tiendaId: p.tiendaId, tipo: "debito", categoria: "cobro_manual", monto: new Prisma.Decimal("700.00"), origenTipo: "manual", origenId: null, descripcion: "Legado 381", registradoPor: p.maestro.usuarioId },
        select: { id: true },
      });
      const credito = await prisma.walletTiendaMovimiento.create({
        data: { tiendaId: p.tiendaId, tipo: "credito", categoria: "cod_recaudado", monto: new Prisma.Decimal("1.00"), origenTipo: "manual", origenId: null },
        select: { id: true },
      });
      expect(await anularCobroTiendaAction({ cobroId: legado.id, motivo: "x" }, deps(p.maestro))).toEqual({ status: "no_anulable", motivo: "sin_linea_de_caja" });
      expect(await anularCobroTiendaAction({ cobroId: credito.id, motivo: "x" }, deps(p.maestro))).toEqual({ status: "no_encontrado" });
      expect(await anularCobroTiendaAction({ cobroId: randomUUID(), motivo: "x" }, deps(p.maestro))).toEqual({ status: "no_encontrado" });
      expect(await anularCobroTiendaAction({ cobroId: legado.id, motivo: "x" }, deps({ usuarioId: p.tiendaId, rol: "adminTienda" }))).toEqual({ status: "forbidden" });
      expect(await anularCobroTiendaAction({ cobroId: legado.id, motivo: "x" }, deps(null))).toEqual({ status: "unauthenticated" });
      expect(await registrarCobroTiendaAction({ claveIdempotencia: randomUUID(), tiendaId: p.tiendaId, monto: "1.00", descripcion: "x" }, deps({ usuarioId: p.tiendaId, rol: "adminTienda" }))).toEqual({ status: "forbidden" });
      expect(await prisma.cobroTiendaAnulacion.count({ where: { cobroId: legado.id } })).toBe(0);
      expect(await prisma.walletMovimiento.count({ where: { origenId: legado.id } })).toBe(0);
      expect(await prisma.walletTiendaMovimiento.count({ where: { tiendaId: p.tiendaId } })).toBe(2);
    });
  }, 120_000);
});
