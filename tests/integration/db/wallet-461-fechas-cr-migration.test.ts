import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales, type TxDeTest } from "./_postgres-real";
import { DOWN_FECHAS_CR_461, DOWN_FECHAS_CR_461_EN_TX, UP_FECHAS_CR_461 } from "./_fixtures/fechas-cr-461-sql";
import { soloEjecutable } from "./_fixtures/sql-ejecutable";
import { sembrarPersonas461, type Personas461 } from "./_fixtures/personas-461";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 461 / R74 (auditoria de la wallet, T2) — LA MIGRACION DE DATOS de las fechas, con su SQL REAL.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Se siembran, en los tres libros, filas como las que dejo la 172 (origen `pago_tienda` /
// `pago_mensajero` a medianoche UTC exacta) y CONTROLES que la migracion NO debe tocar: un manual con
// fecha elegida (06:00Z), un asiento del cierre a medianoche exacta (otro origen), un cobro legado a
// medianoche exacta (origen `manual`) y un pago a tienda a las 00:00:00.001Z (no es medianoche exacta).
// Luego se ejecuta el `migration.sql` TAL CUAL, dos veces, y su `down`.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const MEDIANOCHE = new Date("2026-09-10T00:00:00.000Z");
const SEIS = new Date("2026-09-10T06:00:00.000Z");
const CASI = new Date("2026-09-10T00:00:00.001Z");

interface Ids {
  caja: { egreso: string; reverso: string; manual06: string; cierre00: string; casi: string };
  tienda: { debito: string; credito: string; legado00: string };
  mensajero: { liquidacion: string; ajuste: string };
}

async function fechasDe(tx: TxDeTest, ids: Ids): Promise<Record<string, string>> {
  const caja = await tx.walletMovimiento.findMany({ where: { id: { in: Object.values(ids.caja) } }, select: { id: true, fechaMovimiento: true } });
  const tienda = await tx.walletTiendaMovimiento.findMany({ where: { id: { in: Object.values(ids.tienda) } }, select: { id: true, fechaMovimiento: true } });
  const mensajero = await tx.pagoMensajeroMovimiento.findMany({ where: { id: { in: Object.values(ids.mensajero) } }, select: { id: true, fechaMovimiento: true } });
  const porId = new Map([...caja, ...tienda, ...mensajero].map((f) => [f.id, f.fechaMovimiento.toISOString()]));
  const salida: Record<string, string> = {};
  for (const [libro, grupo] of Object.entries(ids)) {
    for (const [nombre, id] of Object.entries(grupo as Record<string, string>)) salida[`${libro}.${nombre}`] = porId.get(id) ?? "FALTA";
  }
  return salida;
}

describeSiHayBase("461/R74 — la migracion de datos de las fechas CR, contra Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function sembrar(tx: TxDeTest, p: Personas461): Promise<Ids> {
    const pagoId = randomUUID();
    const pagoMensajeroId = randomUUID();
    const ids: Ids = {
      caja: { egreso: randomUUID(), reverso: randomUUID(), manual06: randomUUID(), cierre00: randomUUID(), casi: randomUUID() },
      tienda: { debito: randomUUID(), credito: randomUUID(), legado00: randomUUID() },
      mensajero: { liquidacion: randomUUID(), ajuste: randomUUID() },
    };
    const m = (n: string) => new Prisma.Decimal(n);
    await tx.walletMovimiento.createMany({
      data: [
        { id: ids.caja.egreso, tipo: "egreso", categoria: "egreso_pago_tienda", monto: m("15000.50"), origenTipo: "pago_tienda", origenId: pagoId, registradoPor: p.maestro.usuarioId, fechaMovimiento: MEDIANOCHE },
        { id: ids.caja.reverso, tipo: "ingreso", categoria: "ingreso_reverso_pago_tienda", monto: m("15000.50"), origenTipo: "pago_tienda", origenId: pagoId, registradoPor: p.maestro.usuarioId, fechaMovimiento: MEDIANOCHE },
        { id: ids.caja.manual06, tipo: "egreso", categoria: "egreso_ajuste", monto: m("1.00"), origenTipo: "manual", origenId: null, registradoPor: p.maestro.usuarioId, fechaMovimiento: SEIS },
        { id: ids.caja.cierre00, tipo: "ingreso", categoria: "ingreso_flete", monto: m("2.00"), origenTipo: "cierre_dia", origenId: randomUUID(), fechaMovimiento: MEDIANOCHE },
        { id: ids.caja.casi, tipo: "egreso", categoria: "egreso_pago_tienda", monto: m("3.00"), origenTipo: "pago_tienda", origenId: randomUUID(), fechaMovimiento: CASI },
      ],
    });
    await tx.walletTiendaMovimiento.createMany({
      data: [
        { id: ids.tienda.debito, tiendaId: p.tiendaId, tipo: "debito", categoria: "pago_tienda", monto: m("15000.50"), origenTipo: "pago_tienda", origenId: pagoId, fechaMovimiento: MEDIANOCHE },
        { id: ids.tienda.credito, tiendaId: p.tiendaId, tipo: "credito", categoria: "ajuste_credito", monto: m("15000.50"), origenTipo: "pago_tienda", origenId: pagoId, fechaMovimiento: MEDIANOCHE },
        { id: ids.tienda.legado00, tiendaId: p.tiendaId, tipo: "debito", categoria: "cobro_manual", monto: m("4.00"), origenTipo: "manual", origenId: null, registradoPor: p.maestro.usuarioId, fechaMovimiento: MEDIANOCHE },
      ],
    });
    await tx.pagoMensajeroMovimiento.createMany({
      data: [
        { id: ids.mensajero.liquidacion, mensajeroId: p.mensajeroId, tipo: "pago", categoria: "liquidacion", monto: m("1000.00"), origenTipo: "pago_mensajero", origenId: pagoMensajeroId, fechaMovimiento: MEDIANOCHE },
        { id: ids.mensajero.ajuste, mensajeroId: p.mensajeroId, tipo: "devengo", categoria: "ajuste_devengo", monto: m("1000.00"), origenTipo: "pago_mensajero", origenId: pagoMensajeroId, fechaMovimiento: MEDIANOCHE },
      ],
    });
    return ids;
  }

  it("el SQL que se ejecuta es el REAL: tres UPDATE de +6 h, acotados por origen y por medianoche exacta; el down, los tres de −6 h", () => {
    expect(UP_FECHAS_CR_461.match(/UPDATE "(wallet_movimiento|wallet_tienda_movimiento|pago_mensajero_movimiento)"/g)).toHaveLength(3);
    expect(UP_FECHAS_CR_461.match(/\+ interval '6 hours'/g)).toHaveLength(3);
    expect(UP_FECHAS_CR_461.match(/"origen_tipo"::text IN \('pago_tienda', 'pago_mensajero'\)/g)).toHaveLength(3);
    expect(UP_FECHAS_CR_461.match(/"fecha_movimiento" = date_trunc\('day', "fecha_movimiento"\);/g)).toHaveLength(3);
    // Sobre las SENTENCIAS (la prosa del archivo nombra a proposito lo que no hace).
    expect(soloEjecutable(UP_FECHAS_CR_461)).not.toMatch(/DELETE|INSERT|monto|categoria/);
    expect(DOWN_FECHAS_CR_461.match(/- interval '6 hours'/g)).toHaveLength(3);
    expect(DOWN_FECHAS_CR_461.match(/date_trunc\('day', "fecha_movimiento"\) \+ interval '6 hours'/g)).toHaveLength(3);
  });

  it("mueve +6 h SOLO los asientos de pago a medianoche exacta, en los tres libros; los controles no se tocan; dos pasadas dejan lo mismo; el down los devuelve", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const ids = await sembrar(tx, p);
      const antes = await fechasDe(tx, ids);
      const montosAntes = await tx.walletMovimiento.findMany({ where: { id: { in: Object.values(ids.caja) } }, select: { id: true, monto: true, categoria: true, origenTipo: true, createdAt: true }, orderBy: { id: "asc" } });

      await tx.$executeRawUnsafe(UP_FECHAS_CR_461);
      const tras1 = await fechasDe(tx, ids);
      await tx.$executeRawUnsafe(UP_FECHAS_CR_461);
      const tras2 = await fechasDe(tx, ids);
      const montosDespues = await tx.walletMovimiento.findMany({ where: { id: { in: Object.values(ids.caja) } }, select: { id: true, monto: true, categoria: true, origenTipo: true, createdAt: true }, orderBy: { id: "asc" } });

      await tx.$executeRawUnsafe(DOWN_FECHAS_CR_461_EN_TX);
      const trasDown = await fechasDe(tx, ids);
      return { antes, tras1, tras2, trasDown, montosAntes, montosDespues };
    });

    const M = MEDIANOCHE.toISOString();
    const S = SEIS.toISOString();
    const C = CASI.toISOString();
    expect(m.antes).toEqual({
      "caja.egreso": M, "caja.reverso": M, "caja.manual06": S, "caja.cierre00": M, "caja.casi": C,
      "tienda.debito": M, "tienda.credito": M, "tienda.legado00": M,
      "mensajero.liquidacion": M, "mensajero.ajuste": M,
    });
    // Los seis asientos de pago, +6 h; los cuatro controles, intactos.
    expect(m.tras1).toEqual({
      "caja.egreso": S, "caja.reverso": S, "caja.manual06": S, "caja.cierre00": M, "caja.casi": C,
      "tienda.debito": S, "tienda.credito": S, "tienda.legado00": M,
      "mensajero.liquidacion": S, "mensajero.ajuste": S,
    });
    // Idempotente: la segunda pasada no mueve nada (ya no hay medianoches exactas en el conjunto).
    expect(m.tras2).toEqual(m.tras1);
    // Ningun monto, categoria, origen ni `created_at` cambia.
    expect(m.montosDespues.map((f) => ({ ...f, monto: f.monto.toFixed(2) }))).toEqual(
      m.montosAntes.map((f) => ({ ...f, monto: f.monto.toFixed(2) })),
    );
    // El down devuelve los seis y deja los controles como estaban (incluido el manual a las 06:00Z:
    // su origen no es de pago).
    expect(m.trasDown).toEqual(m.antes);
  });
});
