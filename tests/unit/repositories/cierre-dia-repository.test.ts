import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";

// Feature 37 — tests unit del repositorio del cierre (mockea Prisma, sin DB real,
// patron orden-repository.asignacion.test.ts). Cubre R3 (solo cierre_id IS NULL),
// R10 (conteo de pendientes), R12 (existe solicitado) y R13/R14 (crear + vincular +
// snapshot). Money-safe: Decimal se serializa a STRING toFixed(2).

function detalleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido: new Prisma.Decimal("12.50"),
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: "o1/entregada-1.jpg",
    orden: {
      numGuia: 10,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
      tienda: { nombre: "Tienda X" },
      zona: { nombre: "Cartago" },
      provincia: { nombre: "Cartago" },
      canton: { nombre: "Central" },
      distrito: { nombre: "Oriental" },
    },
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    gestionOrden: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    orden: { count: vi.fn() },
    cierreDia: { count: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
}

describe("CierreDiaRepository.findGestionesPendientes (R2/R3)", () => {
  it("R3: filtra por mensajeroId y cierreId:null; ordena por createdAt desc", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.findGestionesPendientes("m1");

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ mensajeroId: "m1", cierreId: null });
    expect(arg.orderBy).toMatchObject({ createdAt: "desc" });
  });

  it("R4/R9: mapea el detalle y serializa montoRecibido Decimal -> string toFixed(2)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([
      detalleRow(),
      detalleRow({
        id: "g2",
        resultado: "reprogramada",
        montoRecibido: null,
        metodoPago: null,
        motivo: "cliente ausente",
        fechaReprogramacion: new Date("2026-07-20T00:00:00.000Z"),
        evidenciaStoragePath: null,
        orden: { ...detalleRow().orden, distrito: null },
      }),
    ]);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findGestionesPendientes("m1");

    expect(rows[0]).toMatchObject({
      gestionId: "g1",
      ordenId: "o1",
      resultado: "entregada",
      montoRecibido: "12.50", // STRING, no number
      metodoPago: "efectivo",
      zonaNombre: "Cartago",
      tiendaNombre: "Tienda X",
      evidenciaStoragePath: "o1/entregada-1.jpg",
    });
    expect(typeof rows[0].montoRecibido).toBe("string");
    expect(rows[1]).toMatchObject({
      resultado: "reprogramada",
      montoRecibido: null,
      metodoPago: null,
      motivo: "cliente ausente",
      fechaReprogramacion: "2026-07-20", // ISO date
      distritoNombre: null,
    });
  });
});

describe("CierreDiaRepository.contarOrdenesPendientesGestion (R10)", () => {
  it("cuenta ordenes del mensajero, no borradas, con estatus.value en los estados", async () => {
    const prisma = buildPrisma();
    prisma.orden.count.mockResolvedValue(2);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const n = await repo.contarOrdenesPendientesGestion("m1", ["en_espera_aceptacion", "en_reparto"]);

    expect(n).toBe(2);
    const arg = prisma.orden.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      mensajeroAsignadoId: "m1",
      deletedAt: null,
      estatus: { value: { in: ["en_espera_aceptacion", "en_reparto"] } },
    });
  });

  it("devuelve 0 sin consultar cuando estados esta vacio", async () => {
    const prisma = buildPrisma();
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const n = await repo.contarOrdenesPendientesGestion("m1", []);

    expect(n).toBe(0);
    expect(prisma.orden.count).not.toHaveBeenCalled();
  });
});

describe("CierreDiaRepository.existeCierreSolicitado (R12)", () => {
  it("true si hay un cierre solicitado del mensajero", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(1);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const r = await repo.existeCierreSolicitado("m1");

    expect(r).toBe(true);
    const arg = prisma.cierreDia.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({ mensajeroId: "m1", estado: "solicitado" });
  });

  it("false si no hay ninguno", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(0);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    expect(await repo.existeCierreSolicitado("m1")).toBe(false);
  });
});

describe("CierreDiaRepository.crearCierre (R13/R14)", () => {
  it("en $transaction: INSERT cierre_dia (Decimal snapshot) + vincular gestiones pendientes; devuelve id", async () => {
    const tx = {
      cierreDia: { create: vi.fn(async () => ({ id: "c1" })) },
      gestionOrden: { updateMany: vi.fn(async () => ({ count: 3 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const id = await repo.crearCierre({
      mensajeroId: "m1",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z1",
      totales: { efectivo: "10.00", simpe: "0.00", transferencia: "5.50", general: "15.50" },
    });

    expect(id).toBe("c1");

    // R14: totales snapshot como Prisma.Decimal.
    const createArg = (tx.cierreDia.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      mensajeroId: "m1",
      estado: "solicitado",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z1",
    });
    expect(createArg.data.totalEfectivo).toBeInstanceOf(Prisma.Decimal);
    expect(createArg.data.totalGeneral.toFixed(2)).toBe("15.50");

    // R13: vincula SOLO las gestiones sin cierre del propio mensajero (guardia).
    const updArg = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updArg.where).toMatchObject({ mensajeroId: "m1", cierreId: null });
    expect(updArg.data).toMatchObject({ cierreId: "c1" });
  });
});

describe("CierreDiaRepository.findCierresByMensajero (R18)", () => {
  it("mapea cada cierre con totales STRING toFixed(2) y solicitadoAt ISO, mas reciente primero", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([
      {
        id: "c1",
        estado: "solicitado",
        destinoTipo: "bodega_central",
        destinoZonaId: "z-central",
        totalEfectivo: new Prisma.Decimal("10.00"),
        totalSimpe: new Prisma.Decimal("0"),
        totalTransferencia: new Prisma.Decimal("5.5"),
        totalGeneral: new Prisma.Decimal("15.5"),
        solicitadoAt: new Date("2026-07-12T10:00:00.000Z"),
      },
    ]);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCierresByMensajero("m1");

    expect(prisma.cierreDia.findMany.mock.calls[0][0].where).toMatchObject({ mensajeroId: "m1" });
    expect(prisma.cierreDia.findMany.mock.calls[0][0].orderBy).toMatchObject({ solicitadoAt: "desc" });
    expect(rows[0]).toEqual({
      cierreId: "c1",
      estado: "solicitado",
      destinoTipo: "bodega_central",
      destinoZonaId: "z-central",
      totales: { efectivo: "10.00", simpe: "0.00", transferencia: "5.50", general: "15.50" },
      solicitadoAt: "2026-07-12T10:00:00.000Z",
    });
  });
});
