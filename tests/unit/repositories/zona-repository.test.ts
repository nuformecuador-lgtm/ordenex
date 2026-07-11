import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import {
  DistritosInexistentesError,
  DistritosYaAsignadosError,
} from "@/lib/interfaces/repositories/IZonaRepository";

// Feature 24. Solo Prisma; se mockea el cliente y se hace que $transaction ejecute
// el callback con el propio mock (tx === prisma).

function zonaRow(over: Record<string, unknown> = {}) {
  return {
    id: "z1",
    nombre: "Zona Sur",
    pagoEntrega: { toNumber: () => 1000 },
    pagoRechazo: { toNumber: () => 500 },
    esGam: false,
    _count: { distritos: 2 },
    ...over,
  };
}

function buildPrisma(over: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const zonaFindUnique = over.zonaFindUnique ?? vi.fn().mockResolvedValue(zonaRow());
  const zonaFindMany = over.zonaFindMany ?? vi.fn().mockResolvedValue([zonaRow()]);
  const zonaCreate = over.zonaCreate ?? vi.fn().mockResolvedValue({ id: "z1" });
  const zonaUpdate = over.zonaUpdate ?? vi.fn().mockResolvedValue({ id: "z1" });
  const zonaUpdateMany = over.zonaUpdateMany ?? vi.fn().mockResolvedValue({ count: 0 });
  const zonaCount = over.zonaCount ?? vi.fn().mockResolvedValue(1);
  const distritoFindMany =
    over.distritoFindMany ?? vi.fn().mockResolvedValue([
      { id: "d1", zonaId: null },
      { id: "d2", zonaId: null },
    ]);
  const distritoUpdateMany = over.distritoUpdateMany ?? vi.fn().mockResolvedValue({ count: 2 });

  const prisma = {
    zona: {
      findUnique: zonaFindUnique,
      findMany: zonaFindMany,
      create: zonaCreate,
      update: zonaUpdate,
      updateMany: zonaUpdateMany,
      count: zonaCount,
    },
    distrito: { findMany: distritoFindMany, updateMany: distritoUpdateMany },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  } as unknown as Pick<PrismaClient, "zona" | "distrito" | "$transaction">;

  return {
    prisma,
    zonaFindUnique,
    zonaFindMany,
    zonaCreate,
    zonaUpdate,
    zonaUpdateMany,
    zonaCount,
    distritoFindMany,
    distritoUpdateMany,
  };
}

const crearData = {
  nombre: "Zona Sur",
  pagoEntrega: 1000,
  pagoRechazo: 500,
  esGam: false,
  distritoIds: ["d1", "d2"],
};

describe("ZonaRepository.create (R17/R18/R20)", () => {
  it("R17: crea la zona y asigna distrito.zona_id a los distritos seleccionados", async () => {
    const m = buildPrisma();
    const repo = new ZonaRepository(m.prisma);
    const dto = await repo.create(crearData);

    expect(m.zonaCreate).toHaveBeenCalled();
    expect(m.distritoUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["d1", "d2"] } },
      data: { zonaId: "z1" },
    });
    expect(dto.distritosCount).toBe(2);
    expect(dto.pagoEntrega).toBe(1000);
  });

  it("R18: un distrito inexistente aborta sin crear la zona (rollback)", async () => {
    const m = buildPrisma({
      distritoFindMany: vi.fn().mockResolvedValue([{ id: "d1", zonaId: null }]), // falta d2
    });
    const repo = new ZonaRepository(m.prisma);

    await expect(repo.create(crearData)).rejects.toBeInstanceOf(DistritosInexistentesError);
    expect(m.zonaCreate).not.toHaveBeenCalled();
    expect(m.distritoUpdateMany).not.toHaveBeenCalled();
  });

  it("R20: un distrito ya asignado a otra zona -> DistritosYaAsignadosError sin persistir", async () => {
    const m = buildPrisma({
      distritoFindMany: vi.fn().mockResolvedValue([
        { id: "d1", zonaId: null },
        { id: "d2", zonaId: "otra-zona" },
      ]),
    });
    const repo = new ZonaRepository(m.prisma);

    await expect(repo.create(crearData)).rejects.toBeInstanceOf(DistritosYaAsignadosError);
    expect(m.zonaCreate).not.toHaveBeenCalled();
  });

  it("R23: crear una zona GAM desmarca cualquier otra en la misma transaccion", async () => {
    const m = buildPrisma();
    const repo = new ZonaRepository(m.prisma);
    await repo.create({ ...crearData, esGam: true });
    expect(m.zonaUpdateMany).toHaveBeenCalledWith({ where: { esGam: true }, data: { esGam: false } });
  });
});

