import { describe, it, expect, vi } from "vitest";
import { type PrismaClient } from "@prisma/client";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";

// Feature 167 / T1.5 — `findRecoleccionesDeActor`: la consulta que sostiene «Recolectadas hoy».
// Doble de Prisma (sin DB real), patron `orden-historial-repository.test.ts`.
//
// Lo que se afirma aqui es el WHERE COMPLETO, y en particular una AUSENCIA: la consulta NO
// filtra por `estatus_destino_id`. Esa ausencia es R26 en su forma ejecutable — si alguien
// "endureciera" el where con el destino, una orden ya recibida en la bodega central (138)
// dejaria de figurar y el mensajero veria evaporarse su trabajo del dia al llegar a la central,
// que es exactamente cuando lo quiere ver.
//
// La VENTANA no se decide aqui: llega calculada desde el service (R27). Este test comprueba que
// el repo la aplica tal cual, con `gte` (inclusivo) y `lt` (EXCLUSIVO), sin reinterpretarla.

const ACTOR = "m1";
const DESDE = new Date("2026-07-31T06:00:00.000Z"); // 00:00 CR del 31
const HASTA = new Date("2026-08-01T06:00:00.000Z"); // 00:00 CR del 1 (EXCLUSIVO)

function buildPrisma() {
  return {
    ordenHistorialEstado: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeRepo() {
  const prisma = buildPrisma();
  const repo = new OrdenHistorialRepository(prisma as unknown as PrismaClient);
  return { prisma, repo };
}

/** Fila cruda tal como la devuelve Prisma con la proyeccion del repo. */
function historialRow(overrides: Record<string, unknown> = {}) {
  return {
    ordenId: "o1",
    createdAt: new Date("2026-07-31T15:30:00.000Z"),
    orden: {
      numGuia: 1001,
      numRemision: "REM-1",
      tienda: { nombre: "Tienda Central" },
    },
    ...overrides,
  };
}

describe("findRecoleccionesDeActor — el WHERE (R24/R25/R29)", () => {
  it("acota por actor, por la familia `recoleccion_tienda` y por la ventana [desde, hasta)", async () => {
    const { prisma, repo } = makeRepo();

    await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, 101);

    expect(prisma.ordenHistorialEstado.findMany).toHaveBeenCalledTimes(1);
    const args = prisma.ordenHistorialEstado.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({
      actorUsuarioId: ACTOR,
      origenTipo: "recoleccion_tienda",
      createdAt: { gte: DESDE, lt: HASTA },
      orden: { deletedAt: null },
    });
  });

  it("R29: excluye las ordenes borradas en el WHERE, no en el cliente", async () => {
    const { prisma, repo } = makeRepo();

    await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, 101);

    const args = prisma.ordenHistorialEstado.findMany.mock.calls[0]![0];
    expect(args.where.orden).toEqual({ deletedAt: null });
  });

  it("R26: NO filtra por `estatusDestinoId` — el estado ACTUAL de la orden es irrelevante", async () => {
    const { prisma, repo } = makeRepo();

    await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, 101);

    const args = prisma.ordenHistorialEstado.findMany.mock.calls[0]![0];
    expect(args.where).not.toHaveProperty("estatusDestinoId");
    expect(Object.keys(args.where)).toEqual([
      "actorUsuarioId",
      "origenTipo",
      "createdAt",
      "orden",
    ]);
  });

  it("la cota superior es EXCLUSIVA (`lt`), nunca inclusiva: 00:00 CR del dia siguiente no entra", async () => {
    const { prisma, repo } = makeRepo();

    await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, 101);

    const args = prisma.ordenHistorialEstado.findMany.mock.calls[0]![0];
    expect(args.where.createdAt).toHaveProperty("lt", HASTA);
    expect(args.where.createdAt).not.toHaveProperty("lte");
  });
});

describe("findRecoleccionesDeActor — orden, tope y proyeccion (R28/R31/R38)", () => {
  it("R28: pide `createdAt desc` (mas reciente primero)", async () => {
    const { prisma, repo } = makeRepo();

    await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, 101);

    const args = prisma.ordenHistorialEstado.findMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("R31: el `take` es EXACTAMENTE el limite recibido (el service pide TOPE + 1)", async () => {
    const { prisma, repo } = makeRepo();

    await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, 101);

    const args = prisma.ordenHistorialEstado.findMany.mock.calls[0]![0];
    expect(args.take).toBe(101);
  });

  it("R38: la proyeccion no pide monto, coordenadas ni el estado de la orden", async () => {
    const { prisma, repo } = makeRepo();

    await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, 101);

    const args = prisma.ordenHistorialEstado.findMany.mock.calls[0]![0];
    expect(Object.keys(args.select.orden.select).sort()).toEqual([
      "numGuia",
      "numRemision",
      "tienda",
    ]);
    expect(args.select.orden.select).not.toHaveProperty("montoCobrar");
    expect(args.select.orden.select).not.toHaveProperty("latitud");
    expect(args.select.orden.select).not.toHaveProperty("longitud");
    expect(args.select.orden.select).not.toHaveProperty("estatus");
  });

  it("mapea la fila a `RecoleccionHistorialRow`: el instante sale del HISTORIAL, no de la orden", async () => {
    const { prisma, repo } = makeRepo();
    prisma.ordenHistorialEstado.findMany.mockResolvedValue([
      historialRow(),
      historialRow({
        ordenId: "o2",
        createdAt: new Date("2026-07-31T09:00:00.000Z"),
        orden: { numGuia: null, numRemision: "REM-2", tienda: { nombre: "Tienda Sur" } },
      }),
    ]);

    const filas = await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, 101);

    expect(filas).toEqual([
      {
        ordenId: "o1",
        numGuia: 1001,
        numRemision: "REM-1",
        tiendaNombre: "Tienda Central",
        recolectadaAt: new Date("2026-07-31T15:30:00.000Z"),
      },
      {
        ordenId: "o2",
        numGuia: null, // una orden sin guia generada no rompe la lista
        numRemision: "REM-2",
        tiendaNombre: "Tienda Sur",
        recolectadaAt: new Date("2026-07-31T09:00:00.000Z"),
      },
    ]);
  });

  it("no reordena en el cliente: devuelve las filas en el orden que vino de la consulta", async () => {
    const { prisma, repo } = makeRepo();
    prisma.ordenHistorialEstado.findMany.mockResolvedValue([
      historialRow({ ordenId: "tarde", createdAt: new Date("2026-07-31T20:00:00.000Z") }),
      historialRow({ ordenId: "temprano", createdAt: new Date("2026-07-31T07:00:00.000Z") }),
    ]);

    const filas = await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, 101);

    expect(filas.map((f) => f.ordenId)).toEqual(["tarde", "temprano"]);
  });
});

describe("findRecoleccionesDeActor — guarda temprana", () => {
  it.each([
    ["cero", 0],
    ["negativo", -1],
  ])("limite %s -> lista vacia SIN emitir consulta", async (_n, limite) => {
    const { prisma, repo } = makeRepo();

    const filas = await repo.findRecoleccionesDeActor(ACTOR, DESDE, HASTA, limite);

    expect(filas).toEqual([]);
    expect(prisma.ordenHistorialEstado.findMany).not.toHaveBeenCalled();
  });
});
