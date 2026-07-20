import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    orden: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      createMany: vi.fn(),
    },
    orderStatus: { findUnique: vi.fn() },
    zona: { findUnique: vi.fn() },
    provincia: { findUnique: vi.fn(), findMany: vi.fn() },
    canton: { findUnique: vi.fn(), findMany: vi.fn() },
    distrito: { findUnique: vi.fn(), findMany: vi.fn() },
    usuario: { findMany: vi.fn() },
    ...overrides,
  };
}

describe("OrdenRepository.findResumenByNumRemisiones (R6, R8, R9, R10)", () => {
  it("filtra por numRemision in, tiendaId y deletedAt:null", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    await repo.findResumenByNumRemisiones(["REM-1", "REM-2"], "tienda-1");

    const arg = prisma.orden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      numRemision: { in: ["REM-1", "REM-2"] },
      tiendaId: "tienda-1",
      deletedAt: null,
    });
  });

  it("mapea montoCobrar Decimal -> number, y null se preserva null", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "ord-1",
        numGuia: 1,
        numRemision: "REM-1",
        destinatario: "Ana",
        telefonoDest: "0991234567",
        producto: "Caja",
        montoCobrar: new Prisma.Decimal("12.50"),
        direccion: "Av. Siempre Viva",
        mensajeroSugeridoId: "msg-1",
        zonaId: "z1",
        estatus: { value: "en_preparacion" },
        zona: { nombre: "Norte" },
        mensajeroSugerido: { nombre: "Beto" },
      },
      {
        id: "ord-2",
        numGuia: 2,
        numRemision: "REM-2",
        destinatario: "Carla",
        telefonoDest: "0987654321",
        producto: "Sobre",
        montoCobrar: null,
        direccion: null,
        mensajeroSugeridoId: null,
        zonaId: "z2",
        estatus: { value: "en_preparacion" },
        zona: { nombre: "Sur" },
        mensajeroSugerido: null,
      },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findResumenByNumRemisiones(["REM-1", "REM-2"], "tienda-1");

    expect(rows[0].montoCobrar).toBe(12.5);
    expect(rows[0].mensajeroSugeridoNombre).toBe("Beto");
    expect(rows[0].zonaId).toBe("z1");
    expect(rows[0].zonaNombre).toBe("Norte");
    expect(rows[1].montoCobrar).toBeNull();
    expect(rows[1].mensajeroSugeridoNombre).toBeNull();
    expect(rows[1].zonaNombre).toBe("Sur");
  });

  it("no expone deletedAt ni otros campos internos en la salida", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "ord-1",
        numGuia: 1,
        numRemision: "REM-1",
        destinatario: "Ana",
        telefonoDest: "0991234567",
        producto: "Caja",
        montoCobrar: null,
        direccion: null,
        mensajeroSugeridoId: null,
        zonaId: "z1",
        estatus: { value: "en_preparacion" },
        zona: { nombre: "Norte" },
        mensajeroSugerido: null,
      },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findResumenByNumRemisiones(["REM-1"], "tienda-1");

    expect(rows[0]).not.toHaveProperty("deletedAt");
    expect(rows[0]).not.toHaveProperty("passwordHash");
  });

  it("preserva la unicidad de num_remision: una fila por remision distinta", async () => {
    const prisma = buildPrisma();
    prisma.orden.findMany.mockResolvedValue([
      {
        id: "ord-1",
        numGuia: 1,
        numRemision: "REM-1",
        destinatario: "Ana",
        telefonoDest: "0991234567",
        producto: "Caja",
        montoCobrar: null,
        direccion: null,
        mensajeroSugeridoId: null,
        zonaId: "z1",
        estatus: { value: "en_preparacion" },
        zona: { nombre: "Norte" },
        mensajeroSugerido: null,
      },
      {
        id: "ord-2",
        numGuia: 2,
        numRemision: "REM-2",
        destinatario: "Carla",
        telefonoDest: "0987654321",
        producto: "Sobre",
        montoCobrar: null,
        direccion: null,
        mensajeroSugeridoId: null,
        zonaId: "z2",
        estatus: { value: "en_preparacion" },
        zona: { nombre: "Sur" },
        mensajeroSugerido: null,
      },
    ]);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findResumenByNumRemisiones(["REM-1", "REM-2"], "tienda-1");

    const nums = rows.map((r) => r.numRemision);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it("devuelve [] sin consultar cuando nums esta vacio", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findResumenByNumRemisiones([], "tienda-1");

    expect(rows).toEqual([]);
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.asignarMensajeroSugerido (R15, R16)", () => {
  it("updateMany con where id in + tiendaId + deletedAt:null, devuelve count", async () => {
    const prisma = buildPrisma();
    prisma.orden.updateMany.mockResolvedValue({ count: 3 });
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarMensajeroSugerido(["ord-1", "ord-2", "ord-3"], "msg-1", "tienda-1");

    expect(count).toBe(3);
    const arg = prisma.orden.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      id: { in: ["ord-1", "ord-2", "ord-3"] },
      tiendaId: "tienda-1",
      deletedAt: null,
    });
    expect(arg.data).toEqual({ mensajeroSugeridoId: "msg-1" });
  });

  it("devuelve 0 sin llamar updateMany cuando ordenIds esta vacio", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.asignarMensajeroSugerido([], "msg-1", "tienda-1");

    expect(count).toBe(0);
    expect(prisma.orden.updateMany).not.toHaveBeenCalled();
  });
});

describe("OrdenRepository.countOrdenesDeTienda", () => {
  it("cuenta ordenes que pertenecen a tiendaId y no estan borradas", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(2);
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.countOrdenesDeTienda(["ord-1", "ord-2"], "tienda-1");

    expect(count).toBe(2);
    const arg = prisma.orden.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      id: { in: ["ord-1", "ord-2"] },
      tiendaId: "tienda-1",
      deletedAt: null,
    });
  });

  it("devuelve 0 sin consultar cuando ordenIds esta vacio", async () => {
    const prisma = buildPrisma();
    const repo = new OrdenRepository(prisma as unknown as PrismaClient);

    const count = await repo.countOrdenesDeTienda([], "tienda-1");

    expect(count).toBe(0);
    expect(prisma.orden.count).not.toHaveBeenCalled();
  });
});
