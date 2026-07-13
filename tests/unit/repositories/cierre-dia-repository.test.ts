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
    pagoMensajero: null, // feature 39: snapshot (null salvo override)
    ingresoBodegaRechazo: null, // feature 56: snapshot (null salvo override)
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
      detalleRow({ pagoMensajero: new Prisma.Decimal("5.00"), ingresoBodegaRechazo: new Prisma.Decimal("3.00") }), // feature 39/56: snapshots presentes
      detalleRow({
        id: "g2",
        resultado: "reprogramada",
        montoRecibido: null,
        metodoPago: null,
        motivo: "cliente ausente",
        fechaReprogramacion: new Date("2026-07-20T00:00:00.000Z"),
        evidenciaStoragePath: null,
        pagoMensajero: null, // feature 39: aun sin cerrar / snapshot ausente
        ingresoBodegaRechazo: null, // feature 56: aun sin cerrar / snapshot ausente
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
      pagoMensajero: "5.00", // feature 39/R23: snapshot Decimal->string
      ingresoBodegaRechazo: "3.00", // feature 56/R22: snapshot Decimal->string
    });
    expect(typeof rows[0].montoRecibido).toBe("string");
    expect(typeof rows[0].pagoMensajero).toBe("string");
    expect(typeof rows[0].ingresoBodegaRechazo).toBe("string");
    expect(rows[1]).toMatchObject({
      resultado: "reprogramada",
      montoRecibido: null,
      metodoPago: null,
      motivo: "cliente ausente",
      fechaReprogramacion: "2026-07-20", // ISO date
      distritoNombre: null,
      pagoMensajero: null, // feature 39: sin snapshot -> null
      ingresoBodegaRechazo: null, // feature 56: sin snapshot -> null
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
  it("en $transaction: INSERT cierre_dia (Decimal snapshot) + vincular gestiones + snapshot pago; devuelve id", async () => {
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
      // Feature 39/R14: pago snapshoteado por gestion (entregada 5.00; resto 0.00) + total.
      pagoByGestionId: { g1: "5.00", g2: "0.00", g3: "0.00" },
      totalPagoMensajero: "5.00",
      // Feature 56/R11/R13: ingreso snapshoteado por gestion (rechazada g2 3.00; resto 0.00) + total.
      ingresoByGestionId: { g1: "0.00", g2: "3.00", g3: "0.00" },
      totalIngresoBodegaRechazos: "3.00",
    });

    expect(id).toBe("c1");

    // R14: totales snapshot + total_pago_mensajero como Prisma.Decimal.
    const createArg = (tx.cierreDia.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      mensajeroId: "m1",
      estado: "solicitado",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z1",
    });
    expect(createArg.data.totalEfectivo).toBeInstanceOf(Prisma.Decimal);
    expect(createArg.data.totalGeneral.toFixed(2)).toBe("15.50");
    expect(createArg.data.totalPagoMensajero).toBeInstanceOf(Prisma.Decimal); // R14
    expect(createArg.data.totalPagoMensajero.toFixed(2)).toBe("5.00");
    // Feature 56/R13: total_ingreso_bodega_rechazos como Prisma.Decimal, en el MISMO INSERT.
    expect(createArg.data.totalIngresoBodegaRechazos).toBeInstanceOf(Prisma.Decimal);
    expect(createArg.data.totalIngresoBodegaRechazos.toFixed(2)).toBe("3.00");

    // R13: la PRIMERA escritura vincula las gestiones sin cierre del propio mensajero.
    const calls = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].where).toMatchObject({ mensajeroId: "m1", cierreId: null });
    expect(calls[0][0].data).toMatchObject({ cierreId: "c1" });

    // R14: luego puebla pago_mensajero AGRUPADO por valor (guardia por cierreId=c1), en la
    // misma tx. Grupo 5.00 -> [g1]; grupo 0.00 -> [g2,g3].
    const pagoCalls = calls.filter((c) => c[0].data.pagoMensajero !== undefined);
    expect(pagoCalls).toHaveLength(2);
    const c5 = pagoCalls.find((c) => c[0].data.pagoMensajero.toFixed(2) === "5.00");
    const c0 = pagoCalls.find((c) => c[0].data.pagoMensajero.toFixed(2) === "0.00");
    expect(c5?.[0].where).toEqual({ id: { in: ["g1"] }, cierreId: "c1" });
    expect(c0?.[0].where).toEqual({ id: { in: ["g2", "g3"] }, cierreId: "c1" });
    expect(c5?.[0].data.pagoMensajero).toBeInstanceOf(Prisma.Decimal);

    // Feature 56/R13: en la MISMA tx puebla ingreso_bodega_rechazo AGRUPADO por valor
    // (guardia por cierreId=c1). Grupo 3.00 -> [g2]; grupo 0.00 -> [g1,g3].
    const ingresoCalls = calls.filter((c) => c[0].data.ingresoBodegaRechazo !== undefined);
    expect(ingresoCalls).toHaveLength(2);
    const i3 = ingresoCalls.find((c) => c[0].data.ingresoBodegaRechazo.toFixed(2) === "3.00");
    const i0 = ingresoCalls.find((c) => c[0].data.ingresoBodegaRechazo.toFixed(2) === "0.00");
    expect(i3?.[0].where).toEqual({ id: { in: ["g2"] }, cierreId: "c1" });
    expect(i0?.[0].where).toEqual({ id: { in: ["g1", "g3"] }, cierreId: "c1" });
    expect(i3?.[0].data.ingresoBodegaRechazo).toBeInstanceOf(Prisma.Decimal);
  });
});

