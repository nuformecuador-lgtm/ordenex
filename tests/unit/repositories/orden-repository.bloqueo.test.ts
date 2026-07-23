import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 41/D1 (R12/R16/R17) — consultas del bloqueo derivado. `findMensajerosBloqueados`
// = mensajeros con cierre solicitado/vencido. `existeBodegaSateliteBloqueada` = bloqueo
// duro por mensajeros si AL MENOS 1 mensajero de la zona tiene un cierre abierto
// (decision del humano 2026-07-16: se unifica la semantica a >=1 en central y satelites,
// revirtiendo el ajuste previo "TODOS", para que coincida con el gate de seleccion del
// maestro). Mockea Prisma (sin DB real).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    usuario: { findMany: vi.fn() },
    cierreDia: { findMany: vi.fn(), count: vi.fn() },
    cierreBodega: { count: vi.fn() },
    ...overrides,
  };
}

describe("OrdenRepository.findMensajerosBloqueados (R12/R16 + feature 109/R29)", () => {
  it("R29: consulta estado IN (solicitado, vencido, rechazado); devuelve el set de bloqueados", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([{ mensajeroId: "m1" }, { mensajeroId: "m3" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const set = await repo.findMensajerosBloqueados(["m1", "m2", "m3"]);

    expect(set).toEqual(new Set(["m1", "m3"]));
    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      mensajeroId: { in: ["m1", "m2", "m3"] },
      // Feature 109/R29 (modelo GLOBAL): SOLO `aprobado` deja de bloquear. `rechazado` YA NO es
      // terminal -> bloquea (y es re-solicitable), igual que `vencido`/`solicitado`.
      estado: { in: ["solicitado", "vencido", "rechazado"] },
    });
  });

  // Feature 109/R29: un mensajero con un cierre `rechazado` SIGUE bloqueado (antes de la 109 el
  // rechazo desbloqueaba; ahora bloquea hasta re-solicitar + aprobar).
  it("R29: un cierre `rechazado` bloquea al mensajero (por-mensajero)", async () => {
    const prisma = buildPrisma();
    // El WHERE incluye 'rechazado' -> el cierre rechazado de m1 lo devuelve la query.
    prisma.cierreDia.findMany.mockImplementation(
      async (args: { where: { estado: { in: string[] } } }) => {
        expect(args.where.estado.in).toContain("rechazado");
        return [{ mensajeroId: "m1" }];
      },
    );
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const set = await repo.findMensajerosBloqueados(["m1"]);
    expect(set).toEqual(new Set(["m1"]));
  });

  it("ids vacio -> set vacio sin consultar", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    expect(await repo.findMensajerosBloqueados([])).toEqual(new Set());
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });
});

// Gate de seleccion del maestro: zonas (central y satelite) con >=1 mensajero con cierre
// abierto. Una sola consulta agregada (sin N+1 por zona).
describe("OrdenRepository.findZonasConMensajeroBloqueado", () => {
  it("devuelve las zonas distintas de los mensajeros con cierre abierto", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([{ zonaId: "z-gam" }, { zonaId: "z-limon" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    expect(await repo.findZonasConMensajeroBloqueado()).toEqual(new Set(["z-gam", "z-limon"]));
    expect(prisma.usuario.findMany).toHaveBeenCalledTimes(1); // sin N+1 por zona
  });

  it("R29: filtra por rol mensajero, zona no nula y cierre solicitado/vencido/rechazado; distinct por zona", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    await repo.findZonasConMensajeroBloqueado();

    const arg = prisma.usuario.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      rol: { value: "mensajero" },
      zonaId: { not: null },
      // Feature 109/R29: el conjunto bloqueante por zona tambien gana `rechazado`.
      cierresRealizados: { some: { estado: { in: ["solicitado", "vencido", "rechazado"] } } },
    });
    expect(arg.distinct).toEqual(["zonaId"]);
  });

  it("nadie con cierre abierto -> set vacio", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    expect(await repo.findZonasConMensajeroBloqueado()).toEqual(new Set());
  });

  it("descarta zonaId null (defensivo) sin romper el set", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue([{ zonaId: "z1" }, { zonaId: null }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    expect(await repo.findZonasConMensajeroBloqueado()).toEqual(new Set(["z1"]));
  });
});

