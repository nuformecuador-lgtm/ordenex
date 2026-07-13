import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import type { CrearPagoMensajeroInput } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";

// Feature 44/T6 — tests unit del PagoMensajeroMovimientoRepository (mockea Prisma, sin DB).
// Cubre R2 (persiste todos los campos), R6 (createMany skipDuplicates), R14 (agrega cuenta por
// pagar), R20 (acotado por mensajero_id SIEMPRE en el WHERE), R22 (filtros cierre/fecha en el
// WHERE), R18 (una fila por mensajero con nombre para el maestro).

function movRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    mensajeroId: "m1",
    tipo: "devengo",
    categoria: "pago_devengado",
    monto: new Prisma.Decimal("1000.00"),
    origenTipo: "cierre_dia",
    origenId: "c1",
    descripcion: null,
    registradoPor: null,
    fechaMovimiento: new Date("2026-07-12T10:00:00.000Z"),
    createdAt: new Date("2026-07-12T10:00:00.000Z"),
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    pagoMensajeroMovimiento: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    usuario: { findMany: vi.fn(), findUnique: vi.fn() },
    ...overrides,
  };
}

describe("PagoMensajeroMovimientoRepository.crearMovimientos (R2/R6)", () => {
  it("R6: inserta con createMany skipDuplicates y mapea monto STRING -> Decimal", async () => {
    const prisma = buildPrisma();
    prisma.pagoMensajeroMovimiento.createMany.mockResolvedValue({ count: 2 });
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    const movs: CrearPagoMensajeroInput[] = [
      { mensajeroId: "m1", tipo: "devengo", categoria: "pago_devengado", monto: "1000.00", origenTipo: "cierre_dia", origenId: "c1" },
      { mensajeroId: "m1", tipo: "pago", categoria: "pago_efectivo", monto: "300.00", origenTipo: "cierre_dia", origenId: "c1" },
    ];
    const n = await repo.crearMovimientos(
      { pagoMensajeroMovimiento: prisma.pagoMensajeroMovimiento } as never,
      movs,
    );

    expect(n).toBe(2);
    const arg = prisma.pagoMensajeroMovimiento.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    // R2: persiste mensajero_id/tipo/categoria/monto/origen; monto es Prisma.Decimal.
    expect(arg.data[0]).toMatchObject({ mensajeroId: "m1", tipo: "devengo", categoria: "pago_devengado", origenTipo: "cierre_dia", origenId: "c1" });
    expect(arg.data[0].monto).toBeInstanceOf(Prisma.Decimal);
    expect(arg.data[0].monto.toFixed(2)).toBe("1000.00");
    expect(arg.data[0].descripcion).toBeNull();
    expect(arg.data[0].registradoPor).toBeNull();
  });

  it("lista vacia -> no llama createMany, devuelve 0", async () => {
    const prisma = buildPrisma();
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);
    const n = await repo.crearMovimientos({ pagoMensajeroMovimiento: prisma.pagoMensajeroMovimiento } as never, []);
    expect(n).toBe(0);
    expect(prisma.pagoMensajeroMovimiento.createMany).not.toHaveBeenCalled();
  });
});

describe("PagoMensajeroMovimientoRepository.listarPorMensajero (R20/R22)", () => {
  it("R20: acota mensajero_id SIEMPRE en el WHERE; orderBy fecha desc; pagina", async () => {
    const prisma = buildPrisma();
    prisma.pagoMensajeroMovimiento.findMany.mockResolvedValue([movRow()]);
    prisma.pagoMensajeroMovimiento.count.mockResolvedValue(1);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    const r = await repo.listarPorMensajero({ mensajeroId: "m1", page: 2, pageSize: 10 });

    const arg = prisma.pagoMensajeroMovimiento.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ mensajeroId: "m1" });
    expect(arg.orderBy).toEqual({ fechaMovimiento: "desc" });
    expect(arg.skip).toBe(10); // (page-1)*pageSize
    expect(arg.take).toBe(10);
    expect(r.total).toBe(1);
    expect(r.movimientos[0].monto).toBe("1000.00"); // STRING money-safe
    expect(typeof r.movimientos[0].monto).toBe("string");
  });

  it("R22: cierreId -> origen_tipo=cierre_dia + origen_id; rango de fechas en el WHERE", async () => {
    const prisma = buildPrisma();
    prisma.pagoMensajeroMovimiento.findMany.mockResolvedValue([]);
    prisma.pagoMensajeroMovimiento.count.mockResolvedValue(0);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    const desde = new Date("2026-07-01T00:00:00.000Z");
    const hasta = new Date("2026-07-31T00:00:00.000Z");
    await repo.listarPorMensajero({ mensajeroId: "m1", page: 1, pageSize: 20, cierreId: "c1", desde, hasta });

    const arg = prisma.pagoMensajeroMovimiento.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      mensajeroId: "m1",
      origenTipo: "cierre_dia",
      origenId: "c1",
      fechaMovimiento: { gte: desde, lte: hasta },
    });
  });
});

