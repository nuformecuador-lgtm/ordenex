import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 41/D1 (R12/R16/R17) — consultas del bloqueo derivado. Mockea Prisma (sin DB real).
//
// PEDIDO HUMANO 2026-08-18 — CAMBIA EL UMBRAL, NO EL CONJUNTO. Los estados que cuentan como
// cierre abierto siguen siendo los tres que no son `aprobado` (feature 109/R29:
// `solicitado`/`vencido`/`rechazado`). Lo que cambia es CUANTOS se toleran: antes bastaba UNO para
// bloquear; ahora se tolera uno y bloquea el SEGUNDO.
//
// Estos tests fijan las dos mitades de esa frase por separado —el conjunto de estados y el tope—
// porque son dos decisiones distintas y se movieron en momentos distintos. Y fijan sobre todo que
// las TRES superficies (guarda por-mensajero, gate por-zona y bloqueo de la bodega satelite) miden
// lo mismo: la regla vive entera en `findMensajerosBloqueados` y las otras dos la consultan.

const ESTADOS_ABIERTOS = ["solicitado", "vencido", "rechazado"];

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    usuario: { findMany: vi.fn() },
    cierreDia: { groupBy: vi.fn(), count: vi.fn() },
    cierreBodega: { count: vi.fn() },
    ...overrides,
  };
}

/** Traduce «este mensajero tiene N cierres abiertos» a la forma que devuelve `groupBy`. */
function grupos(conteos: Record<string, number>) {
  return Object.entries(conteos).map(([mensajeroId, n]) => ({
    mensajeroId,
    _count: { _all: n },
  }));
}

describe("OrdenRepository.findMensajerosBloqueados (R12/R16 + feature 109/R29 + tope 2026-08-18)", () => {
  it("R29: agrupa por mensajero con estado IN (solicitado, vencido, rechazado)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue(grupos({ m1: 2 }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findMensajerosBloqueados(["m1", "m2", "m3"]);

    const arg = prisma.cierreDia.groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(["mensajeroId"]);
    expect(arg.where).toMatchObject({
      mensajeroId: { in: ["m1", "m2", "m3"] },
      // Feature 109/R29 (modelo GLOBAL): SOLO `aprobado` deja de contar. `rechazado` NO es
      // terminal -> cuenta (y es re-solicitable), igual que `vencido`/`solicitado`.
      estado: { in: ESTADOS_ABIERTOS },
    });
  });

  // EL TOPE, que es lo que cambio. Un cierre abierto ya no basta.
  it("UN cierre abierto NO bloquea: es el tolerado", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue(grupos({ m1: 1 }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findMensajerosBloqueados(["m1"])).toEqual(new Set());
  });

  it("DOS cierres abiertos bloquean", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue(grupos({ m1: 2 }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findMensajerosBloqueados(["m1"])).toEqual(new Set(["m1"]));
  });

  it("separa bloqueados de tolerados en la misma consulta", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue(grupos({ m1: 3, m2: 1, m3: 2 }));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    // m2 arrastra uno y sigue recibiendo asignaciones; m1 y m3 no.
    expect(await repo.findMensajerosBloqueados(["m1", "m2", "m3"])).toEqual(
      new Set(["m1", "m3"]),
    );
  });

  // Feature 109/R29: un `rechazado` CUENTA. Con el tope nuevo hacen falta dos para bloquear, pero
  // el punto que este test protege es que el rechazo no se descuenta por ser un rechazo.
  it("R29: los cierres `rechazado` cuentan para el tope", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockImplementation(
      async (args: { where: { estado: { in: string[] } } }) => {
        expect(args.where.estado.in).toContain("rechazado");
        return grupos({ m1: 2 });
      },
    );
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findMensajerosBloqueados(["m1"])).toEqual(new Set(["m1"]));
  });

  it("un mensajero SIN cierres abiertos no aparece en el agrupado y no bloquea", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.groupBy.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findMensajerosBloqueados(["m1", "m2"])).toEqual(new Set());
  });

  it("ids vacio -> set vacio sin consultar", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    expect(await repo.findMensajerosBloqueados([])).toEqual(new Set());
    expect(prisma.cierreDia.groupBy).not.toHaveBeenCalled();
  });
});

