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
    gestionOrden: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
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

  // Feature 67/R13/R14/R15 — ESTA lista alimenta los 4 grupos, `computeTotales`,
  // `derivarPagos` (39) y `derivarIngresoBodega` (56), en la vista EN VIVO y en el SNAPSHOT
  // de `solicitarCierre`/corte diario: un solo filtro cubre los tres requisitos.
  it("67/R13/R14/R15: el WHERE exige `anuladaAt: null` (las gestiones deshechas no se listan)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.findGestionesPendientes("m1");

    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ mensajeroId: "m1", cierreId: null, anuladaAt: null });
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

// ============================================================================
// Feature 67 — el deshacer. Bloque money-critical + la escritura atomica.
// ============================================================================

describe("Feature 67/R16 — crearCierre NO vincula gestiones anuladas (MONEY-CRITICAL)", () => {
  // design §3-#2 y §8: este `updateMany` es el que VINCULA la gestion al cierre. Los feeds de
  // wallet (42/43/44) leen `gestionOrden.findMany({ where: { cierreId } })` dentro de la tx de
  // aprobacion: si una gestion DESHECHA recibiera `cierre_id`, la wallet la cobraria al
  // aprobar. Sin este test la feature no pasa review.
  it("el WHERE del updateMany que VINCULA exige `anuladaAt: null` (si no, la wallet cobra una gestion deshecha)", async () => {
    const tx = {
      cierreDia: { create: vi.fn(async () => ({ id: "c1" })) },
      gestionOrden: { updateMany: vi.fn(async () => ({ count: 2 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.crearCierre({
      mensajeroId: "m1",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z1",
      totales: { efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" },
      pagoByGestionId: { g1: "5.00", g2: "0.00" },
      totalPagoMensajero: "5.00",
      ingresoByGestionId: { g1: "0.00", g2: "0.00" },
      totalIngresoBodegaRechazos: "0.00",
    });

    const calls = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    // La PRIMERA escritura de la tx es la vinculacion: propiedad + sin cierre + NO ANULADA.
    expect(calls[0][0].where).toEqual({ mensajeroId: "m1", cierreId: null, anuladaAt: null });
    expect(calls[0][0].data).toMatchObject({ cierreId: "c1" });
  });

  it("R16: la vinculacion NO usa el WHERE viejo (sin `anuladaAt`), que ataria la anulada al cierre", async () => {
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

    const where = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    expect(where).not.toEqual({ mensajeroId: "m1", cierreId: null }); // el WHERE pre-64
    expect(where.anuladaAt).toBe(null);
  });
});

describe("Feature 67 — findGestionParaDeshacer / findUltimaGestionNoAnuladaId (R4/R6)", () => {
  it("lee la gestion por id con lo que necesitan las guardias (cierre, anulacion, orden)", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findUnique.mockResolvedValue({
      id: "g1",
      ordenId: "o1",
      mensajeroId: "m1",
      resultado: "devuelta",
      cierreId: null,
      anuladaAt: null,
      orden: { deletedAt: null, estatusId: "s-bodega", estatus: { value: "en_bodega" } },
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const row = await repo.findGestionParaDeshacer("g1");

    expect(prisma.gestionOrden.findUnique.mock.calls[0][0].where).toEqual({ id: "g1" });
    expect(row).toEqual({
      gestionId: "g1",
      ordenId: "o1",
      mensajeroId: "m1", // R9
      resultado: "devuelta", // R5
      cierreId: null, // R2
      anuladaAt: null, // R3
      orden: { deletedAt: null, estatusId: "s-bodega", estatusValue: "en_bodega" }, // R5/R6
    });
  });

  it("R6: propaga `orden.deletedAt` (el service decide; el repo no juzga)", async () => {
    const prisma = buildPrisma();
    const borrada = new Date("2026-07-14T10:00:00.000Z");
    prisma.gestionOrden.findUnique.mockResolvedValue({
      id: "g1",
      ordenId: "o1",
      mensajeroId: "m1",
      resultado: "entregada",
      cierreId: null,
      anuladaAt: null,
      orden: { deletedAt: borrada, estatusId: "s-entregada", estatus: { value: "entregada" } },
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const row = await repo.findGestionParaDeshacer("g1");
    expect(row?.orden.deletedAt).toEqual(borrada);
  });

  it("gestion inexistente -> null", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findUnique.mockResolvedValue(null);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);
    expect(await repo.findGestionParaDeshacer("nope")).toBeNull();
  });

  it("R4: la ultima NO anulada de la orden = findFirst({ordenId, anuladaAt:null}) desc por createdAt", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findFirst.mockResolvedValue({ id: "g9" });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const id = await repo.findUltimaGestionNoAnuladaId("o1");

    expect(id).toBe("g9");
    const arg = prisma.gestionOrden.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ ordenId: "o1", anuladaAt: null }); // las anuladas no cuentan
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("R4: orden sin gestiones vigentes -> null", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findFirst.mockResolvedValue(null);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);
    expect(await repo.findUltimaGestionNoAnuladaId("o1")).toBeNull();
  });
});

describe("Feature 67 — anularGestionYDevolverAGestion (R11/R12/R18-R23/R29)", () => {
  const INPUT = {
    gestionId: "g1",
    ordenId: "o1",
    mensajeroId: "m1",
    actorUsuarioId: "m1",
    estatusEsperadoId: "s-bodega",
    estatusEnRepartoId: "s-reparto",
  };

  function buildTx(counts: { anula?: number; mueve?: number } = {}) {
    return {
      gestionOrden: { updateMany: vi.fn(async () => ({ count: counts.anula ?? 1 })) },
      orden: { updateMany: vi.fn(async () => ({ count: counts.mueve ?? 1 })) },
      ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 1 })) },
      usuario: { update: vi.fn(), updateMany: vi.fn() }, // R29: no debe tocarse
    };
  }

  it("R22: los 3 pasos (anular + mover + append) ocurren en la MISMA $transaction; devuelve true", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const ok = await repo.anularGestionYDevolverAGestion(INPUT);

    expect(ok).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Los 3 pasos van al `tx` del callback, no al prisma del constructor (atomicidad real).
    expect(tx.gestionOrden.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.orden.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.gestionOrden.updateMany).not.toHaveBeenCalled();
  });

  it("R11: anula con RASTRO (anulada_at + anulada_por = quien deshizo), guardado por cierre/anulacion", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.anularGestionYDevolverAGestion({ ...INPUT, actorUsuarioId: "m1" });

    const arg = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // R2/R3 en la tx: la ventana (sin cierre) y la no-doble-anulacion son guardias del WHERE.
    expect(arg.where).toEqual({ id: "g1", mensajeroId: "m1", cierreId: null, anuladaAt: null });
    expect(arg.data.anuladaPor).toBe("m1");
    expect(arg.data.anuladaAt).toBeInstanceOf(Date);
  });

  it("R12: el update NO toca resultado/monto/metodo/motivo/fecha/evidencia/mensajero/createdAt", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.anularGestionYDevolverAGestion(INPUT);

    const data = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    // La fila se CONSERVA intacta (decision 2 del humano: anular dejando huella, no borrar):
    // solo se añaden las dos columnas de anulacion.
    expect(Object.keys(data).sort()).toEqual(["anuladaAt", "anuladaPor"]);
    for (const campo of [
      "resultado",
      "montoRecibido",
      "metodoPago",
      "motivo",
      "fechaReprogramacion",
      "evidenciaStoragePath", // R32: la referencia a la evidencia queda intacta
      "evidenciaContentType",
      "mensajeroId",
      "createdAt",
      "cierreId",
    ]) {
      expect(data[campo]).toBeUndefined();
    }
    // R34: tampoco se tocan los snapshots de dinero de la gestion.
    expect(data.pagoMensajero).toBeUndefined();
    expect(data.ingresoBodegaRechazo).toBeUndefined();
  });

  it("R18/R19: devuelve la orden a `en_reparto` y REPONE la asignacion al mensajero autor", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.anularGestionYDevolverAGestion(INPUT);

    const arg = (tx.orden.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // R5/R6: guardias — la orden sigue en el estado leido y no esta borrada.
    expect(arg.where).toEqual({ id: "o1", estatusId: "s-bodega", deletedAt: null });
    // R18: `en_reparto` (unico estado desde el que se puede volver a gestionar).
    expect(arg.data.estatusId).toBe("s-reparto");
    // R19: repone la asignacion que el SEGUIMIENTO del reintento (47/R6) habia limpiado.
    expect(arg.data.mensajeroAsignadoId).toBe("m1");
  });

  it("R20: appendCambioEstado con origen real, destino en_reparto, actor, enlace y `deshacer_gestion`", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.anularGestionYDevolverAGestion({ ...INPUT, actorUsuarioId: "m1" });

    const arg = (tx.ordenHistorialEstado.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: "s-bodega", // origen = estado REAL previo de la orden
        estatusDestinoId: "s-reparto",
        actorUsuarioId: "m1", // quien deshizo
        origenTipo: "deshacer_gestion", // 12.º valor: distinguible de una gestion real
        motivo: null,
        gestionOrdenId: "g1", // enlace a la gestion ANULADA
      },
    ]);
  });

  it("R21/R23: el estado se escribe SOLO via el choke point; el append es createMany (sin update/delete de historial)", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.anularGestionYDevolverAGestion(INPUT);

    // R21: el cambio de estado (tx.orden.updateMany) viene acompañado del append en la MISMA tx.
    expect(tx.orden.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.ordenHistorialEstado.createMany).toHaveBeenCalledTimes(1);
    // R23: append-only. El tx del historial solo expone createMany en este flujo: ninguna fila
    // preexistente se modifica ni se borra.
    expect(Object.keys(tx.ordenHistorialEstado)).toEqual(["createMany"]);
  });

  it("R29 (F1.4-c): NO toca el puntero `usuario.orden_en_gestion_id`", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.anularGestionYDevolverAGestion(INPUT);

    expect(tx.usuario.update).not.toHaveBeenCalled();
    expect(tx.usuario.updateMany).not.toHaveBeenCalled();
  });

  it("R34: no produce ningun movimiento de wallet/tienda/pago (el repo ni los conoce)", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await repo.anularGestionYDevolverAGestion(INPUT);

    // El dinero solo se asienta al APROBAR el cierre, y los feeds leen por `cierreId`: una
    // gestion con cierre_id = NULL nunca los alcanza. La tx del deshacer solo toca 3 modelos.
    const tocados = Object.entries(tx)
      .filter(([, m]) => Object.values(m).some((f) => (f as ReturnType<typeof vi.fn>).mock?.calls.length))
      .map(([k]) => k)
      .sort();
    expect(tocados).toEqual(["gestionOrden", "orden", "ordenHistorialEstado"]);
  });

  it("R2/R3/R22: si la ANULACION afecta 0 filas (carrera con solicitarCierre) -> false, sin mover la orden", async () => {
    const tx = buildTx({ anula: 0 });
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const ok = await repo.anularGestionYDevolverAGestion(INPUT);

    expect(ok).toBe(false);
    // Sin efectos parciales: ni la orden se movio ni se escribio historial (rollback).
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R5/R22: si la orden YA se movio (UPDATE afecta 0 filas) -> false, sin escribir historial", async () => {
    const tx = buildTx({ mueve: 0 });
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    const ok = await repo.anularGestionYDevolverAGestion(INPUT);

    expect(ok).toBe(false);
    // La anulacion se intento pero la tx hace ROLLBACK: la gestion NO queda anulada (todo-o-nada).
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("un error REAL de la tx se propaga (no se traga como conflicto)", async () => {
    const prisma = buildPrisma({
      $transaction: vi.fn(async () => {
        throw new Error("caida de DB");
      }),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient);

    await expect(repo.anularGestionYDevolverAGestion(INPUT)).rejects.toThrow("caida de DB");
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
