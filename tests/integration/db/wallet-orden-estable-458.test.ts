import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";

import { HAY_BASE_DE_DATOS, crearPrismaDeTest, enTransaccionRevertida, serializarEscriturasReales } from "./_postgres-real";
import { sembrarPersonas461 } from "./_fixtures/personas-461";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.5 — ORDEN ESTABLE DE LOS LIBROS DE TIENDA Y DE MENSAJERO (R23, m4 de la auditoria).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// 14 filas del MISMO instante (`fecha_movimiento` identica: es lo que deja un cierre o un pago), en dos
// tandas de `created_at` (7 y 7), leidas en paginas de 4 (4 + 4 + 4 + 2):
//   · 0 duplicadas y 0 faltantes al juntar las cuatro paginas;
//   · el orden es EXACTAMENTE (fecha desc, created_at desc, id desc), calculado aqui a mano sobre los
//     ids sembrados (no con la funcion que se prueba);
//   · dos lecturas seguidas dan el mismo orden.
// MUTACION (anotada en `progress/fase0_458-B.md`): volver a `orderBy: { fechaMovimiento: "desc" }` → el
// orden deja de ser el esperado (los empates salen en el orden fisico de la tabla) → ROJO.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

const INSTANTE = new Date("2026-09-12T06:00:00.000Z");
const CREADA_1 = new Date("2026-09-12T06:00:01.000Z");
const CREADA_2 = new Date("2026-09-12T06:00:02.000Z");

/** El orden esperado, a mano: la tanda mas reciente primero y, dentro, el id mayor primero. */
function ordenEsperado(filas: { id: string; creada: Date }[]): string[] {
  return [...filas]
    .sort((a, b) => b.creada.getTime() - a.creada.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((f) => f.id);
}

describeSiHayBase("458-B/TB.5 — R23: los libros de tienda y de mensajero se paginan sin repetir ni omitir (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("R23: libro de la TIENDA — 14 filas del mismo instante en paginas de 4: 0 duplicadas, 0 faltantes, orden total", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const filas = Array.from({ length: 14 }, (_, i) => ({ id: randomUUID(), creada: i < 7 ? CREADA_1 : CREADA_2 }));
      // Se insertan en un orden que NO es el esperado (primero la tanda vieja).
      for (const f of filas) {
        await tx.walletTiendaMovimiento.create({
          data: {
            id: f.id,
            tiendaId: p.tiendaId,
            tipo: "credito",
            categoria: "cod_recaudado",
            monto: new Prisma.Decimal("1.00"),
            origenTipo: "manual",
            fechaMovimiento: INSTANTE,
            createdAt: f.creada,
          },
        });
      }
      const repo = new WalletTiendaMovimientoRepository(tx as unknown as PrismaClient);
      const leer = async () => {
        const ids: string[] = [];
        let total = -1;
        for (let page = 1; page <= 4; page += 1) {
          const r = await repo.listarPorTienda({ tiendaId: p.tiendaId, page, pageSize: 4 });
          ids.push(...r.movimientos.map((x) => x.id));
          total = r.total;
        }
        return { ids, total };
      };
      return { primera: await leer(), segunda: await leer(), esperado: ordenEsperado(filas) };
    });
    expect(m.primera.total).toBe(14);
    expect(m.primera.ids).toHaveLength(14);
    expect(new Set(m.primera.ids).size).toBe(14); // 0 duplicadas → 0 faltantes (son 14 de 14)
    expect(m.primera.ids).toEqual(m.esperado);
    expect(m.segunda.ids).toEqual(m.primera.ids);
  }, 120_000);

  it("R23: libro del MENSAJERO — 14 filas del mismo instante en paginas de 4: 0 duplicadas, 0 faltantes, orden total", async () => {
    const m = await enTransaccionRevertida(prisma, async (tx) => {
      await serializarEscriturasReales(tx);
      const p = await sembrarPersonas461(tx);
      const filas = Array.from({ length: 14 }, (_, i) => ({ id: randomUUID(), creada: i < 7 ? CREADA_1 : CREADA_2 }));
      for (const f of filas) {
        await tx.pagoMensajeroMovimiento.create({
          data: {
            id: f.id,
            mensajeroId: p.mensajeroId,
            tipo: "devengo",
            categoria: "pago_devengado",
            monto: new Prisma.Decimal("1.00"),
            origenTipo: "cierre_dia",
            origenId: randomUUID(),
            fechaMovimiento: INSTANTE,
            createdAt: f.creada,
          },
        });
      }
      const repo = new PagoMensajeroMovimientoRepository(tx as unknown as PrismaClient);
      const leer = async () => {
        const ids: string[] = [];
        let total = -1;
        for (let page = 1; page <= 4; page += 1) {
          const r = await repo.listarPorMensajero({ mensajeroId: p.mensajeroId, page, pageSize: 4 });
          ids.push(...r.movimientos.map((x) => x.id));
          total = r.total;
        }
        return { ids, total };
      };
      return { primera: await leer(), segunda: await leer(), esperado: ordenEsperado(filas) };
    });
    expect(m.primera.total).toBe(14);
    expect(m.primera.ids).toHaveLength(14);
    expect(new Set(m.primera.ids).size).toBe(14);
    expect(m.primera.ids).toEqual(m.esperado);
    expect(m.segunda.ids).toEqual(m.primera.ids);
  }, 120_000);
});
