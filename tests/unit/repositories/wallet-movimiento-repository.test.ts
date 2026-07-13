import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import type { CrearMovimientoInput } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";

// Feature 42 — tests unit del WalletMovimientoRepository (mockea Prisma, sin DB real).
// Cubre R2 (persiste tipo/categoria/monto/origen/fecha), R6/R13 (idempotencia por
// skipDuplicates -> ON CONFLICT DO NOTHING), R14 (egresos polimorficos), R20 (filtros en
// el WHERE), R24 (orderBy fecha desc, balance agregado STRING).

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    walletMovimiento: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    ...overrides,
  };
}

describe("crearMovimientos (R2/R6/R13/R14)", () => {
  it("R2: mapea monto STRING -> Prisma.Decimal y persiste todos los campos", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 1 });
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const movs: CrearMovimientoInput[] = [
      {
        tipo: "ingreso",
        categoria: "ingreso_flete",
        monto: "1000.00",
        origenTipo: "cierre_dia",
        origenId: "c1",
      },
    ];
    const n = await repo.crearMovimientos(prisma as never, movs);

    expect(n).toBe(1);
    const arg = prisma.walletMovimiento.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true); // R6/R13: ON CONFLICT DO NOTHING
    expect(arg.data[0]).toMatchObject({
      tipo: "ingreso",
      categoria: "ingreso_flete",
      origenTipo: "cierre_dia",
      origenId: "c1",
      descripcion: null,
      registradoPor: null,
    });
    expect(arg.data[0].monto).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data[0].monto.toFixed(2)).toBe("1000.00");
  });

  it("R14: acepta egresos con categoria/origen polimorfico y registradoPor", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 1 });
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    await repo.crearMovimientos(prisma as never, [
      {
        tipo: "egreso",
        categoria: "egreso_ajuste",
        monto: "50.00",
        origenTipo: "manual",
        origenId: null,
        descripcion: "ajuste manual",
        registradoPor: "u-maestro",
      },
    ]);

    const arg = prisma.walletMovimiento.createMany.mock.calls[0][0];
    expect(arg.data[0]).toMatchObject({
      tipo: "egreso",
      categoria: "egreso_ajuste",
      origenTipo: "manual",
      origenId: null,
      descripcion: "ajuste manual",
      registradoPor: "u-maestro",
    });
  });

  it("R6: lista vacia -> no llama createMany, devuelve 0", async () => {
    const prisma = buildPrisma();
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);
    const n = await repo.crearMovimientos(prisma as never, []);
    expect(n).toBe(0);
    expect(prisma.walletMovimiento.createMany).not.toHaveBeenCalled();
  });

  it("R6/R13: cuando el constraint deduplica, count refleja solo lo insertado (no error)", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.createMany.mockResolvedValue({ count: 0 }); // todo ya existia
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);
    const n = await repo.crearMovimientos(prisma as never, [
      { tipo: "ingreso", categoria: "ingreso_flete", monto: "1.00", origenTipo: "cierre_dia", origenId: "c1" },
    ]);
    expect(n).toBe(0);
  });
});

describe("listar (R20/R24)", () => {
  it("R20: aplica filtros tipo/categoria/rango en el WHERE; orderBy fecha desc; paginado", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.findMany.mockResolvedValue([]);
    prisma.walletMovimiento.count.mockResolvedValue(0);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const desde = new Date("2026-07-01T00:00:00.000Z");
    const hasta = new Date("2026-07-31T00:00:00.000Z");
    await repo.listar({ page: 2, pageSize: 20, tipo: "ingreso", categoria: "ingreso_flete", desde, hasta });

    const arg = prisma.walletMovimiento.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      tipo: "ingreso",
      categoria: "ingreso_flete",
      fechaMovimiento: { gte: desde, lte: hasta },
    });
    expect(arg.orderBy).toEqual({ fechaMovimiento: "desc" });
    expect(arg.skip).toBe(20); // (page 2 - 1) * 20
    expect(arg.take).toBe(20);
  });

  it("sin filtros -> WHERE vacio; mapea filas a DTO con monto STRING y fecha ISO", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.findMany.mockResolvedValue([
      {
        id: "w1",
        tipo: "ingreso",
        categoria: "ingreso_flete",
        monto: new Prisma.Decimal("1000"),
        origenTipo: "cierre_dia",
        origenId: "c1",
        descripcion: null,
        registradoPor: null,
        fechaMovimiento: new Date("2026-07-12T10:00:00.000Z"),
        createdAt: new Date("2026-07-12T10:00:00.000Z"),
      },
    ]);
    prisma.walletMovimiento.count.mockResolvedValue(1);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const r = await repo.listar({ page: 1, pageSize: 20 });

    expect(prisma.walletMovimiento.findMany.mock.calls[0][0].where).toEqual({});
    expect(r.total).toBe(1);
    expect(r.movimientos[0]).toEqual({
      id: "w1",
      tipo: "ingreso",
      categoria: "ingreso_flete",
      monto: "1000.00",
      origenTipo: "cierre_dia",
      origenId: "c1",
      descripcion: null,
      registradoPor: null,
      fechaMovimiento: "2026-07-12T10:00:00.000Z",
    });
    expect(typeof r.movimientos[0].monto).toBe("string");
  });
});

describe("agregarBalance (R16)", () => {
  it("SUM por tipo -> ingresos/egresos STRING; aplica filtros en el WHERE", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.groupBy.mockResolvedValue([
      { tipo: "ingreso", _sum: { monto: new Prisma.Decimal("1500.50") } },
      { tipo: "egreso", _sum: { monto: new Prisma.Decimal("300.25") } },
    ]);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);

    const r = await repo.agregarBalance({ categoria: "ingreso_flete" });

    const arg = prisma.walletMovimiento.groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(["tipo"]);
    expect(arg.where).toEqual({ categoria: "ingreso_flete" });
    expect(r).toEqual({ ingresos: "1500.50", egresos: "300.25" });
    expect(typeof r.ingresos).toBe("string");
  });

  it("sin egresos aun -> egresos 0.00 (balance parcial, A3)", async () => {
    const prisma = buildPrisma();
    prisma.walletMovimiento.groupBy.mockResolvedValue([
      { tipo: "ingreso", _sum: { monto: new Prisma.Decimal("800") } },
    ]);
    const repo = new WalletMovimientoRepository(prisma as unknown as PrismaClient);
    const r = await repo.agregarBalance({});
    expect(r).toEqual({ ingresos: "800.00", egresos: "0.00" });
  });
});
