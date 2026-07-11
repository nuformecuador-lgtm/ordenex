import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GeoRepository } from "@/lib/repositories/GeoRepository";

// Feature 24/R14. Solo queries Prisma; se mockea el cliente.
type GeoPrisma = Pick<PrismaClient, "provincia" | "canton" | "distrito">;

function buildPrisma(over: {
  provinciaFindMany?: ReturnType<typeof vi.fn>;
  cantonFindMany?: ReturnType<typeof vi.fn>;
  distritoFindMany?: ReturnType<typeof vi.fn>;
} = {}) {
  const provinciaFindMany = over.provinciaFindMany ?? vi.fn().mockResolvedValue([{ id: "p1", nombre: "San Jose" }]);
  const cantonFindMany = over.cantonFindMany ?? vi.fn().mockResolvedValue([{ id: "c1", nombre: "Central" }]);
  const distritoFindMany =
    over.distritoFindMany ??
    vi.fn().mockResolvedValue([
      { id: "d1", nombre: "Carmen", zonaId: "z1", zona: { nombre: "GAM" } },
      { id: "d2", nombre: "Merced", zonaId: null, zona: null },
    ]);
  const prisma = {
    provincia: { findMany: provinciaFindMany },
    canton: { findMany: cantonFindMany },
    distrito: { findMany: distritoFindMany },
  } as unknown as GeoPrisma;
  return { prisma, provinciaFindMany, cantonFindMany, distritoFindMany };
}

describe("GeoRepository (R14)", () => {
  it("listProvincias devuelve id/nombre ordenados", async () => {
    const { prisma, provinciaFindMany } = buildPrisma();
    const repo = new GeoRepository(prisma);
    const r = await repo.listProvincias();
    expect(r).toEqual([{ id: "p1", nombre: "San Jose" }]);
    expect(provinciaFindMany.mock.calls[0][0].orderBy).toEqual({ nombre: "asc" });
  });

  it("listCantones filtra por provinciaId", async () => {
    const { prisma, cantonFindMany } = buildPrisma();
    const repo = new GeoRepository(prisma);
    await repo.listCantones("p1");
    expect(cantonFindMany.mock.calls[0][0].where).toEqual({ provinciaId: "p1" });
  });

  it("listDistritos marca la zona de cada distrito (zonaId/zonaNombre) o null", async () => {
    const { prisma, distritoFindMany } = buildPrisma();
    const repo = new GeoRepository(prisma);
    const r = await repo.listDistritos("c1");
    expect(distritoFindMany.mock.calls[0][0].where).toEqual({ cantonId: "c1" });
    expect(r).toEqual([
      { id: "d1", nombre: "Carmen", zonaId: "z1", zonaNombre: "GAM" },
      { id: "d2", nombre: "Merced", zonaId: null, zonaNombre: null },
    ]);
  });
});
