import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// FEATURE 260 (B3) — R2, R11, R19, R40. LA CONSULTA DE HIDRATACION.
//
// Lo que este archivo protege NO es que la consulta "funcione": es que **no sea una segunda
// proyeccion**. El detalle del tablero del dia pasa a mostrar la orden completa, y la unica
// forma de que las dos pantallas no puedan divergir es que las dos salgan del MISMO `include`
// y del MISMO mapeo. Por eso la asercion central de abajo no compara contra un objeto escrito
// aqui al lado —eso seria la asercion-contra-su-propia-fuente que este repo ya pago—: llama a
// `list()` y a `findListItemsByIds()` contra el mismo Prisma de mentira y compara **lo que las
// dos le pasan**.
//
// Prisma va mockeado a proposito: aqui se afirma la FORMA del `where` y del `include`. Que ese
// `where` recorte de verdad —la borrada y la de otra zona— es un hecho del motor y se prueba
// contra Postgres en `tests/integration/orden-list-items-by-ids.test.ts`. Un test con dobles
// NO VE EL SQL: medido cuatro veces en este repo, una mutacion del `WHERE` los pasa en verde.

const ZONA = "22222222-2222-4222-8222-222222222222";

function buildPrisma() {
  return {
    orden: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

function repo(prisma: ReturnType<typeof buildPrisma>): OrdenRepository {
  return new OrdenRepository(prisma as unknown as PrismaClient);
}

describe("OrdenRepository.findListItemsByIds — el `where` (R11/R19/R40)", () => {
  it("acota por la lista de ids y descarta las borradas", async () => {
    const prisma = buildPrisma();
    await repo(prisma).findListItemsByIds(["a", "b"], { tipo: "global" });

    const args = prisma.orden.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: { in: ["a", "b"] }, deletedAt: null });
  });

  it("con alcance ZONA añade el recorte multi-tenant al MISMO `where` (R11)", async () => {
    const prisma = buildPrisma();
    await repo(prisma).findListItemsByIds(["a"], { tipo: "zona", zonaId: ZONA });

    const args = prisma.orden.findMany.mock.calls[0][0];
    // Hermano de los otros dos (AND), no dentro de un `OR` ni en una segunda consulta.
    expect(args.where).toEqual({ id: { in: ["a"] }, deletedAt: null, zonaId: ZONA });
  });

  it("con alcance GLOBAL no aparece ninguna clave de zona", async () => {
    const prisma = buildPrisma();
    await repo(prisma).findListItemsByIds(["a"], { tipo: "global" });

    const args = prisma.orden.findMany.mock.calls[0][0];
    expect(Object.keys(args.where).sort()).toEqual(["deletedAt", "id"]);
  });

  it("R40 — no puede devolver mas filas que ids recibio: no hay `take`, hay `IN`", async () => {
    const prisma = buildPrisma();
    const ids = Array.from({ length: 25 }, (_, i) => `o${i}`);
    await repo(prisma).findListItemsByIds(ids, { tipo: "global" });

    const args = prisma.orden.findMany.mock.calls[0][0];
    expect(args.where.id.in).toEqual(ids);
    // Ni paginacion ni orden propios: quien pidio los ids ya decidio cuales y en que orden.
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect(args.orderBy).toBeUndefined();
  });

  it("R5 — con la lista vacia devuelve `[]` SIN consultar", async () => {
    const prisma = buildPrisma();
    const items = await repo(prisma).findListItemsByIds([], { tipo: "zona", zonaId: ZONA });

    expect(items).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });

  it("copia la lista de ids en vez de pasar la referencia `readonly` recibida", async () => {
    const prisma = buildPrisma();
    const ids: readonly string[] = ["a", "b"];
    await repo(prisma).findListItemsByIds(ids, { tipo: "global" });

    expect(prisma.orden.findMany.mock.calls[0][0].where.id.in).not.toBe(ids);
    expect(prisma.orden.findMany.mock.calls[0][0].where.id.in).toEqual(["a", "b"]);
  });
});

describe("OrdenRepository.findListItemsByIds — NO es una segunda proyeccion (R2)", () => {
  it("pide EXACTAMENTE el mismo `include` que `list()`, derivado de la propia llamada", async () => {
    const prismaListado = buildPrisma();
    await repo(prismaListado).list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 25,
    });

    const prismaHidratacion = buildPrisma();
    await repo(prismaHidratacion).findListItemsByIds(["a"], { tipo: "global" });

    const includeDelListado = prismaListado.orden.findMany.mock.calls[0][0].include;
    const includeDeLaHidratacion = prismaHidratacion.orden.findMany.mock.calls[0][0].include;

    // Si alguien copiara el `include` en vez de reusar la constante, esta comparacion seguiria
    // verde el primer dia y se pondria roja el dia que uno de los dos cambie — que es
    // exactamente cuando hace falta que se ponga roja.
    expect(includeDeLaHidratacion).toEqual(includeDelListado);
    // Y no es verde por vacio: ese `include` trae de verdad las relaciones del listado.
    expect(Object.keys(includeDeLaHidratacion).sort()).toEqual([
      "canton",
      "distrito",
      "estatus",
      "gestiones",
      "mensajeroAsignado",
      "provincia",
      "tienda",
      "zona",
    ]);
  });

  it("no declara `select`: un `select` propio SERIA la segunda proyeccion", async () => {
    const prisma = buildPrisma();
    await repo(prisma).findListItemsByIds(["a"], { tipo: "global" });
    expect(prisma.orden.findMany.mock.calls[0][0].select).toBeUndefined();
  });
});
