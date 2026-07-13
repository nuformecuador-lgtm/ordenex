import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

// Feature 41/D1 (R12/R16/R17) — consultas del bloqueo derivado. `findMensajerosBloqueados`
// = mensajeros con cierre solicitado/vencido. `existeBodegaSateliteBloqueada` = regla
// estricta (i)||(ii). Mockea Prisma (sin DB real).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
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

describe("OrdenRepository.existeBodegaSateliteBloqueada (R17, regla estricta)", () => {
  async function run(countMensajeros: number, countBodega: number) {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(countMensajeros);
    prisma.cierreBodega.count.mockResolvedValue(countBodega);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);
    const res = await repo.existeBodegaSateliteBloqueada("z1");
    return { res, prisma };
  }

  it("SOLO (i) cierres de sus mensajeros -> bloqueada por mensajeros", async () => {
    const { res } = await run(1, 0);
    expect(res).toEqual({ bloqueada: true, porMensajeros: true, porCierreBodega: false });
  });

  it("SOLO (ii) su propio CierreBodega solicitado -> bloqueada por cierre de bodega", async () => {
    const { res } = await run(0, 1);
    expect(res).toEqual({ bloqueada: true, porMensajeros: false, porCierreBodega: true });
  });

  it("AMBAS causas -> bloqueada con los dos flags", async () => {
    const { res } = await run(2, 1);
    expect(res).toEqual({ bloqueada: true, porMensajeros: true, porCierreBodega: true });
  });

  it("NINGUNA causa -> no bloqueada", async () => {
    const { res } = await run(0, 0);
    expect(res).toEqual({ bloqueada: false, porMensajeros: false, porCierreBodega: false });
  });

  it("R17: causa (i) filtra destino satelite de la zona + estado solicitado/vencido; (ii) cierre_bodega solicitado", async () => {
    const { prisma } = await run(1, 1);
    const iWhere = prisma.cierreDia.count.mock.calls[0][0].where;
    expect(iWhere).toMatchObject({
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z1",
      estado: { in: ["solicitado", "vencido"] },
    });
    const iiWhere = prisma.cierreBodega.count.mock.calls[0][0].where;
    expect(iiWhere).toMatchObject({ zonaId: "z1", estado: "solicitado" });
  });
});
