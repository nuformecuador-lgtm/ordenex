import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierresBodegaAdminRepository } from "@/lib/repositories/CierresBodegaAdminRepository";

// Feature 40 — tests unit del CierresBodegaAdminRepository (mockea Prisma, sin DB real).
// Cubre R15 (findCierresBodega orderBy desc + totales string), R11
// (findCierreBodegaConDetalle: WITH_DETALLE + WHERE cierre_id por cada cierre_dia),
// R16/R18 (resolverCierreBodega: updateMany WHERE estado='solicitado'; count 1->updated;
// 0+existe->conflict; 0+no existe->fuera_de_alcance), R21/R22 (solo toca cierre_bodega).

function bodegaDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cb1",
    zonaId: "z-cartago",
    solicitadoPor: "adm-sat",
    estado: "solicitado",
    totalEfectivo: new Prisma.Decimal("10"),
    totalSimpe: new Prisma.Decimal("5.5"),
    totalTransferencia: new Prisma.Decimal("0"),
    totalGeneral: new Prisma.Decimal("15.5"),
    solicitadoAt: new Date("2026-07-12T10:00:00.000Z"),
    resueltoAt: null,
    motivoRechazo: null,
    zona: { nombre: "Cartago" },
    solicitadoPorUsuario: { nombre: "Sara Satelite" },
    _count: { cierresDia: 2 },
    ...overrides,
  };
}

function detalleCierreDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cd1",
    mensajeroId: "m1",
    totalEfectivo: new Prisma.Decimal("10"),
    totalSimpe: new Prisma.Decimal("0"),
    totalTransferencia: new Prisma.Decimal("0"),
    totalGeneral: new Prisma.Decimal("10"),
    mensajero: { nombre: "Ana Mensajera" },
    ...overrides,
  };
}

function gestionDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1",
    ordenId: "o1",
    resultado: "entregada",
    montoRecibido: new Prisma.Decimal("10.00"),
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaStoragePath: "o1/e.jpg",
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
    cierreBodega: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    cierreDia: { findMany: vi.fn() },
    gestionOrden: { findMany: vi.fn() },
    ...overrides,
  };
}

describe("CierresBodegaAdminRepository.findCierresBodega (R15)", () => {
  it("R15: todos, orderBy solicitadoAt desc, totales STRING + cantidadCierres del _count", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findMany.mockResolvedValue([bodegaDbRow()]);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCierresBodega();

    const arg = prisma.cierreBodega.findMany.mock.calls[0][0];
    expect(arg.orderBy).toMatchObject({ solicitadoAt: "desc" });
    expect(arg).not.toHaveProperty("where"); // el maestro no se acota por zona
    expect(rows[0]).toEqual({
      cierreBodegaId: "cb1",
      zonaId: "z-cartago",
      zonaNombre: "Cartago",
      solicitadoPorId: "adm-sat",
      solicitadoPorNombre: "Sara Satelite",
      estado: "solicitado",
      totales: { efectivo: "10.00", simpe: "5.50", transferencia: "0.00", general: "15.50" },
      cantidadCierres: 2,
      solicitadoAt: "2026-07-12T10:00:00.000Z",
      resueltoAt: null,
      motivoRechazo: null,
    });
    expect(typeof rows[0].totales.general).toBe("string");
  });
});

