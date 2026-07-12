import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierreBodegaRepository } from "@/lib/repositories/CierreBodegaRepository";

// Feature 40 — tests unit del CierreBodegaRepository (mockea Prisma, sin DB real,
// patron cierre-dia-repository.test.ts). Cubre R5 (WHERE consolidables), R9
// (crearCierreBodega: $transaction INSERT + updateMany con guardia; atomico), R10
// (totales -> Prisma.Decimal), R8 (P2002 se propaga como senal de conflict).

function consolidableDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cd1",
    mensajeroId: "m1",
    totalEfectivo: new Prisma.Decimal("10"),
    totalSimpe: new Prisma.Decimal("5.5"),
    totalTransferencia: new Prisma.Decimal("0"),
    totalGeneral: new Prisma.Decimal("15.5"),
    totalPagoMensajero: new Prisma.Decimal("5"), // feature 39/R18: snapshot del pago
    mensajero: { nombre: "Ana Mensajera" },
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    cierreDia: { findMany: vi.fn(), count: vi.fn() },
    cierreBodega: { count: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
}

describe("CierreBodegaRepository.findCierresDiaConsolidables (R5/R10)", () => {
  it("R5: WHERE aprobado + bodega_satelite + destino_zona_id + cierre_bodega_id null", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    await repo.findCierresDiaConsolidables("z-cartago");

    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      estado: "aprobado",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-cartago",
      cierreBodegaId: null,
    });
  });

  it("R10: mapea mensajero + totales snapshot -> STRING toFixed(2)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([consolidableDbRow()]);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCierresDiaConsolidables("z-cartago");

    expect(rows[0]).toEqual({
      cierreDiaId: "cd1",
      mensajeroId: "m1",
      mensajeroNombre: "Ana Mensajera",
      totales: { efectivo: "10.00", simpe: "5.50", transferencia: "0.00", general: "15.50" },
      totalPagoMensajero: "5.00", // feature 39/R18: snapshot money-safe STRING
    });
    expect(typeof rows[0].totales.general).toBe("string");
    expect(typeof rows[0].totalPagoMensajero).toBe("string");
  });
});

describe("CierreBodegaRepository.contarCierresDiaSolicitados (R6)", () => {
  it("cuenta cierre_dia de la zona en estado solicitado (destino satelite)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(3);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    const n = await repo.contarCierresDiaSolicitados("z-cartago");

    expect(n).toBe(3);
    expect(prisma.cierreDia.count.mock.calls[0][0].where).toEqual({
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-cartago",
      estado: "solicitado",
    });
  });
});

describe("CierreBodegaRepository.existeCierreBodegaSolicitado (R8)", () => {
  it("true si hay un cierre de bodega solicitado de la zona", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.count.mockResolvedValue(1);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    expect(await repo.existeCierreBodegaSolicitado("z-cartago")).toBe(true);
    expect(prisma.cierreBodega.count.mock.calls[0][0].where).toEqual({
      zonaId: "z-cartago",
      estado: "solicitado",
    });
  });
});

