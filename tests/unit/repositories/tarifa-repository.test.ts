import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { TarifaRepository } from "@/lib/repositories/TarifaRepository";

function tarifaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cob-1",
    nombre: "Tarifa GAM",
    zonaId: "zona-1",
    valorFlete: new Prisma.Decimal("10.00"),
    valorFleteDevuelto: new Prisma.Decimal("5.00"),
    valorFleteGam: new Prisma.Decimal("8.00"),
    valorFleteDevueltoGam: new Prisma.Decimal("4.00"),
    fulfillment: new Prisma.Decimal("3.00"),
    comisionCod: new Prisma.Decimal("2.50"),
    ivaFlete: new Prisma.Decimal("15.00"),
    ivaComisionCod: new Prisma.Decimal("15.00"),
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function baseCreateData() {
  return {
    nombre: "Tarifa GAM",
    zonaId: "zona-1",
    valorFlete: 10,
    valorFleteDevuelto: 5,
    valorFleteGam: 8,
    valorFleteDevueltoGam: 4,
    fulfillment: 3,
    comisionCod: 2.5,
    ivaFlete: 15,
    ivaComisionCod: 15,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    tarifa: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    ...overrides,
  };
}

describe("TarifaRepository.create (R16/R27)", () => {
  it("convierte numbers a Prisma.Decimal y serializa la respuesta a TarifaDTO", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.create.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    const dto = await repo.create(baseCreateData());

    const arg = prisma.tarifa.create.mock.calls[0][0];
    expect(arg.data.valorFlete).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data.valorFlete.toString()).toBe("10");
    expect(arg.data.zonaId).toBe("zona-1"); // feature 24: FK a zona

    expect(dto.nombre).toBe("Tarifa GAM");
    expect(dto.zonaId).toBe("zona-1");
    expect(dto.valorFlete).toBe(10);
    expect(dto.ivaComisionCod).toBe(15);
    expect(dto).not.toHaveProperty("deletedAt");
  });
});

describe("TarifaRepository.findById (R19)", () => {
  it("filtra deleted_at IS NULL en el where", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await repo.findById("cob-1");

    const arg = prisma.tarifa.findFirst.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "cob-1", deletedAt: null });
  });

  it("devuelve null cuando no hay fila (borrada o inexistente)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findFirst.mockResolvedValue(null);
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.findById("x")).toBeNull();
  });
});

describe("TarifaRepository.list (R18/R19/R27)", () => {
  it("devuelve items/total, excluye borrados, orderBy created_at desc y skip/take", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.findMany.mockResolvedValue([tarifaRow(), tarifaRow({ id: "cob-2" })]);
    prisma.tarifa.count.mockResolvedValue(2);
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    const res = await repo.list({ skip: 0, take: 20 });

    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);
    expect(res.items[0].nombre).toBe("Tarifa GAM");
    expect(res.items[0]).not.toHaveProperty("deletedAt");

    const arg = prisma.tarifa.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ deletedAt: null });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(20);

    const countArg = prisma.tarifa.count.mock.calls[0][0];
    expect(countArg.where).toMatchObject({ deletedAt: null });
  });
});

describe("TarifaRepository.update (R21/R22)", () => {
  it("aplica cambios solo sobre no borrados y devuelve el DTO", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockResolvedValue({ count: 1 });
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow({ nombre: "Nueva" }));
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    const dto = await repo.update("cob-1", { nombre: "Nueva" });

    const arg = prisma.tarifa.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "cob-1", deletedAt: null });
    expect(arg.data.nombre).toBe("Nueva");
    expect(dto?.nombre).toBe("Nueva");
  });

  it("convierte montos/porcentajes provistos a Prisma.Decimal", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockResolvedValue({ count: 1 });
    prisma.tarifa.findFirst.mockResolvedValue(tarifaRow());
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    await repo.update("cob-1", { valorFlete: 20, ivaFlete: 10 });

    const arg = prisma.tarifa.updateMany.mock.calls[0][0];
    expect(arg.data.valorFlete).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data.ivaFlete).toBeInstanceOf(Prisma.Decimal);
  });

  it("devuelve null si no existe o esta borrado (R21)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockResolvedValue({ count: 0 });
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.update("x", { nombre: "Otro" })).toBeNull();
  });
});

describe("TarifaRepository.softDelete (R24/R25)", () => {
  it("fija deleted_at solo si el tarifa no estaba borrado", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockResolvedValue({ count: 1 });
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.softDelete("cob-1")).toBe(true);
    const arg = prisma.tarifa.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "cob-1", deletedAt: null });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });

  it("devuelve false si no habia fila que borrar (R25)", async () => {
    const prisma = buildPrisma();
    prisma.tarifa.updateMany.mockResolvedValue({ count: 0 });
    const repo = new TarifaRepository(prisma as unknown as PrismaClient);

    expect(await repo.softDelete("x")).toBe(false);
  });
});