describe("CierresBodegaAdminRepository.findCierreBodegaConDetalle (R11/R19)", () => {
  it("R19: cierre de bodega inexistente -> null, sin cargar cierre_dia ni gestiones", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findUnique.mockResolvedValue(null);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.findCierreBodegaConDetalle("cb-x");

    expect(r).toBeNull();
    expect(prisma.cierreBodega.findUnique.mock.calls[0][0].where).toEqual({ id: "cb-x" });
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
  });

  it("R11: por cada cierre_dia (WHERE cierre_bodega_id=id) carga gestiones WHERE cierre_id=cd.id (WITH_DETALLE) y mapea", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.findUnique.mockResolvedValue(bodegaDbRow());
    prisma.cierreDia.findMany.mockResolvedValue([
      detalleCierreDbRow({ id: "cd1" }),
      detalleCierreDbRow({ id: "cd2", mensajeroId: "m2", mensajero: { nombre: "Beto" } }),
    ]);
    prisma.gestionOrden.findMany
      .mockResolvedValueOnce([gestionDbRow({ id: "g1" })])
      .mockResolvedValueOnce([gestionDbRow({ id: "g2", resultado: "devuelta", montoRecibido: null, metodoPago: null, evidenciaStoragePath: null })]);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.findCierreBodegaConDetalle("cb1");

    expect(r).not.toBeNull();
    // los cierre_dia se buscan por cierre_bodega_id.
    expect(prisma.cierreDia.findMany.mock.calls[0][0].where).toEqual({ cierreBodegaId: "cb1" });
    // una llamada de gestiones por cada cierre_dia, WHERE cierre_id = cd.id.
    expect(prisma.gestionOrden.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.gestionOrden.findMany.mock.calls[0][0].where).toEqual({ cierreId: "cd1" });
    expect(prisma.gestionOrden.findMany.mock.calls[1][0].where).toEqual({ cierreId: "cd2" });
    expect(r?.cierre.cierreBodegaId).toBe("cb1");
    expect(r?.cierresDia.map((cd) => cd.resumen.cierreDiaId)).toEqual(["cd1", "cd2"]);
    expect(r?.cierresDia[0].gestiones[0]).toMatchObject({
      gestionId: "g1",
      montoRecibido: "10.00",
      evidenciaStoragePath: "o1/e.jpg",
    });
    expect(r?.cierresDia[1].gestiones[0].gestionId).toBe("g2");
  });
});

describe("CierresBodegaAdminRepository.resolverCierreBodega (R16/R18/R19/R20/R21/R22)", () => {
  it("R16/R20/R21/R22: count=1 -> updated; WHERE guarda estado=solicitado; data lleva audit; NO toca cierre_dia/gestion", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierreBodega({
      id: "cb1",
      nuevoEstado: "rechazado",
      resueltoPor: "adm-maestro",
      motivoRechazo: "cuadre erroneo",
    });

    expect(r).toBe("updated");
    const arg = prisma.cierreBodega.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "cb1", estado: "solicitado" }); // R18: guardia de estado
    expect(arg.data).toMatchObject({
      estado: "rechazado",
      resueltoPor: "adm-maestro", // R20
      motivoRechazo: "cuadre erroneo",
    });
    expect(arg.data.resueltoAt).toBeInstanceOf(Date); // R20
    // R21/R22: un solo UPDATE de estado; no toca cierre_dia ni gestion_orden ni cuenta.
    expect(prisma.cierreDia.findMany).not.toHaveBeenCalled();
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
    expect(prisma.cierreBodega.count).not.toHaveBeenCalled();
  });

  it("R20: aprobar pasa motivoRechazo null en el data", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    await repo.resolverCierreBodega({
      id: "cb1",
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    const arg = prisma.cierreBodega.updateMany.mock.calls[0][0];
    expect(arg.data.estado).toBe("aprobado");
    expect(arg.data.motivoRechazo).toBeNull();
  });

  it("R18: count=0 pero existe -> conflict, sin efectos", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreBodega.count.mockResolvedValue(1);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierreBodega({
      id: "cb1",
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    expect(r).toBe("conflict");
    expect(prisma.cierreBodega.count.mock.calls[0][0].where).toEqual({ id: "cb1" });
  });

  it("R19: count=0 y no existe -> fuera_de_alcance", async () => {
    const prisma = buildPrisma();
    prisma.cierreBodega.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreBodega.count.mockResolvedValue(0);
    const repo = new CierresBodegaAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierreBodega({
      id: "cb-x",
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    expect(r).toBe("fuera_de_alcance");
  });
});