describe("OrdenRepository.existeBodegaSateliteBloqueada (regla >=1, 2026-07-16)", () => {
  /**
   * `mensajeros` = ids de mensajeros de la zona; `bloqueados` = subconjunto con cierre
   * abierto (solicitado/vencido); `countBodega` = CierreBodega pendiente (causa ii).
   */
  async function run(
    mensajeros: string[],
    bloqueados: string[],
    countBodega: number,
  ) {
    const prisma = buildPrisma();
    prisma.usuario.findMany.mockResolvedValue(mensajeros.map((id) => ({ id })));
    prisma.cierreDia.findMany.mockResolvedValue(
      bloqueados.map((mensajeroId) => ({ mensajeroId })),
    );
    prisma.cierreBodega.count.mockResolvedValue(countBodega);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    const res = await repo.existeBodegaSateliteBloqueada("z1");
    return { res, prisma };
  }

  it("TODOS los mensajeros con cierre abierto -> bloqueo duro por mensajeros", async () => {
    // Caso extremo de la regla >=1: sigue bloqueando.
    const { res } = await run(["m1", "m2"], ["m1", "m2"], 0);
    expect(res).toMatchObject({
      bloqueada: true,
      porMensajeros: true,
      porCierreBodega: false,
      cierresAbiertos: 2,
      totalMensajeros: 2,
    });
    expect(new Set(res.mensajerosConCierreIds)).toEqual(new Set(["m1", "m2"]));
  });

  // Decision del humano 2026-07-16: 1 solo cierre abierto ya bloquea la bodega (antes
  // este caso NO bloqueaba y solo alimentaba un aviso informativo).
  it("1 de 3 mensajeros con cierre abierto -> bloqueo duro por mensajeros", async () => {
    const { res } = await run(["m1", "m2", "m3"], ["m2"], 0);
    expect(res).toMatchObject({
      bloqueada: true,
      porMensajeros: true,
      porCierreBodega: false,
      cierresAbiertos: 1,
      totalMensajeros: 3,
      mensajerosConCierreIds: ["m2"],
    });
  });

  it("NINGUN mensajero con cierre y sin CierreBodega -> no bloqueada, cierresAbiertos 0", async () => {
    const { res } = await run(["m1", "m2"], [], 0);
    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      porCierreBodega: false,
      cierresAbiertos: 0,
      totalMensajeros: 2,
      mensajerosConCierreIds: [],
    });
  });

  // Causa (ii) aislada: sin ningun mensajero bloqueado, para que el `true` venga solo
  // del CierreBodega pendiente y no de la causa (i).
  it("causa (ii): CierreBodega pendiente -> bloqueo duro sin mensajeros bloqueados", async () => {
    const { res } = await run(["m1", "m2"], [], 1);
    expect(res).toMatchObject({
      bloqueada: true,
      porMensajeros: false, // ningun mensajero con cierre abierto
      porCierreBodega: true,
      cierresAbiertos: 0,
      totalMensajeros: 2,
    });
  });

  it("zona SIN mensajeros -> no bloquea por (i) (vacuo), cierresAbiertos 0", async () => {
    const { res, prisma } = await run([], [], 0);
    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
      cierresAbiertos: 0,
      totalMensajeros: 0,
      mensajerosConCierreIds: [],
    });
    // Sin mensajeros, findMensajerosBloqueados corta antes de consultar cierre_dia.
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });

  it("filtros: mensajeros por rol+zona; cierre_dia por estado solicitado/vencido; cierre_bodega solicitado", async () => {
    const { prisma } = await run(["m1"], ["m1"], 1);
    expect(prisma.usuario.findMany.mock.calls[0][0].where).toMatchObject({
      rol: { value: "mensajero" },
      zonaId: "z1",
    });
    expect(prisma.cierreDia.findMany.mock.calls[0][0].where).toMatchObject({
      mensajeroId: { in: ["m1"] },
      estado: { in: ["solicitado", "vencido", "rechazado"] }, // feature 109/R29
    });
    expect(prisma.cierreBodega.count.mock.calls[0][0].where).toMatchObject({
      zonaId: "z1",
      estado: "solicitado",
    });
  });
});
