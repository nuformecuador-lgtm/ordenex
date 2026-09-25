import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { listarMovimientosSchema } from "@/lib/types/wallet";
import { listarPagosDeMensajeroSchema } from "@/lib/types/wallet-mensajero";
import { listarMovimientosTiendaSchema } from "@/lib/types/wallet-tienda";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales, type TxDeTest } from "./_postgres-real";
import { sembrarPersonas461, type Personas461 } from "./_fixtures/personas-461";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 461 / R72 (auditoria de la wallet, T1) — EL FILTRO POR DIA, contra Postgres, en los tres libros.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// El borde traduce `YYYY-MM-DD` a dias de Costa Rica (test unitario `filtro-dias-cr`); aqui se mide lo
// que importa: que el `WHERE` de cada repositorio, con esos instantes, devuelve EXACTAMENTE las filas
// del dia elegido. Se siembran, en los tres libros, filas en los bordes que la auditoria vio fallar:
//
//   D-1 23:00 CR (05:00Z de D)   → NO es de D (antes, con la medianoche UTC, entraba)
//   D   00:00 CR (06:00Z de D)   → SI es de D (el primer instante del dia)
//   D   08:00 CR (14:00Z de D)   → SI
//   D   22:00 CR (04:00Z de D+1) → SI (antes, con `hasta` a medianoche UTC, quedaba fuera)
//   D+1 00:00 CR (06:00Z de D+1) → NO es de D (cota EXCLUSIVA; con `lte` entraria)
//
// Los filtros salen de los schemas REALES (`listarMovimientos*Schema.parse`), no de fechas escritas a
// mano: es el mismo camino que recorre la Server Action. Todo en una transaccion que se revierte.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const D = "2026-09-10";
const INSTANTES = {
  vispera2300: new Date("2026-09-10T05:00:00.000Z"),
  inicio: new Date("2026-09-10T06:00:00.000Z"),
  manana0800: new Date("2026-09-10T14:00:00.000Z"),
  noche2200: new Date("2026-09-11T04:00:00.000Z"),
  siguiente0000: new Date("2026-09-11T06:00:00.000Z"),
} as const;
const DEL_DIA = ["inicio", "manana0800", "noche2200"] as const;
const FUERA = ["vispera2300", "siguiente0000"] as const;

type Clave = keyof typeof INSTANTES;

