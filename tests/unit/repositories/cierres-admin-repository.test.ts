import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";

// Feature 38 — tests unit del CierresAdminRepository (mockea Prisma, sin DB real,
// patron cierre-dia-repository.test.ts). Cubre R2/R4/R5 (findCierresByAlcance con
// alcance en el WHERE), R10/R14 (resolverCierre aprobar/rechazar -> updated + audit),
// R12 (conflict), R13 (fuera_de_alcance), R15 (no toca gestion_orden).

const ALCANCE_MAESTRO: Alcance = { destinoTipo: "bodega_central", destinoZonaId: null };
const ALCANCE_SAT: Alcance = { destinoTipo: "bodega_satelite", destinoZonaId: "z-cartago" };

function cierreResumenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    mensajeroId: "m1",
    estado: "solicitado",
    destinoTipo: "bodega_central",
    destinoZonaId: "z-central",
    totalEfectivo: new Prisma.Decimal("10"),
    totalSimpe: new Prisma.Decimal("5.5"),
    totalTransferencia: new Prisma.Decimal("0"),
    totalGeneral: new Prisma.Decimal("15.5"),
    totalPagoMensajero: new Prisma.Decimal("5"), // feature 39/R17: snapshot del pago
    totalIngresoBodegaRechazos: new Prisma.Decimal("3"), // feature 56/R16: snapshot del ingreso
    solicitadoAt: new Date("2026-07-12T10:00:00.000Z"),
    resueltoAt: null,
    motivoRechazo: null,
    mensajero: { nombre: "Ana Mensajera" },
    destinoZona: { nombre: "Central" },
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    cierreDia: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    gestionOrden: { findMany: vi.fn() },
    ...overrides,
  };
}

describe("CierresAdminRepository.findCierresByAlcance (R2/R4/R5)", () => {
  it("R2: maestro -> WHERE solo destino_tipo=bodega_central (SIN destinoZonaId); orderBy solicitadoAt desc", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    await repo.findCierresByAlcance(ALCANCE_MAESTRO);

    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ destinoTipo: "bodega_central" });
    expect(arg.where).not.toHaveProperty("destinoZonaId"); // el maestro no se acota por zona
    expect(arg.orderBy).toMatchObject({ solicitadoAt: "desc" });
  });

  it("R2: adminSatelite -> WHERE destino_tipo=bodega_satelite AND destino_zona_id=su zona", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    await repo.findCierresByAlcance(ALCANCE_SAT);

    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ destinoTipo: "bodega_satelite", destinoZonaId: "z-cartago" });
  });

  it("R4/R5/R9: mapea cabecera con totales STRING toFixed(2), resueltoAt ISO|null", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([
      cierreResumenRow(),
      cierreResumenRow({
        id: "c2",
        estado: "aprobado",
        resueltoAt: new Date("2026-07-12T12:00:00.000Z"),
      }),
    ]);
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    const rows = await repo.findCierresByAlcance(ALCANCE_MAESTRO);

    expect(rows[0]).toEqual({
      cierreId: "c1",
      mensajeroId: "m1",
      mensajeroNombre: "Ana Mensajera",
      estado: "solicitado",
      destinoTipo: "bodega_central",
      destinoZonaId: "z-central",
      destinoZonaNombre: "Central",
      totales: { efectivo: "10.00", simpe: "5.50", transferencia: "0.00", general: "15.50" },
      totalPagoMensajero: "5.00", // feature 39/R17: snapshot money-safe STRING
      totalIngresoBodegaRechazos: "3.00", // feature 56/R16: snapshot money-safe STRING
      solicitadoAt: "2026-07-12T10:00:00.000Z",
      resueltoAt: null,
      motivoRechazo: null,
    });
    expect(typeof rows[0].totales.general).toBe("string");
    expect(rows[1].resueltoAt).toBe("2026-07-12T12:00:00.000Z");
    expect(rows[1].estado).toBe("aprobado");
  });
});

