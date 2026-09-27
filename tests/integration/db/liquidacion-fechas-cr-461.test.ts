import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { FinanzasDiarioRepository } from "@/lib/repositories/FinanzasDiarioRepository";
import { fechaCalendarioCR, inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";
import type { AgregadoDiarioCajaRow } from "@/lib/interfaces/repositories/IFinanzasDiarioRepository";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales, type TxDeTest } from "./_postgres-real";
import { cargarCatalogo459, enTransaccionRevertida459, montarServicios459, sembrarEscenario459 } from "./_fixtures/caja-459";
import { CLAVE_CANDADO_459 } from "./_fixtures/escrituras-459";
import { sembrarPersonas461 } from "./_fixtures/personas-461";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 461 / R73 (auditoria de la wallet, T2) — LA FECHA DE LOS ASIENTOS DE LOS PAGOS, contra Postgres.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// La auditoria midio: un pago a tienda del 25/09 con sus asientos a las 00:00Z caia en el rollup diario
// (`(fecha_movimiento − 6 h)::date`) el 24/09, mientras el libro lo pintaba el 25. Aqui, con el
// `LiquidacionService` REAL sobre la base real:
//   · el DOCUMENTO (`liquidacion_pago.fecha_pago`, `@db.Date`) sigue siendo la fecha calendario (00:00Z);
//   · los ASIENTOS (debito de la tienda, egreso de la caja) van al INICIO de ese dia en CR (06:00Z);
//   · la anulacion fecha sus contra-asientos al inicio del dia CR de HOY;
//   · y el rollup diario REAL (`FinanzasDiarioRepository`) los cuenta el dia del documento, no el anterior.
// Y sobre el ESCENARIO completo de la fase 0 (pagos y reparto a mensajero incluidos): ni un asiento de
// origen `pago_tienda`/`pago_mensajero` queda a medianoche UTC.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const DIA = "2026-09-10";

function totalDelDia(filas: readonly AgregadoDiarioCajaRow[], fecha: string, categoria: string): string {
  return filas
    .filter((f) => f.fecha === fecha && f.categoria === categoria)
    .reduce((acc, f) => acc.add(new Prisma.Decimal(f.total)), new Prisma.Decimal(0))
    .toFixed(2);
}