describe("CierreBodegaRepository.crearCierreBodega (R9/R10/R8)", () => {
  it("R9/R10: $transaction INSERT (Decimal snapshot) + updateMany con guardia; devuelve id", async () => {
    const tx = {
      cierreBodega: { create: vi.fn(async () => ({ id: "cb1" })) },
      cierreDia: { updateMany: vi.fn(async () => ({ count: 2 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    const id = await repo.crearCierreBodega({
      zonaId: "z-cartago",
      solicitadoPor: "adm-sat",
      cierreDiaIds: ["cd1", "cd2"],
      totales: { efectivo: "10.01", simpe: "5.55", transferencia: "100.44", general: "116.00" },
      totalPagoMensajero: "10.75", // feature 39/R19: snapshot agregado del pago
    });

    expect(id).toBe("cb1");

    // R10: totales snapshot como Prisma.Decimal.
    const createArg = (tx.cierreBodega.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      zonaId: "z-cartago",
      solicitadoPor: "adm-sat",
      estado: "solicitado",
    });
    expect(createArg.data.totalEfectivo).toBeInstanceOf(Prisma.Decimal);
    expect(createArg.data.totalGeneral.toFixed(2)).toBe("116.00");
    // R19: snapshot agregado del pago a mensajeros como Prisma.Decimal.
    expect(createArg.data.totalPagoMensajero).toBeInstanceOf(Prisma.Decimal);
    expect(createArg.data.totalPagoMensajero.toFixed(2)).toBe("10.75");

    // R9: vincula SOLO los consolidables de la zona (guardia concurrencia-segura).
    const updArg = (tx.cierreDia.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updArg.where).toEqual({
      id: { in: ["cd1", "cd2"] },
      cierreBodegaId: null,
      estado: "aprobado",
      destinoZonaId: "z-cartago",
    });
    expect(updArg.data).toEqual({ cierreBodegaId: "cb1" });
  });

  it("R8: una violacion del indice unico parcial (P2002) se propaga (senal de conflict)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique violation", {
      code: "P2002",
      clientVersion: "test",
    });
    const tx = {
      cierreBodega: {
        create: vi.fn(async () => {
          throw p2002;
        }),
      },
      cierreDia: { updateMany: vi.fn() },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    await expect(
      repo.crearCierreBodega({
        zonaId: "z-cartago",
        solicitadoPor: "adm-sat",
        cierreDiaIds: ["cd1"],
        totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
        totalPagoMensajero: "0.00",
      }),
    ).rejects.toBe(p2002);
    // no llega a vincular si la INSERT fallo.
    expect(tx.cierreDia.updateMany).not.toHaveBeenCalled();
  });
});

describe("CierreBodegaRepository.findCierresBodegaByZona (F1.4-h)", () => {
  it("filtra por zona, orderBy solicitadoAt desc, totales STRING + cantidadCierres del _count", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findMany.mockResolvedValue([
      {
        id: "cb1",
        zonaId: "z-cartago",
        solicitadoPor: "adm-sat",
        estado: "aprobado",
        totalEfectivo: new Prisma.Decimal("10"),
        totalSimpe: new Prisma.Decimal("0"),
        totalTransferencia: new Prisma.Decimal("5.5"),
        totalGeneral: new Prisma.Decimal("15.5"),
        totalPagoMensajero: new Prisma.Decimal("7.5"), // feature 39/R19/R20: snapshot agregado
        solicitadoAt: new Date("2026-07-12T10:00:00.000Z"),
        resueltoAt: new Date("2026-07-12T12:00:00.000Z"),
        motivoRechazo: null,
        zona: { nombre: "Cartago" },
        solicitadoPorUsuario: { nombre: "Sara Satelite" },
        _count: { cierresDia: 3 },
      },
    ]);
    const repo = new CierreBodegaRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCierresBodegaByZona("z-cartago");

    expect(prisma.cierreBodega.findMany.mock.calls[0][0].where).toEqual({ zonaId: "z-cartago" });
    expect(prisma.cierreBodega.findMany.mock.calls[0][0].orderBy).toMatchObject({ solicitadoAt: "desc" });
    expect(rows[0]).toEqual({
      cierreBodegaId: "cb1",
      zonaId: "z-cartago",
      zonaNombre: "Cartago",
      solicitadoPorId: "adm-sat",
      solicitadoPorNombre: "Sara Satelite",
      estado: "aprobado",
      totales: { efectivo: "10.00", simpe: "0.00", transferencia: "5.50", general: "15.50" },
      totalPagoMensajero: "7.50", // feature 39/R19/R20: snapshot money-safe STRING
      cantidadCierres: 3,
      solicitadoAt: "2026-07-12T10:00:00.000Z",
      resueltoAt: "2026-07-12T12:00:00.000Z",
      motivoRechazo: null,
    });
  });
});