describe("CierresAdminRepository.findCierreByIdEnAlcance (R6/R13)", () => {
  it("R13: cierre WHERE id + alcance; si no casa -> null, sin cargar gestiones", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(null);
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.findCierreByIdEnAlcance("c-ajeno", ALCANCE_SAT);

    expect(r).toBeNull();
    const arg = prisma.cierreDia.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "c-ajeno", destinoTipo: "bodega_satelite", destinoZonaId: "z-cartago" });
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
  });

  it("R6: cierre en alcance -> carga gestiones WHERE cierre_id = X y las mapea", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    prisma.gestionOrden.findMany.mockResolvedValue([
      {
        id: "g1",
        ordenId: "o1",
        resultado: "entregada",
        montoRecibido: new Prisma.Decimal("12.50"),
        metodoPago: "efectivo",
        motivo: null,
        fechaReprogramacion: null,
        evidenciaStoragePath: "o1/e.jpg",
        pagoMensajero: new Prisma.Decimal("5.00"), // feature 39/R16: snapshot leido
        ingresoBodegaRechazo: new Prisma.Decimal("0.00"), // feature 56/R15: snapshot leido
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
      },
    ]);
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    expect(r).not.toBeNull();
    expect(prisma.gestionOrden.findMany.mock.calls[0][0].where).toEqual({ cierreId: "c1" });
    expect(r?.cierre.cierreId).toBe("c1");
    expect(r?.gestiones[0]).toMatchObject({
      gestionId: "g1",
      montoRecibido: "12.50",
      evidenciaStoragePath: "o1/e.jpg",
    });
  });
});

describe("CierresAdminRepository.resolverCierre (R10/R12/R13/R14/R15)", () => {
  it("R10/R14: updateMany count=1 -> updated; WHERE guarda estado=solicitado + alcance; data lleva audit", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_SAT,
      nuevoEstado: "rechazado",
      resueltoPor: "adm-sat",
      motivoRechazo: "cuadre erroneo",
    });

    expect(r).toBe("updated");
    const arg = prisma.cierreDia.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      id: "c1",
      estado: { in: ["solicitado", "vencido"] }, // R12 + feature 41/R19: origenes resolubles
      destinoTipo: "bodega_satelite", // R13: guardia de alcance
      destinoZonaId: "z-cartago",
    });
    expect(arg.data).toMatchObject({
      estado: "rechazado",
      resueltoPor: "adm-sat", // R14
      motivoRechazo: "cuadre erroneo",
    });
    expect(arg.data.resueltoAt).toBeInstanceOf(Date); // R14
    // R15: no toca gestion_orden ni cuenta cuando ya actualizo.
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
    expect(prisma.cierreDia.count).not.toHaveBeenCalled();
  });

  it("R14: aprobar pasa motivoRechazo null en el data", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    const arg = prisma.cierreDia.updateMany.mock.calls[0][0];
    expect(arg.data.estado).toBe("aprobado");
    expect(arg.data.motivoRechazo).toBeNull();
    // el maestro no se acota por zona en el WHERE.
    expect(arg.where).toEqual({
      id: "c1",
      estado: { in: ["solicitado", "vencido"] },
      destinoTipo: "bodega_central",
    });
  });

  it("feature 41/R19/R15: un vencido es origen resoluble; aprobar/rechazar transiciona y desbloquea", async () => {
    const prisma = buildPrisma();
    // El vencido sigue en un estado resoluble -> updateMany afecta 1 fila.
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierre({
      cierreId: "c-vencido",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("updated"); // R15: resolverlo lo saca de los estados bloqueantes
    const arg = prisma.cierreDia.updateMany.mock.calls[0][0];
    // R19: la guardia acepta solicitado O vencido como origen.
    expect(arg.where.estado).toEqual({ in: ["solicitado", "vencido"] });
    // R4: la transicion NO recalcula totales (solo estado + auditoria).
    expect(arg.data).not.toHaveProperty("totalGeneral");
    expect(arg.data).not.toHaveProperty("totalEfectivo");
  });

  it("R12: count=0 pero existe en alcance -> conflict, sin efectos", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreDia.count.mockResolvedValue(1); // existe en alcance pero ya no `solicitado`
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("conflict");
    const countArg = prisma.cierreDia.count.mock.calls[0][0];
    expect(countArg.where).toEqual({ id: "c1", destinoTipo: "bodega_satelite", destinoZonaId: "z-cartago" });
    expect(countArg.where).not.toHaveProperty("estado"); // sin guardia de estado, solo alcance
  });

  it("R13: count=0 y no existe en alcance -> fuera_de_alcance", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreDia.count.mockResolvedValue(0);
    const repo = new CierresAdminRepository(prisma as unknown as PrismaClient);

    const r = await repo.resolverCierre({
      cierreId: "c-ajeno",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("fuera_de_alcance");
  });
});