// Gate de seleccion del maestro: zonas (central y satelite) con >=1 mensajero BLOQUEADO. Sin N+1
// por zona: dos consultas fijas, no una por zona.
describe("OrdenRepository.findZonasConMensajeroBloqueado", () => {
  /** `conteos` = cierres abiertos por mensajero; `zonaDe` = a que zona pertenece cada uno. */
  async function run(conteos: Record<string, number>, zonaDe: Record<string, string | null>) {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue(
      Object.keys(zonaDe).map((id) => ({ id, zonaId: zonaDe[id] })),
    );
    prisma.cierreDia.groupBy.mockResolvedValue(grupos(conteos));
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    return { set: await repo.findZonasConMensajeroBloqueado(), prisma };
  }

  it("devuelve las zonas distintas de los mensajeros BLOQUEADOS", async () => {
    const { set, prisma } = await run(
      { m1: 2, m2: 3 },
      { m1: "z-gam", m2: "z-limon" },
    );
    expect(set).toEqual(new Set(["z-gam", "z-limon"]));
    expect(prisma.usuario.findMany).toHaveBeenCalledTimes(1); // sin N+1 por zona
  });

  // LA PROPIEDAD QUE IMPORTA: el gate de lectura de la UI y la guarda de escritura del servidor
  // aplican el MISMO tope. Una zona cuyo unico mensajero arrastra un cierre tolerado NO se avisa.
  it("un mensajero con UN cierre (tolerado) no bloquea su zona", async () => {
    const { set } = await run({ m1: 1 }, { m1: "z-gam" });
    expect(set).toEqual(new Set());
  });

  it("basta UN mensajero bloqueado para marcar la zona, aunque los demas esten limpios", async () => {
    const { set } = await run(
      { m1: 1, m2: 2 },
      { m1: "z-gam", m2: "z-gam", m3: "z-gam" },
    );
    expect(set).toEqual(new Set(["z-gam"]));
  });

  it("R29: filtra por rol mensajero y zona no nula; el estado se mide en el agrupado", async () => {
    const { prisma } = await run({}, {});
    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      rol: { value: "mensajero" },
      zonaId: { not: null },
      // Pre-filtro barato: sin NINGUN cierre abierto es imposible superar el tope.
      cierresRealizados: { some: { estado: { in: ESTADOS_ABIERTOS } } },
    });
  });

  it("nadie con cierre abierto -> set vacio", async () => {
    const { set } = await run({}, {});
    expect(set).toEqual(new Set());
  });

  it("descarta zonaId null (defensivo) sin romper el set", async () => {
    const { set } = await run({ m1: 2, m2: 2 }, { m1: "z1", m2: null });
    expect(set).toEqual(new Set(["z1"]));
  });
});

