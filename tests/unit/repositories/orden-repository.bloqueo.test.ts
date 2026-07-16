import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 41/D1 (R12/R16/R17) — consultas del bloqueo derivado. `findMensajerosBloqueados`
// = mensajeros con cierre solicitado/vencido. `existeBodegaSateliteBloqueada` = ajuste
// admin_satelite: bloqueo duro por mensajeros SOLO si TODOS los mensajeros de la zona
// tienen un cierre abierto; en otro caso, campos informativos para el aviso no bloqueante.
// Mockea Prisma (sin DB real).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    usuario: { findMany: vi.fn() },
    cierreDia: { findMany: vi.fn(), count: vi.fn() },
    cierreBodega: { count: vi.fn() },
    ...overrides,
  };
}

describe("OrdenRepository.findMensajerosBloqueados (R12/R16)", () => {
  it("R12/R16: consulta estado IN (solicitado, vencido); devuelve el set de bloqueados", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([{ mensajeroId: "m1" }, { mensajeroId: "m3" }]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const set = await repo.findMensajerosBloqueados(["m1", "m2", "m3"]);

    expect(set).toEqual(new Set(["m1", "m3"]));
    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      mensajeroId: { in: ["m1", "m2", "m3"] },
      estado: { in: ["solicitado", "vencido"] }, // R16: rechazado/aprobado NO bloquean
    });
  });

  it("ids vacio -> set vacio sin consultar", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    expect(await repo.findMensajerosBloqueados([])).toEqual(new Set());
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.existeBodegaSateliteBloqueada (ajuste admin_satelite)", () => {
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

  it("ALGUNOS (no todos) con cierre abierto -> NO bloquea, solo informativo", async () => {
    const { res } = await run(["m1", "m2", "m3"], ["m2"], 0);
    expect(res).toMatchObject({
      bloqueada: false,
      porMensajeros: false,
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

  it("causa (ii): CierreBodega pendiente -> bloqueo duro aunque no todos los mensajeros esten bloqueados", async () => {
    const { res } = await run(["m1", "m2"], ["m1"], 1);
    expect(res).toMatchObject({
      bloqueada: true,
      porMensajeros: false, // solo 1 de 2 mensajeros
      porCierreBodega: true,
      cierresAbiertos: 1,
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
      estado: { in: ["solicitado", "vencido"] },
    });
    expect(prisma.cierreBodega.count.mock.calls[0][0].where).toMatchObject({
      zonaId: "z1",
      estado: "solicitado",
    });
  });
});