describe("PagoMensajeroMovimientoRepository.agregarCuentaPorPagar (R14/R20)", () => {
  it("R14/R20: groupBy tipo acotado a mensajero_id -> devengado/pagado STRING", async () => {
    const prisma = buildPrisma();
    prisma.pagoMensajeroMovimiento.groupBy.mockResolvedValue([
      { tipo: "devengo", _sum: { monto: new Prisma.Decimal("1000.00") } },
      { tipo: "pago", _sum: { monto: new Prisma.Decimal("300.00") } },
    ]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    const r = await repo.agregarCuentaPorPagar("m1", {});

    const arg = prisma.pagoMensajeroMovimiento.groupBy.mock.calls[0][0];
    expect(arg.by).toEqual(["tipo"]);
    expect(arg.where).toEqual({ mensajeroId: "m1" }); // R20: acotado en el WHERE
    expect(r).toEqual({ devengado: "1000.00", pagado: "300.00" });
    expect(typeof r.devengado).toBe("string");
  });

  it("sin movimientos -> devengado/pagado 0.00", async () => {
    const prisma = buildPrisma();
    prisma.pagoMensajeroMovimiento.groupBy.mockResolvedValue([]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);
    const r = await repo.agregarCuentaPorPagar("m1", {});
    expect(r).toEqual({ devengado: "0.00", pagado: "0.00" });
  });
});

describe("PagoMensajeroMovimientoRepository.listarCuentasPorPagarTodos (R18)", () => {
  it("una fila por mensajero con nombre + totales devengado/pagado agregados", async () => {
    const prisma = buildPrisma();
    prisma.pagoMensajeroMovimiento.groupBy.mockResolvedValue([
      { mensajeroId: "m1", tipo: "devengo", _sum: { monto: new Prisma.Decimal("1000.00") } },
      { mensajeroId: "m1", tipo: "pago", _sum: { monto: new Prisma.Decimal("300.00") } },
      { mensajeroId: "m2", tipo: "devengo", _sum: { monto: new Prisma.Decimal("500.00") } },
    ]);
    prisma.usuario.findMany.mockResolvedValue([
      { id: "m1", nombre: "Ana Mensajera" },
      { id: "m2", nombre: "Beto Motos" },
    ]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    const rows = await repo.listarCuentasPorPagarTodos();

    const byId = Object.fromEntries(rows.map((r) => [r.mensajeroId, r]));
    expect(byId.m1).toEqual({ mensajeroId: "m1", mensajeroNombre: "Ana Mensajera", devengado: "1000.00", pagado: "300.00" });
    // m2 solo devengo -> pagado 0.00 (cuenta por pagar = todo el devengo, lo deriva el service).
    expect(byId.m2).toEqual({ mensajeroId: "m2", mensajeroNombre: "Beto Motos", devengado: "500.00", pagado: "0.00" });
    // solo consulta nombres de los mensajeros con movimientos.
    expect(prisma.usuario.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["m1", "m2"] } });
  });

  it("sin movimientos -> [] sin consultar usuarios", async () => {
    const prisma = buildPrisma();
    prisma.pagoMensajeroMovimiento.groupBy.mockResolvedValue([]);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);
    const rows = await repo.listarCuentasPorPagarTodos();
    expect(rows).toEqual([]);
    expect(prisma.usuario.findMany).not.toHaveBeenCalled();
  });
});

describe("PagoMensajeroMovimientoRepository.obtenerNombreMensajero (R18)", () => {
  it("devuelve el nombre del mensajero (vista del maestro: desglose por cierre)", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue({ nombre: "Ana Mensajera" });
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);

    const nombre = await repo.obtenerNombreMensajero("m1");

    expect(nombre).toBe("Ana Mensajera");
    const arg = prisma.usuario.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "m1" });
    expect(arg.select).toEqual({ nombre: true });
  });

  it("mensajero inexistente -> null", async () => {
    const prisma = buildPrisma();
    prisma.usuario.findUnique.mockResolvedValue(null);
    const repo = new PagoMensajeroMovimientoRepository(prisma as unknown as PrismaClient);
    expect(await repo.obtenerNombreMensajero("nope")).toBeNull();
  });
});