describeSiHayBase("461/R72 — el filtro por dia de Costa Rica en los tres libros (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function conFilas<T>(cuerpo: (tx: TxDeTest, p: Personas461, ids: Record<"caja" | "tienda" | "mensajero", Record<Clave, string>>) => Promise<T>): Promise<T> {
    return enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const ids = { caja: {} as Record<Clave, string>, tienda: {} as Record<Clave, string>, mensajero: {} as Record<Clave, string> };
      for (const [clave, instante] of Object.entries(INSTANTES) as [Clave, Date][]) {
        const [c, t, m] = [randomUUID(), randomUUID(), randomUUID()];
        await tx.walletMovimiento.create({
          data: { id: c, tipo: "ingreso", categoria: "ingreso_ajuste", monto: new Prisma.Decimal("1.00"), origenTipo: "manual", origenId: null, descripcion: `461 ${clave}`, registradoPor: p.maestro.usuarioId, fechaMovimiento: instante },
        });
        await tx.walletTiendaMovimiento.create({
          data: { id: t, tiendaId: p.tiendaId, tipo: "credito", categoria: "cod_recaudado", monto: new Prisma.Decimal("1.00"), origenTipo: "manual", origenId: null, descripcion: `461 ${clave}`, fechaMovimiento: instante },
        });
        await tx.pagoMensajeroMovimiento.create({
          data: { id: m, mensajeroId: p.mensajeroId, tipo: "devengo", categoria: "pago_devengado", monto: new Prisma.Decimal("1.00"), origenTipo: "manual", origenId: null, descripcion: `461 ${clave}`, fechaMovimiento: instante },
        });
        ids.caja[clave] = c;
        ids.tienda[clave] = t;
        ids.mensajero[clave] = m;
      }
      return cuerpo(tx, p, ids);
    });
  }

  it("caja: filtrar el dia D devuelve las tres filas de D y ninguna de los bordes; D-1 y D+1 devuelven las suyas", async () => {
    const m = await conFilas(async (tx, p, ids) => {
      const repo = new WalletMovimientoRepository(tx as unknown as PrismaClient);
      const leer = async (desde: string, hasta: string) => {
        const f = listarMovimientosSchema.parse({ desde, hasta, pageSize: 100 });
        const pagina = await repo.listar({ ...f, page: 1, pageSize: 5000 });
        const mios = new Set(Object.values(ids.caja));
        return pagina.movimientos.filter((x) => mios.has(x.id)).map((x) => x.id).sort();
      };
      return {
        d: await leer(D, D),
        vispera: await leer("2026-09-09", "2026-09-09"),
        siguiente: await leer("2026-09-11", "2026-09-11"),
        rango: await leer("2026-09-09", "2026-09-11"),
        ids: ids.caja,
        agregadoD: await repo.agregarPorCategoriaYTipo({ ...listarMovimientosSchema.parse({ desde: D, hasta: D }), categoria: "ingreso_ajuste" }),
        agregadoDConMios: (
          await tx.walletMovimiento.findMany({
            where: { id: { in: Object.values(ids.caja) }, fechaMovimiento: { gte: INSTANTES.inicio, lt: INSTANTES.siguiente0000 } },
          })
        ).length,
        registrador: p.maestro.usuarioId,
      };
    });
    expect(m.d).toEqual(DEL_DIA.map((k) => m.ids[k]).sort());
    expect(m.vispera).toEqual([m.ids.vispera2300]);
    expect(m.siguiente).toEqual([m.ids.siguiente0000]);
    expect(m.rango).toEqual(Object.values(m.ids).sort());
    expect(m.agregadoDConMios).toBe(3);
  });

  it("tienda: el desglose y el saldo filtrados por D cuentan EXACTAMENTE las tres filas de D", async () => {
    const m = await conFilas(async (tx, p, ids) => {
      const repo = new WalletTiendaMovimientoRepository(tx as unknown as PrismaClient);
      const f = listarMovimientosTiendaSchema.parse({ desde: D, hasta: D });
      const pagina = await repo.listarPorTienda({ tiendaId: p.tiendaId, page: 1, pageSize: 100, desde: f.desde, hasta: f.hasta });
      const saldo = await repo.agregarSaldoPorTienda(p.tiendaId, { desde: f.desde, hasta: f.hasta });
      const vispera = listarMovimientosTiendaSchema.parse({ desde: "2026-09-09", hasta: "2026-09-09" });
      const paginaVispera = await repo.listarPorTienda({ tiendaId: p.tiendaId, page: 1, pageSize: 100, desde: vispera.desde, hasta: vispera.hasta });
      return { ids: pagina.movimientos.map((x) => x.id).sort(), total: pagina.total, saldo, vispera: paginaVispera.movimientos.map((x) => x.id), esperados: ids.tienda };
    });
    expect(m.ids).toEqual(DEL_DIA.map((k) => m.esperados[k]).sort());
    expect(m.total).toBe(3);
    expect(m.saldo).toEqual({ creditos: "3.00", debitos: "0.00" });
    expect(m.vispera).toEqual([m.esperados.vispera2300]);
  });

  it("mensajero: el desglose y la cuenta por pagar filtrados por D cuentan EXACTAMENTE las tres filas de D", async () => {
    const m = await conFilas(async (tx, p, ids) => {
      const repo = new PagoMensajeroMovimientoRepository(tx as unknown as PrismaClient);
      const f = listarPagosDeMensajeroSchema.parse({ mensajeroId: p.mensajeroId, desde: D, hasta: D });
      const pagina = await repo.listarPorMensajero({ mensajeroId: p.mensajeroId, page: 1, pageSize: 100, desde: f.desde, hasta: f.hasta });
      const cuenta = await repo.agregarCuentaPorPagar(p.mensajeroId, { desde: f.desde, hasta: f.hasta });
      const siguiente = listarPagosDeMensajeroSchema.parse({ mensajeroId: p.mensajeroId, desde: "2026-09-11", hasta: "2026-09-11" });
      const paginaSiguiente = await repo.listarPorMensajero({ mensajeroId: p.mensajeroId, page: 1, pageSize: 100, desde: siguiente.desde, hasta: siguiente.hasta });
      return { ids: pagina.movimientos.map((x) => x.id).sort(), total: pagina.total, cuenta, siguiente: paginaSiguiente.movimientos.map((x) => x.id), esperados: ids.mensajero };
    });
    expect(m.ids).toEqual(DEL_DIA.map((k) => m.esperados[k]).sort());
    expect(m.total).toBe(3);
    expect(m.cuenta).toEqual({ devengado: "3.00", pagado: "0.00" });
    expect(m.siguiente).toEqual([m.esperados.siguiente0000]);
  });

  it("CONTRAPRUEBA: con la traduccion vieja (medianoche UTC, `hasta` inclusivo) el dia D saldria MAL en los tres libros", async () => {
    // La forma exacta que la auditoria midio: `z.coerce.date("2026-09-10")` y `<= hasta`. Se emula el
    // WHERE viejo a mano sobre las mismas filas para dejar dicho, en verde, que el cambio no es cosmetico.
    const m = await conFilas(async (tx, _p, ids) => {
      const viejoDesde = new Date("2026-09-10T00:00:00.000Z");
      const viejoHasta = new Date("2026-09-10T00:00:00.000Z");
      const filas = await tx.walletMovimiento.findMany({
        where: { id: { in: Object.values(ids.caja) }, fechaMovimiento: { gte: viejoDesde, lte: viejoHasta } },
        select: { id: true },
      });
      return { viejo: filas.map((x) => x.id), ids: ids.caja };
    });
    // Ninguna de las tres filas de D entraba; el filtro «hoy» de la auditoria devolvia 2 de 7 por esto.
    expect(m.viejo).toEqual([]);
    expect(FUERA.length + DEL_DIA.length).toBe(5);
  });
});