describe("OrdenRepository.existeBodegaSateliteBloqueada (tope 2026-08-18)", () => {
  /**
   * `mensajeros` = ids de mensajeros de la zona; `conteos` = cierres abiertos por mensajero;
   * `countBodega` = CierreBodega pendiente (causa ii).
   */
  async function run(
    mensajeros: string[],
    conteos: Record<string, number>,
    countBodega: number,
  ) {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue(mensajeros.map((id) => ({ id })));
    prisma.cierreDia.groupBy.mockResolvedValue(grupos(conteos));
    prisma.cierreBodega.count.mockResolvedValue(countBodega);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    const res = await repo.existeBodegaSateliteBloqueada("z1");
    return { res, prisma };
  }

  // Pedido humano 2026-08-18 — LA CAUSA (i) DEJO DE BLOQUEAR. Los dos tests que habia aqui
  // afirmaban lo contrario ("TODOS bloqueados -> bloqueo duro" y "1 de 3 -> bloqueo duro") y se
  // invierten: los mensajeros con cierre siguen CONTANDOSE y viajando al borde como dato
  // informativo, pero `bloqueada` ya no los mira.
  it("TODOS los mensajeros bloqueados -> la bodega NO se bloquea, pero el dato viaja", async () => {
    const { res } = await run(["m1", "m2"], { m1: 2, m2: 2 }, 0);
    expect(res).toMatchObject({
      bloqueada: false, // <- lo que cambio
      porMensajeros: true, // informativo: sigue siendo cierto
      porCierreBodega: false,
      cierresAbiertos: 2, // nombre heredado: cuenta MENSAJEROS bloqueados, no cierres
      totalMensajeros: 2,
    });
    expect(new Set(res.mensajerosConCierreIds)).toEqual(new Set(["m1", "m2"]));
  });

  it("1 de 3 mensajeros bloqueado -> la bodega NO se bloquea", async () => {
    const { res } = await run(["m1", "m2", "m3"], { m2: 2 }, 0);
    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: true,
      porCierreBodega: false,
      cierresAbiertos: 1,
      totalMensajeros: 3,
      mensajerosConCierreIds: ["m2"],
    });
  });

  // Y la comprobacion cruzada: con la causa (i) encendida Y la (ii) tambien, sigue bloqueando —
  // pero por la (ii), que es el cierre de la PROPIA bodega y no se toco.
  it("con mensajeros bloqueados Y CierreBodega pendiente, bloquea por la causa (ii)", async () => {
    const { res } = await run(["m1"], { m1: 2 }, 1);
    expect(res).toMatchObject({
      bloqueada: true,
      porMensajeros: true,
      porCierreBodega: true,
    });
  });

  // El caso nuevo: la zona entera arrastrando un cierre cada uno NO bloquea la bodega.
  it("todos con UN cierre (tolerado) -> la bodega NO se bloquea", async () => {
    const { res } = await run(["m1", "m2"], { m1: 1, m2: 1 }, 0);
    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      cierresAbiertos: 0,
      totalMensajeros: 2,
      mensajerosConCierreIds: [],
    });
  });

  it("NINGUN mensajero con cierre y sin CierreBodega -> no bloqueada, cierresAbiertos 0", async () => {
    const { res } = await run(["m1", "m2"], {}, 0);
    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
      cierresAbiertos: 0,
      totalMensajeros: 2,
      mensajerosConCierreIds: [],
    });
  });

  // Causa (ii) aislada: sin ningun mensajero bloqueado, para que el `true` venga solo del
  // CierreBodega pendiente y no de la causa (i).
  it("causa (ii): CierreBodega pendiente -> bloqueo duro sin mensajeros bloqueados", async () => {
    const { res } = await run(["m1", "m2"], {}, 1);
    expect(res).toMatchObject({
      bloqueada: true,
      porMensajeros: false,
      porCierreBodega: true,
      cierresAbiertos: 0,
      totalMensajeros: 2,
    });
  });

  it("zona SIN mensajeros -> no bloquea por (i) (vacuo), cierresAbiertos 0", async () => {
    const { res, prisma } = await run([], {}, 0);
    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      cierresAbiertos: 0,
      totalMensajeros: 0,
      mensajerosConCierreIds: [],
    });
    // Sin mensajeros, findMensajerosBloqueados corta antes de consultar cierre_dia.
    expect(prisma.cierreDia.groupBy).not.toHaveBeenCalled();
  });

  it("filtros: mensajeros por rol+zona; cierre_dia por estado abierto; cierre_bodega solicitado", async () => {
    const { prisma } = await run(["m1"], { m1: 2 }, 1);
    expect(prisma.usuario.findMany.mock.calls[0][0].where).toMatchObject({
      rol: { value: "mensajero" },
      zonaId: "z1",
    });
    expect(prisma.cierreDia.groupBy.mock.calls[0][0].where).toMatchObject({
      mensajeroId: { in: ["m1"] },
      estado: { in: ESTADOS_ABIERTOS }, // feature 109/R29
    });
    expect(prisma.cierreBodega.count.mock.calls[0][0].where).toMatchObject({
      zonaId: "z1",
      estado: "solicitado",
    });
  });
});