describe("CierreDiaRepository.crearCierre — feature 41/C1 (R8/R9/R23)", () => {
  it("R8: estado='vencido' se propaga al INSERT (mismo snapshot que solicitado)", async () => {
    const tx = {
      cierreDia: { create: vi.fn(async () => ({ id: "cv1" })) },
      gestionOrden: { updateMany: vi.fn(async () => ({ count: 2 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const id = await repo.crearCierre({
      mensajeroId: "m1",
      estado: "vencido",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z1",
      totales: { efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" },
      pagoByGestionId: { g1: "5.00", g2: "0.00" },
      totalPagoMensajero: "5.00",
      ingresoByGestionId: { g1: "0.00", g2: "0.00" },
      totalIngresoBodegaRechazos: "0.00",
    });

    expect(id).toBe("cv1");
    const createArg = (tx.cierreDia.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data.estado).toBe("vencido"); // C1: estado parametrizado
    // vincula las gestiones sin cierre del mensajero (misma tx que solicitado).
    const calls = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].where).toMatchObject({ mensajeroId: "m1", cierreId: null });
  });

  it("default estado='solicitado' cuando no se pasa (retrocompatible con la 37)", async () => {
    const tx = {
      cierreDia: { create: vi.fn(async () => ({ id: "c1" })) },
      gestionOrden: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.crearCierre({
      mensajeroId: "m1",
      destinoTipo: "bodega_central",
      destinoZonaId: "z1",
      totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
      pagoByGestionId: { g1: "0.00" },
      totalPagoMensajero: "0.00",
      ingresoByGestionId: { g1: "0.00" },
      totalIngresoBodegaRechazos: "0.00",
    });

    const createArg = (tx.cierreDia.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data.estado).toBe("solicitado");
  });

  it("R9/R23: si el UPDATE guardado vincula 0 gestiones -> null (rollback), sin poblar snapshot", async () => {
    const tx = {
      cierreDia: { create: vi.fn(async () => ({ id: "cx" })) },
      // vinculacion devuelve 0 (otra solicitud/corte las vinculo primero) -> throw interno.
      gestionOrden: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const id = await repo.crearCierre({
      mensajeroId: "m1",
      estado: "vencido",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z1",
      totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
      pagoByGestionId: { g1: "0.00" },
      totalPagoMensajero: "0.00",
      ingresoByGestionId: { g1: "0.00" },
      totalIngresoBodegaRechazos: "0.00",
    });

    expect(id).toBeNull();
    // Solo la vinculacion se intento; los updateMany de snapshot NO se ejecutaron.
    expect((tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
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
        totalPagoMensajero: new Prisma.Decimal("7.5"), // feature 39/R13: snapshot del pago
        totalIngresoBodegaRechazos: new Prisma.Decimal("3"), // feature 56/R12: snapshot del ingreso
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
      totalPagoMensajero: "7.50", // feature 39/R13: snapshot money-safe STRING
      totalIngresoBodegaRechazos: "3.00", // feature 56/R12: snapshot money-safe STRING
      solicitadoAt: "2026-07-12T10:00:00.000Z",
    });
  });
});