describeSiHayBase("461/R73 — los asientos de los pagos, al inicio del dia en Costa Rica (Postgres real)", () => {
  let prisma: PrismaClient;
  let cat: Awaited<ReturnType<typeof cargarCatalogo459>>;

  beforeAll(async () => {
    prisma = crearPrismaDeTest();
    cat = await cargarCatalogo459(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("pago a una tienda: documento a 00:00Z, asientos a 06:00Z, y el rollup lo cuenta el dia del documento", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx: TxDeTest) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      await tx.walletTiendaMovimiento.create({
        data: { tiendaId: p.tiendaId, tipo: "credito", categoria: "cod_recaudado", monto: new Prisma.Decimal("50000.00"), origenTipo: "manual", origenId: null, descripcion: "semilla 461" },
      });
      const s = montarServicios459(tx);
      const rollup = new FinanzasDiarioRepository(tx as unknown as PrismaClient);
      const ventana = [inicioDelDiaCREnUtc("2026-09-09"), inicioDelDiaSiguienteCREnUtc(DIA)] as const;
      const antes = await rollup.sumarPorDia(ventana[0], ventana[1]);

      const r = await s.liquidacion.registrarPagoTienda(
        { claveIdempotencia: randomUUID(), tiendaId: p.tiendaId, monto: "1234.56", metodo: "efectivo", fechaPago: DIA },
        p.maestro,
      );
      if (r.status !== "ok") throw new Error(`pago: ${JSON.stringify(r)}`);
      const doc = await tx.liquidacionPago.findUniqueOrThrow({ where: { id: r.pago.id } });
      const debito = await tx.walletTiendaMovimiento.findFirstOrThrow({ where: { origenTipo: "pago_tienda", origenId: r.pago.id, categoria: "pago_tienda" } });
      const egreso = await tx.walletMovimiento.findFirstOrThrow({ where: { origenTipo: "pago_tienda", origenId: r.pago.id, categoria: "egreso_pago_tienda" } });
      const despues = await rollup.sumarPorDia(ventana[0], ventana[1]);

      const a = await s.liquidacion.anularPago({ pagoId: r.pago.id, motivo: "Cuenta equivocada" }, p.maestro);
      if (a.status !== "ok") throw new Error(`anulacion: ${JSON.stringify(a)}`);
      const credito = await tx.walletTiendaMovimiento.findFirstOrThrow({ where: { origenTipo: "pago_tienda", origenId: r.pago.id, categoria: "ajuste_credito" } });
      const reverso = await tx.walletMovimiento.findFirstOrThrow({ where: { origenTipo: "pago_tienda", origenId: r.pago.id, categoria: "ingreso_reverso_pago_tienda" } });
      return {
        fechaPago: doc.fechaPago.toISOString(),
        debito: debito.fechaMovimiento.toISOString(),
        egreso: egreso.fechaMovimiento.toISOString(),
        credito: credito.fechaMovimiento.toISOString(),
        reverso: reverso.fechaMovimiento.toISOString(),
        rollupDia: new Prisma.Decimal(totalDelDia(despues, DIA, "egreso_pago_tienda")).sub(totalDelDia(antes, DIA, "egreso_pago_tienda")).toFixed(2),
        rollupVispera: new Prisma.Decimal(totalDelDia(despues, "2026-09-09", "egreso_pago_tienda")).sub(totalDelDia(antes, "2026-09-09", "egreso_pago_tienda")).toFixed(2),
      };
    });
    // El documento es una FECHA: medianoche UTC, como toda columna `@db.Date` del repo.
    expect(m.fechaPago).toBe("2026-09-10T00:00:00.000Z");
    // Los asientos: el inicio de ese dia en Costa Rica. Con 00:00Z el rollup los contaba el 9.
    expect(m.debito).toBe("2026-09-10T06:00:00.000Z");
    expect(m.egreso).toBe("2026-09-10T06:00:00.000Z");
    // Los contra-asientos: el inicio del dia CR de HOY (el reloj real de la corrida).
    const hoy = inicioDelDiaCREnUtc(fechaCalendarioCR(new Date())).toISOString();
    expect(m.credito).toBe(hoy);
    expect(m.reverso).toBe(hoy);
    // El rollup diario REAL: el pago cuenta el 10 (su documento) y NO el 9.
    expect(m.rollupDia).toBe("1234.56");
    expect(m.rollupVispera).toBe("0.00");
  });

  it("escenario entero (pagos, reparto y anulaciones a tienda y a mensajero): ningun asiento de origen pago_tienda/pago_mensajero queda a medianoche UTC; todos al inicio del dia CR de su documento", async () => {
    const m = await enTransaccionRevertida459(prisma, async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${CLAVE_CANDADO_459})`);
      const esc = await sembrarEscenario459(tx, cat);
      const hoy = fechaCalendarioCR(new Date());
      const inicioHoy = inicioDelDiaCREnUtc(hoy).toISOString();
      const documentos = await tx.liquidacionPago.findMany({
        where: { OR: [{ tiendaId: { in: [esc.tiendaA, esc.tiendaB] } }, { mensajeroId: esc.mensajeroId }] },
        select: { id: true, fechaPago: true },
      });
      const ids = documentos.map((d) => d.id);
      const caja = await tx.walletMovimiento.findMany({ where: { origenTipo: "pago_tienda", origenId: { in: ids } }, select: { fechaMovimiento: true, categoria: true } });
      const tienda = await tx.walletTiendaMovimiento.findMany({ where: { origenTipo: "pago_tienda", origenId: { in: ids } }, select: { fechaMovimiento: true, categoria: true } });
      const mensajero = await tx.pagoMensajeroMovimiento.findMany({ where: { origenTipo: "pago_mensajero", origenId: { in: ids } }, select: { fechaMovimiento: true, categoria: true } });
      const instantes = (xs: { fechaMovimiento: Date }[]) => [...new Set(xs.map((x) => x.fechaMovimiento.toISOString()))];
      return {
        documentos: documentos.length,
        fechasDoc: [...new Set(documentos.map((d) => d.fechaPago.toISOString()))],
        caja: caja.length,
        tienda: tienda.length,
        mensajero: mensajero.length,
        instantes: { caja: instantes(caja), tienda: instantes(tienda), mensajero: instantes(mensajero) },
        esperado: inicioHoy,
        docEsperado: `${hoy}T00:00:00.000Z`,
      };
    });
    // Anti-vacuidad: el escenario paga a tienda (2 pagos, 1 anulado), reparte y paga al mensajero.
    expect(m.documentos).toBeGreaterThanOrEqual(4);
    expect(m.caja).toBeGreaterThanOrEqual(3); // 2 egresos + 1 reverso
    expect(m.tienda).toBeGreaterThanOrEqual(3); // 2 debitos + 1 credito
    expect(m.mensajero).toBeGreaterThanOrEqual(3); // reparto + pago + anulacion
    // Los documentos, a medianoche UTC (fecha calendario); TODOS los asientos, al inicio del dia CR.
    expect(m.fechasDoc).toEqual([m.docEsperado]);
    expect(m.instantes.caja).toEqual([m.esperado]);
    expect(m.instantes.tienda).toEqual([m.esperado]);
    expect(m.instantes.mensajero).toEqual([m.esperado]);
  }, 300_000);
});
