import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import type { ListOrdenesWhere } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 169 / T2.5 — traduccion del termino al `where` de Prisma (R7, R15, R17).
//
// Prisma va mockeado: lo que se afirma es el OBJETO que llega a `findMany` y a `count`.
// El COMPORTAMIENTO real (que `"100%"` no devuelva el listado entero contra un motor de
// verdad) lo verifica `tests/integration/db/busqueda-comportamiento.test.ts`; aqui se fija
// la forma, que es lo que se rompe en silencio al refactorizar.

function buildPrisma() {
  return {
    orden: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  };
}

async function whereDe(where: ListOrdenesWhere) {
  const prisma = buildPrisma();
  const repo = new OrdenRepository(prisma as unknown as PrismaClient);
  await repo.list({ where, sortBy: "created_at", sortDir: "desc", skip: 0, take: 20 });
  return {
    findMany: prisma.orden.findMany.mock.calls[0][0].where,
    count: prisma.orden.count.mock.calls[0][0].where,
  };
}

describe("termino -> `contains` sobre la columna generada", () => {
  it("el termino viaja como `contains` de `busquedaTexto`", async () => {
    const { findMany } = await whereDe({ busqueda: "juan perez" });
    expect(findMany.busquedaTexto).toEqual({ contains: "juan perez" });
  });

  it("NO usa `mode: insensitive` (la columna y el termino ya vienen en minusculas)", async () => {
    // `ILIKE` obligaria a plegar caja en cada recheck del indice trigram para nada: los
    // dos lados de la comparacion ya estan normalizados.
    const { findMany } = await whereDe({ busqueda: "juan" });
    expect(findMany.busquedaTexto).not.toHaveProperty("mode");
  });

  it("R17: sigue excluyendo las borradas logicamente", async () => {
    const { findMany } = await whereDe({ busqueda: "juan" });
    expect(findMany.deletedAt).toBeNull();
  });

  it("la clave es HERMANA del resto: AND, nunca dentro de un OR (R14/R21)", async () => {
    const { findMany } = await whereDe({
      busqueda: "juan",
      tiendaId: "store1",
      estatusId: ["os-1"],
    });
    expect(Object.keys(findMany).sort()).toEqual([
      "busquedaTexto",
      "deletedAt",
      "estatusId",
      "tiendaId",
    ]);
    expect(findMany).not.toHaveProperty("OR");
  });

  it("sin termino, la clave NO aparece (R18: el `where` previo, intacto)", async () => {
    const { findMany } = await whereDe({ tiendaId: "store1" });
    expect(findMany).not.toHaveProperty("busquedaTexto");
    expect(findMany).not.toHaveProperty("numGuia");
  });

  it("un termino vacio no filtra (no se convierte en `contains: \"\"`, que casaria todo)", async () => {
    const { findMany } = await whereDe({ busqueda: "" });
    expect(findMany).not.toHaveProperty("busquedaTexto");
  });
});

describe("escape de comodines de LIKE (R7)", () => {
  it("`%` viaja escapado: buscar `100%` no puede devolver todo lo que empieza por 100", async () => {
    const { findMany } = await whereDe({ busqueda: "100%" });
    expect(findMany.busquedaTexto).toEqual({ contains: "100\\%" });
  });

  it("`_` viaja escapado: deja de ser 'un caracter cualquiera'", async () => {
    const { findMany } = await whereDe({ busqueda: "a_c" });
    expect(findMany.busquedaTexto).toEqual({ contains: "a\\_c" });
  });

  it("el propio `\\` se duplica (es el caracter de escape por defecto en Postgres)", async () => {
    const { findMany } = await whereDe({ busqueda: "a\\b" });
    expect(findMany.busquedaTexto).toEqual({ contains: "a\\\\b" });
  });

  it("un termino con los tres a la vez se escapa entero, en una pasada", async () => {
    const { findMany } = await whereDe({ busqueda: "\\%_" });
    expect(findMany.busquedaTexto).toEqual({ contains: "\\\\\\%\\_" });
  });

  it("un termino normal no se toca", async () => {
    const { findMany } = await whereDe({ busqueda: "jose pena 8888-0000" });
    expect(findMany.busquedaTexto).toEqual({ contains: "jose pena 8888-0000" });
  });
});

describe("ruta rapida por num_guia", () => {
  it("viaja como IGUALDAD, no como `contains` (usa el indice unico ya existente)", async () => {
    const { findMany } = await whereDe({ numGuia: 12345 });
    expect(findMany.numGuia).toBe(12345);
    expect(findMany).not.toHaveProperty("busquedaTexto");
  });

  it("compone con el acotamiento por rol: la guia sola no da acceso a nada", async () => {
    const { findMany } = await whereDe({ numGuia: 12345, tiendaId: "store1" });
    expect(findMany.numGuia).toBe(12345);
    expect(findMany.tiendaId).toBe("store1");
  });
});

describe("el conteo usa EXACTAMENTE el mismo criterio que la pagina (R15)", () => {
  it("con termino de texto", async () => {
    const { findMany, count } = await whereDe({ busqueda: "juan", zonaId: ["z1"] });
    expect(count).toEqual(findMany);
  });

  it("con la ruta rapida", async () => {
    const { findMany, count } = await whereDe({ numGuia: 12345, tiendaId: "store1" });
    expect(count).toEqual(findMany);
  });

  it("con el termino escapado (el escape se aplica a los dos por igual)", async () => {
    const { findMany, count } = await whereDe({ busqueda: "100%" });
    expect(count).toEqual(findMany);
    expect(count.busquedaTexto).toEqual({ contains: "100\\%" });
  });
});

describe("el orden del listado no cambia con el termino (R16)", () => {
  it("el `orderBy` es el mismo con y sin busqueda", async () => {
    const prismaSin = buildPrisma();
    await new OrdenRepository(prismaSin as unknown as PrismaClient).list({
      where: {},
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });
    const prismaCon = buildPrisma();
    await new OrdenRepository(prismaCon as unknown as PrismaClient).list({
      where: { busqueda: "juan" },
      sortBy: "created_at",
      sortDir: "desc",
      skip: 0,
      take: 20,
    });
    // No hay orden por relevancia: la busqueda FILTRA, no RANQUEA.
    expect(prismaCon.orden.findMany.mock.calls[0][0].orderBy).toEqual(
      prismaSin.orden.findMany.mock.calls[0][0].orderBy,
    );
  });
});
