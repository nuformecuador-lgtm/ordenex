import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 89 (T5) — metodos de repo de la lista de NOVEDADES. Prisma se mockea con dobles
// simples (patron orden-repository.recepcion-satelite.test.ts): sin DB real, se verifica la
// FORMA del `where` construido (el predicado central re-anclado a la GESTION) y el mapeo/
// reduccion de filas. Como el matcheo real lo hace Postgres, cada requisito se traduce a una
// asercion sobre la estructura del `where`:
//   R1 gestion devuelta vigente (`some resultado=devuelta, anuladaAt=null`) + estatus != cerrado;
//   R3 `estatus.value.notIn = cerrados` (excluye {entregada, devuelta_origen, recibido_origen});
//   R4 `en_bodega`/`rechazada` NO estan en `cerrados` -> NO se excluyen;
//   R5 `deletedAt: null` (excluye borradas);
//   R6 `some` -> la orden entra una sola vez aunque tenga varias gestiones; la mas reciente la
//      resuelve `findCausasDevueltaVigentes`;
//   R7 `anuladaAt: null` en el `some` -> una gestion anulada no cuenta;
//   R8 `count` y `find` construyen EXACTAMENTE el mismo `where`.

const CERRADOS = ["entregada", "devuelta_origen", "recibido_origen"];

// El `where` que ambos metodos DEBEN construir con el predicado central (§2 del design).
const NOVEDAD_WHERE = {
  tiendaId: "tienda-1",
  deletedAt: null, // R5: excluye borradas
  estatus: { value: { notIn: CERRADOS } }, // R2/R3: solo mientras no este cerrada
  gestiones: { some: { resultado: "devuelta", anuladaAt: null } }, // R1/R7: gestion devuelta VIGENTE
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

describe("OrdenRepository.countDevueltasByTienda (R1-R8)", () => {
  it("R1/R3/R5/R7: cuenta con el predicado central (gestion devuelta vigente + orden abierta + no borrada)", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(7);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.countDevueltasByTienda("tienda-1", CERRADOS)).toBe(7);
    expect(prisma.orden.count).toHaveBeenCalledWith({ where: NOVEDAD_WHERE });

    const { where } = prisma.orden.count.mock.calls[0][0];
    // R1/R7: exige gestion `devuelta` VIGENTE (no anulada) via la back-relation `gestiones`.
    expect(where.gestiones).toEqual({ some: { resultado: "devuelta", anuladaAt: null } });
    // R3: los tres estatus de cierre se excluyen con `notIn`.
    expect(where.estatus.value.notIn).toEqual(CERRADOS);
    // R5: nunca cuenta borradas.
    expect(where.deletedAt).toBeNull();
  });

  it("R4: `en_bodega` (reintento) y `rechazada` (escalado) NO estan en `cerrados` -> no se excluyen", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(0);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1", CERRADOS);
    const { where } = prisma.orden.count.mock.calls[0][0];
    const excluidos: string[] = where.estatus.value.notIn;
    expect(excluidos).not.toContain("en_bodega");
    expect(excluidos).not.toContain("en_bodega_satelite");
    expect(excluidos).not.toContain("rechazada");
    // Y `devuelta` tampoco cierra (el predicado NO filtra por estatus actual = devuelta).
    expect(excluidos).not.toContain("devuelta");
  });
});

describe("OrdenRepository.findDevueltasByTienda (R1-R8/R12)", () => {
  it("R1/R3/R5/R7/R12: where central, orderBy createdAt desc, skip/take y select minimo", async () => {
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

    const rows = await repo.findDevueltasByTienda("tienda-1", CERRADOS, { skip: 20, take: 10 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "o1", numGuia: 100, destinatario: "Ana" });
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual(NOVEDAD_WHERE);
    expect(arg.orderBy).toEqual({ createdAt: "desc" }); // R12 fallback
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

  it("R6: el `some` incluye la orden una sola vez aunque tenga varias gestiones vigentes", async () => {
    const prisma = buildPrisma();
    // Postgres colapsa el join por `some`: una orden con 2 gestiones vigentes es UNA fila.
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

    const rows = await repo.findDevueltasByTienda("tienda-1", CERRADOS, { skip: 0, take: 10 });
    expect(rows.map((r) => r.id)).toEqual(["o1"]); // sin duplicados
    // El `some` (no `every`) es lo que garantiza "aparece 1 vez si tiene >=1 gestion vigente".
    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where.gestiones).toEqual({ some: { resultado: "devuelta", anuladaAt: null } });
  });
});

describe("OrdenRepository — R8: count y find comparten el MISMO where", () => {
  it("R8: ambos metodos construyen exactamente el mismo predicado", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(3);
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.countDevueltasByTienda("tienda-1", CERRADOS);
    await repo.findDevueltasByTienda("tienda-1", CERRADOS, { skip: 0, take: 10 });

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