describe("ZonaRepository.update (R22)", () => {
  it("libera los distritos removidos (zona_id NULL) y asigna el nuevo conjunto", async () => {
    const m = buildPrisma();
    const repo = new ZonaRepository(m.prisma);
    await repo.update("z1", { distritoIds: ["d1"] });

    // libera los que ya no estan
    expect(m.distritoUpdateMany).toHaveBeenCalledWith({
      where: { zonaId: "z1", id: { notIn: ["d1"] } },
      data: { zonaId: null },
    });
    // asigna el conjunto nuevo
    expect(m.distritoUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["d1"] } },
      data: { zonaId: "z1" },
    });
  });

  it("devuelve null si la zona no existe (not_found)", async () => {
    const m = buildPrisma({ zonaFindUnique: vi.fn().mockResolvedValue(null) });
    const repo = new ZonaRepository(m.prisma);
    const r = await repo.update("zX", { nombre: "N" });
    expect(r).toBeNull();
  });

  it("R23: marcar esGam=true en update desmarca las demas", async () => {
    const m = buildPrisma();
    const repo = new ZonaRepository(m.prisma);
    await repo.update("z1", { esGam: true });
    expect(m.zonaUpdateMany).toHaveBeenCalledWith({
      where: { esGam: true, NOT: { id: "z1" } },
      data: { esGam: false },
    });
  });
});

describe("ZonaRepository.setGam (R23)", () => {
  it("desmarca la GAM previa y marca la nueva; false si no existe", async () => {
    const m = buildPrisma();
    const repo = new ZonaRepository(m.prisma);
    const ok = await repo.setGam("z1");
    expect(ok).toBe(true);
    expect(m.zonaUpdateMany).toHaveBeenCalledWith({
      where: { esGam: true, NOT: { id: "z1" } },
      data: { esGam: false },
    });
    expect(m.zonaUpdate).toHaveBeenCalledWith({ where: { id: "z1" }, data: { esGam: true } });

    const m2 = buildPrisma({ zonaFindUnique: vi.fn().mockResolvedValue(null) });
    const repo2 = new ZonaRepository(m2.prisma);
    expect(await repo2.setGam("zX")).toBe(false);
  });
});

describe("ZonaRepository.list / listLight / findByNombreKey (R24/R15/R21)", () => {
  it("R24: list devuelve items con distritosCount + total", async () => {
    const m = buildPrisma({ zonaCount: vi.fn().mockResolvedValue(3) });
    const repo = new ZonaRepository(m.prisma);
    const r = await repo.list({ skip: 0, take: 25 });
    expect(r.total).toBe(3);
    expect(r.items[0].distritosCount).toBe(2);
  });

  it("R15: listLight proyecta id/nombre/esGam", async () => {
    const m = buildPrisma({
      zonaFindMany: vi.fn().mockResolvedValue([{ id: "z1", nombre: "GAM", esGam: true }]),
    });
    const repo = new ZonaRepository(m.prisma);
    const r = await repo.listLight();
    expect(r).toEqual([{ id: "z1", nombre: "GAM", esGam: true }]);
  });

  it("R21: findByNombreKey compara por clave normalizada y excluye la propia zona", async () => {
    const m = buildPrisma({
      zonaFindMany: vi.fn().mockResolvedValue([
        { id: "z1", nombre: "Zona Sur" },
        { id: "z2", nombre: "GAM" },
      ]),
    });
    const repo = new ZonaRepository(m.prisma);
    // "ZONA SUR" normaliza a "zona sur" -> coincide con z1
    expect(await repo.findByNombreKey("zona sur")).toEqual({ id: "z1" });
    // excluyendo z1, no hay match
    expect(await repo.findByNombreKey("zona sur", "z1")).toBeNull();
    // clave inexistente
    expect(await repo.findByNombreKey("otra")).toBeNull();
  });
});
