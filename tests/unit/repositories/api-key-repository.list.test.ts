import { describe, it, expect, vi } from "vitest";
import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";

// Feature 82 — ApiKeyRepository.list con Prisma mockeado (sin DB). Aqui se verifica lo
// que el repositorio decide: la proyeccion (R6), el orden fijo (R7) y la paginacion.

interface Row {
  id: string;
  identificador: string;
  keyPrefix: string;
  estado: "activa" | "inactiva";
  usuarioId: string;
  createdAt: Date;
  usuario: { email: string };
}

function row(n: number): Row {
  return {
    id: `key-${n}`,
    identificador: `Tienda ${n}`,
    keyPrefix: `ordx_abc123${n}`,
    estado: "activa",
    usuarioId: `u-dedicado-${n}`,
    createdAt: new Date(`2026-07-1${n}T12:00:00Z`),
    usuario: { email: `apikey+tienda-${n}@apikey.invalid` },
  };
}

function makePrisma(rows: Row[] = [row(1), row(2)], total = rows.length) {
  const findMany = vi.fn(async (args: unknown) => {
    void args;
    return rows;
  });
  const count = vi.fn(async () => total);
  const prisma = { apiKey: { findMany, count } };
  // El repositorio solo usa `apiKey` en este camino; el resto del cliente no se toca.
  return { prisma: prisma as never, findMany, count };
}

describe("ApiKeyRepository.list — proyeccion (R6)", () => {
  it("R6: no le pide `keyHash` a Postgres: la clave no figura en el select", async () => {
    const { prisma, findMany } = makePrisma();
    await new ApiKeyRepository(prisma).list({ skip: 0, take: 25 });

    const args = findMany.mock.calls[0][0] as { select: Record<string, unknown> };
    // El corazon de R6: no es que se filtre despues, es que nunca se pide. Si alguien
    // agrega `keyHash: true` al select, este test cae.
    expect(args.select).not.toHaveProperty("keyHash");
    expect(Object.keys(args.select).sort()).toEqual(
      ["createdAt", "estado", "id", "identificador", "keyPrefix", "usuario", "usuarioId"].sort(),
    );
  });

  it("R6: el item devuelto no expone el hash ni ningun secreto", async () => {
    const { prisma } = makePrisma();
    const { items } = await new ApiKeyRepository(prisma).list({ skip: 0, take: 25 });

    for (const item of items) {
      expect(item).not.toHaveProperty("keyHash");
      expect(item).not.toHaveProperty("plainKey");
    }
    expect(JSON.stringify(items)).not.toContain("keyHash");
  });

  it("R5/[D1]: aplana el email del usuario dedicado y devuelve las claves exactas", async () => {
    const { prisma } = makePrisma([row(1)]);
    const { items } = await new ApiKeyRepository(prisma).list({ skip: 0, take: 25 });

    expect(Object.keys(items[0]).sort()).toEqual(
      ["createdAt", "estado", "id", "identificador", "keyPrefix", "usuarioEmail", "usuarioId"].sort(),
    );
    // [D1]: el email sintetico, no el uuid crudo del include.
    expect(items[0].usuarioEmail).toBe("apikey+tienda-1@apikey.invalid");
    expect(items[0].estado).toBe("activa"); // ciclo de vida: el listado expone el estado
    expect(items[0]).not.toHaveProperty("usuario");
  });
});

describe("ApiKeyRepository.list — orden y paginacion (R7)", () => {
  it("R7: ordena por createdAt descendente", async () => {
    const { prisma, findMany } = makePrisma();
    await new ApiKeyRepository(prisma).list({ skip: 0, take: 25 });

    const args = findMany.mock.calls[0][0] as { orderBy: unknown };
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("traslada skip/take tal cual a la query", async () => {
    const { prisma, findMany } = makePrisma();
    await new ApiKeyRepository(prisma).list({ skip: 50, take: 25 });

    const args = findMany.mock.calls[0][0] as { skip: number; take: number };
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
  });

  it("[D2]: el total cuenta todas las keys, sin filtro por creador", async () => {
    const { prisma, count } = makePrisma([row(1)], 7);
    const { total } = await new ApiKeyRepository(prisma).list({ skip: 0, take: 25 });

    expect(total).toBe(7);
    // Sin `where`: contar solo las del actor seria un scoping que [D2] rechaza.
    expect(count).toHaveBeenCalledWith();
  });

  it("R9: una pagina fuera de rango devuelve items vacios conservando el total real", async () => {
    const { prisma } = makePrisma([], 7);
    const { items, total } = await new ApiKeyRepository(prisma).list({ skip: 999, take: 25 });

    expect(items).toEqual([]);
    expect(total).toBe(7);
  });
});

describe("ApiKeyRepository.count", () => {
  it("devuelve el total de api keys existentes", async () => {
    const { prisma } = makePrisma([], 42);
    expect(await new ApiKeyRepository(prisma).count()).toBe(42);
  });
});
