import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 87 (T7) — metodos de repo de la lista de NOVEDADES. Prisma se mockea con dobles
// simples (patron orden-repository.recepcion-satelite.test.ts): sin DB real, se verifica la
// forma de la query (where/orderBy/select/skip/take) y el mapeo/reduccion de filas. Cubre
// R4 (excluye borradas), R8 (una consulta agregada sin N+1) y R22 (skip/take + count).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    orden: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    gestionOrden: {
      findMany: vi.fn(),
    },
    ...overrides,
  };
}

describe("OrdenRepository.countDevueltasByTienda (R2/R3/R4/R22)", () => {
  it("R4: cuenta acotando tienda + estatus + deletedAt null (excluye borradas)", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(7);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.countDevueltasByTienda("tienda-1", "devuelta")).toBe(7);
    expect(prisma.orden.count).toHaveBeenCalledWith({
      where: { tiendaId: "tienda-1", deletedAt: null, estatus: { value: "devuelta" } },
    });
  });
});

describe("OrdenRepository.findDevueltasByTienda (R1/R2/R3/R4/R21/R22)", () => {
  it("R4/R22: where con deletedAt null, orderBy createdAt desc, skip/take y select minimo", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "o1",
        numGuia: 100,
        destinatario: "Ana",
        telefonoDest: "88887777",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findDevueltasByTienda("tienda-1", "devuelta", {
      skip: 20,
      take: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "o1", numGuia: 100, destinatario: "Ana" });
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      tiendaId: "tienda-1",
      deletedAt: null,
      estatus: { value: "devuelta" },
    });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.skip).toBe(20);
    expect(arg.take).toBe(10);
    // Select minimo: no arrastra columnas pesadas ni deletedAt.
    expect(arg.select).toEqual({
      id: true,
      numGuia: true,
      destinatario: true,
      telefonoDest: true,
      createdAt: true,
    });
  });
});

describe("OrdenRepository.findCausasDevueltaVigentes (R6/R7/R8)", () => {
  it("R8: UNA sola consulta agregada para TODAS las ordenes (sin N+1)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findCausasDevueltaVigentes(["o1", "o2", "o3"]);

    expect(prisma.gestionOrden.findMany).toHaveBeenCalledTimes(1); // no una por orden
    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      ordenId: { in: ["o1", "o2", "o3"] },
      resultado: "devuelta", // R6: solo devoluciones
      anuladaAt: null, // vigencia (feature 67), aplicada como LECTURA
    });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.select).toEqual({ ordenId: true, causaDevolucion: true, createdAt: true });
  });

  it("R6: reduce a la fila MAS RECIENTE por orden (ignora las mas antiguas)", async () => {
    const prisma = buildPrisma();
    // Vienen desc por createdAt: la primera por ordenId es la vigente/mas reciente.
    prisma.gestionOrden.findMany.mockResolvedValue([
      { ordenId: "o1", causaDevolucion: "not_found", createdAt: new Date("2026-03-10T00:00:00Z") },
      { ordenId: "o1", causaDevolucion: "wrong_number", createdAt: new Date("2026-01-01T00:00:00Z") },
      { ordenId: "o2", causaDevolucion: null, createdAt: new Date("2026-02-01T00:00:00Z") },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findCausasDevueltaVigentes(["o1", "o2"]);

    expect(map.get("o1")).toEqual({
      causa: "not_found",
      fecha: new Date("2026-03-10T00:00:00Z"),
    });
    expect(map.get("o2")).toEqual({ causa: null, fecha: new Date("2026-02-01T00:00:00Z") });
  });

  it("R7/R8: ids vacio -> Map vacio sin disparar la query", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findCausasDevueltaVigentes([]);

    expect(map.size).toBe(0);
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
  });
});
