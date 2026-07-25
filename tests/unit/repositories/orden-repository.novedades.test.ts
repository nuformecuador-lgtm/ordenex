import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 89/99 (T13) — metodos de repo de la lista de NOVEDADES. Prisma se mockea con dobles
// simples (patron orden-repository.recepcion-satelite.test.ts): sin DB real, se verifica la
// FORMA del `where` construido. INVIERTE al predicado de la feature 99 (Q7): la novedad se ancla
// al ESTADO REAL `estatus = devuelta`, reemplazando "gestion devuelta vigente + estatus abierto".
//   R7 `estatus.value = "devuelta"` (solo mientras la orden REPOSE en ese estado);
//   R8 `deletedAt: null` (excluye borradas) + `count` y `find` con el MISMO `where`;
//   R8 (no doble conteo) el predicado YA NO usa `gestiones.some` ni `notIn`: una orden liberada a
//      `en_bodega_central`/escalada a `rechazada` sale del predicado por su estado real.
// La causa (R9) la sigue resolviendo `findCausasDevueltaVigentes` (sin cambios).

// El `where` que ambos metodos DEBEN construir con el predicado anclado al estado real (§3.5).
const NOVEDAD_WHERE = {
  tiendaId: "tienda-1",
  deletedAt: null, // R8: excluye borradas
  estatus: { value: "devuelta" }, // R7: solo mientras REPOSE en `devuelta`
};

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

describe("OrdenRepository.countDevueltasByTienda (R7/R8)", () => {
  it("R7/R8: cuenta con el predicado anclado al estado (estatus = devuelta + tienda + no borrada)", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(7);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.countDevueltasByTienda("tienda-1")).toBe(7);
    expect(prisma.orden.count).toHaveBeenCalledWith({ where: NOVEDAD_WHERE });

    const { where } = prisma.orden.count.mock.calls[0][0];
    // R7: la novedad es la orden que REPOSA en `devuelta` (estado real, no la gestion).
    expect(where.estatus).toEqual({ value: "devuelta" });
    // R8: nunca cuenta borradas.
    expect(where.deletedAt).toBeNull();
  });

  it("R8 (no doble conteo): el predicado NO usa `gestiones.some` ni `notIn` -> una liberada/escalada sale", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");
    const { where } = prisma.orden.count.mock.calls[0][0];
    // Ya no se filtra por gestion vigente: el ancla es el estado real.
    expect(where).not.toHaveProperty("gestiones");
    // Y no hay lista `notIn`: solo `estatus.value = "devuelta"`. Una orden liberada a
    // `en_bodega_central`/`en_bodega_satelite` o escalada a `rechazada` deja de casar (sale de novedades).
    expect(where.estatus.value).toBe("devuelta");
    expect(where.estatus).not.toHaveProperty("notIn");
  });
});

describe("OrdenRepository.findDevueltasByTienda (R7/R8/R9)", () => {
  it("R7/R8: where anclado al estado, orderBy createdAt desc, skip/take y select minimo", async () => {
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

    const rows = await repo.findDevueltasByTienda("tienda-1", { skip: 20, take: 10 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "o1", numGuia: 100, destinatario: "Ana" });
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual(NOVEDAD_WHERE);
    expect(arg.orderBy).toEqual({ createdAt: "desc" }); // fallback; el service reordena por recencia
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

  it("R8: el where NO tiene relacion `gestiones` (anclado SOLO al estado real)", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).not.toHaveProperty("gestiones");
    expect(arg.where.estatus).toEqual({ value: "devuelta" });
  });
});

describe("OrdenRepository — R8: count y find comparten el MISMO where", () => {
  it("R8: ambos metodos construyen exactamente el mismo predicado anclado al estado", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(3);
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1");
    await repo.findDevueltasByTienda("tienda-1", { skip: 0, take: 10 });

    const whereCount = prisma.orden.count.mock.calls[0][0].where;
    const whereFind = prisma.orden.findMany.mock.calls[0][0].where;
    expect(whereCount).toEqual(whereFind);
    expect(whereCount).toEqual(NOVEDAD_WHERE);
  });
});

describe("OrdenRepository.findCausasDevueltaVigentes (R6/R7/R10)", () => {
  it("R7: filtra `resultado=devuelta` y `anuladaAt=null` (una gestion anulada no cuenta)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findCausasDevueltaVigentes(["o1", "o2", "o3"]);

    expect(prisma.gestionOrden.findMany).toHaveBeenCalledTimes(1); // no una por orden (R8)
    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      ordenId: { in: ["o1", "o2", "o3"] },
      resultado: "devuelta", // R6: solo devoluciones
      anuladaAt: null, // R7: solo vigentes (anuladas no cuentan)
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

  it("R10: ids vacio -> Map vacio sin disparar la query", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const map = await repo.findCausasDevueltaVigentes([]);

    expect(map.size).toBe(0);
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
  });
});
