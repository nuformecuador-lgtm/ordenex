import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";

// Feature 39 — tests unit del resolver de tarifa (mockea Prisma, sin DB real, patron
// cierre-dia-repository.test.ts). Cubre R1 (tarifa exacta por zona+vehiculo), R2
// (fallback a la tarifa por defecto vehiculo_id NULL), R3 (mensajero sin vehiculo ->
// tarifa por defecto) y R8 (zona sin tarifa -> null). Money-safe: Decimal -> STRING.

function tarifaRow(overrides: Record<string, unknown> = {}) {
  return {
    cobroEntregado: new Prisma.Decimal("5.5"),
    cobroRechazado: new Prisma.Decimal("3"),
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    tarifaZonaMensajero: { findUnique: vi.fn(), findFirst: vi.fn() },
    ...overrides,
  };
}

describe("TarifaZonaMensajeroRepository.resolvePagoTarifa (R1)", () => {
  it("R1: con vehiculo y tarifa exacta -> la usa (findUnique por zona_id+vehiculo_id); Decimal->STRING 2 dec", async () => {
    const prisma = buildPrisma();
    prisma.tarifaZonaMensajero.findUnique.mockResolvedValue(tarifaRow());
    const repo = new TarifaZonaMensajeroRepository(prisma as unknown as PrismaClient);

    const t = await repo.resolvePagoTarifa("z-cartago", "veh-1");

    expect(t).toEqual({ cobroEntregado: "5.50", cobroRechazado: "3.00" });
    expect(typeof t?.cobroEntregado).toBe("string"); // R9/R23
    const arg = prisma.tarifaZonaMensajero.findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ zonaId_vehiculoId: { zonaId: "z-cartago", vehiculoId: "veh-1" } });
    // no cae al fallback si la exacta existe.
    expect(prisma.tarifaZonaMensajero.findFirst).not.toHaveBeenCalled();
  });
});

describe("TarifaZonaMensajeroRepository.resolvePagoTarifa (R2)", () => {
  it("R2: con vehiculo pero SIN tarifa exacta -> fallback a la por defecto (vehiculo_id NULL)", async () => {
    const prisma = buildPrisma();
    prisma.tarifaZonaMensajero.findUnique.mockResolvedValue(null); // no hay especifica
    prisma.tarifaZonaMensajero.findFirst.mockResolvedValue(
      tarifaRow({ cobroEntregado: new Prisma.Decimal("4"), cobroRechazado: new Prisma.Decimal("2") }),
    );
    const repo = new TarifaZonaMensajeroRepository(prisma as unknown as PrismaClient);

    const t = await repo.resolvePagoTarifa("z-cartago", "veh-1");

    expect(t).toEqual({ cobroEntregado: "4.00", cobroRechazado: "2.00" });
    const arg = prisma.tarifaZonaMensajero.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ zonaId: "z-cartago", vehiculoId: null }); // tarifa por defecto
  });
});

describe("TarifaZonaMensajeroRepository.resolvePagoTarifa (R3)", () => {
  it("R3: mensajero sin vehiculo (vehiculoId null) -> resuelve directamente la tarifa por defecto, sin findUnique", async () => {
    const prisma = buildPrisma();
    prisma.tarifaZonaMensajero.findFirst.mockResolvedValue(tarifaRow());
    const repo = new TarifaZonaMensajeroRepository(prisma as unknown as PrismaClient);

    const t = await repo.resolvePagoTarifa("z-cartago", null);

    expect(t).toEqual({ cobroEntregado: "5.50", cobroRechazado: "3.00" });
    // sin vehiculo no se intenta la exacta.
    expect(prisma.tarifaZonaMensajero.findUnique).not.toHaveBeenCalled();
    expect(prisma.tarifaZonaMensajero.findFirst.mock.calls[0][0].where).toEqual({
      zonaId: "z-cartago",
      vehiculoId: null,
    });
  });
});

describe("TarifaZonaMensajeroRepository.resolvePagoTarifa (R8)", () => {
  it("R8: zona sin ninguna tarifa (ni especifica ni por defecto) -> null (gap de datos, no lanza)", async () => {
    const prisma = buildPrisma();
    prisma.tarifaZonaMensajero.findUnique.mockResolvedValue(null);
    prisma.tarifaZonaMensajero.findFirst.mockResolvedValue(null);
    const repo = new TarifaZonaMensajeroRepository(prisma as unknown as PrismaClient);

    expect(await repo.resolvePagoTarifa("z-sin-tarifa", "veh-1")).toBeNull();
    expect(await repo.resolvePagoTarifa("z-sin-tarifa", null)).toBeNull();
  });
});
