import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

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
    // Feature 212/R21: las lineas del desglose tal como las lee WITH_DETALLE (Decimal).
    pagos: [{ metodo: "efectivo", monto: new Prisma.Decimal("12.50") }],
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
    cierreDia: { count: vi.fn(), create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    // Feature 69/T10: el snapshot y el resolver batch viven en la tx de `crearCierre`.
    cierreDetail: { createMany: vi.fn() },
    tarifa: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
    ...overrides,
  };
}

// Feature 69/T10 (design §3.1) — doble del resolver de tarifa que `crearCierre` recibe por
// constructor. Por defecto resuelve `null` para toda tienda (gap R9): los casos que no
// afirman nada del snapshot no necesitan configurarlo.
function buildTarifaRepo(
  tarifas: Record<string, TarifaVigenteResuelta | null> = {},
): ITarifaVigentePorTiendaRepository {
  return {
    resolveTarifaPorTienda: vi.fn(async (tiendaId: string) => tarifas[tiendaId] ?? null),
    resolveTarifasPorTiendas: vi.fn(async (_tx: unknown, tiendaIds: string[]) => {
      const out = new Map<string, TarifaVigenteResuelta | null>();
      for (const id of tiendaIds) out.set(id, tarifas[id] ?? null);
      return out;
    }),
  } as unknown as ITarifaVigentePorTiendaRepository;
}

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

describe("CierreDiaRepository.findGestionesPendientes (R2/R3)", () => {
  it("R3: filtra por mensajeroId y cierreId:null; ordena por createdAt desc", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const n = await repo.contarOrdenesPendientesGestion("m1", ["por_recoger", "en_reparto"]);

    expect(n).toBe(2);
    const arg = prisma.orden.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      mensajeroAsignadoId: "m1",
      deletedAt: null,
      estatus: { value: { in: ["por_recoger", "en_reparto"] } },
    });
  });

  it("devuelve 0 sin consultar cuando estados esta vacio", async () => {
    const prisma = buildPrisma();
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const n = await repo.contarOrdenesPendientesGestion("m1", []);

    expect(n).toBe(0);
    expect(prisma.orden.count).not.toHaveBeenCalled();
  });
});

describe("CierreDiaRepository.existeCierreSolicitado (R12)", () => {
  it("true si hay un cierre solicitado del mensajero", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(1);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const r = await repo.existeCierreSolicitado("m1");

    expect(r).toBe(true);
    const arg = prisma.cierreDia.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({ mensajeroId: "m1", estado: "solicitado" });
  });

  it("false si no hay ninguno", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(0);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    expect(await repo.existeCierreSolicitado("m1")).toBe(false);
  });
});

// ============================================================================
// Feature 111 — existeCierreVencido (A1, R6) + transicionarVencidoASolicitado (A2, R7/R8/R21).
// ============================================================================

describe("CierreDiaRepository.existeCierreVencido (feature 111/R6)", () => {
  it("R6: true si hay un cierre vencido del mensajero; WHERE guarda estado='vencido'", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(1);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const r = await repo.existeCierreVencido("m1");

    expect(r).toBe(true);
    const arg = prisma.cierreDia.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({ mensajeroId: "m1", estado: "vencido" });
  });

  it("R6: false si no hay ninguno", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(0);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    expect(await repo.existeCierreVencido("m1")).toBe(false);
  });
});

describe("CierreDiaRepository.transicionarVencidoASolicitado (feature 111/R7/R8/R21)", () => {
  it("R7: updateMany guardado por estado='vencido'+mensajero; count=1 -> true", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const ok = await repo.transicionarVencidoASolicitado("m1");

    expect(ok).toBe(true);
    const arg = prisma.cierreDia.updateMany.mock.calls[0][0];
    // R7: anti-TOCTOU — solo transiciona si SIGUE en `vencido`.
    expect(arg.where).toEqual({ mensajeroId: "m1", estado: "vencido" });
    // R8/R21: money-safe — data SOLO `estado`. Nada de totales, pago, ingreso, resuelto_por/at.
    expect(arg.data).toEqual({ estado: "solicitado" });
  });

  it("R8/R21: la escritura NO toca snapshot money-critical ni resuelto_por/at ni solicitado_at", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.transicionarVencidoASolicitado("m1");

    const data = prisma.cierreDia.updateMany.mock.calls[0][0].data;
    for (const prohibido of [
      "totalEfectivo",
      "totalSimpe",
      "totalTransferencia",
      "totalGeneral",
      "totalPagoMensajero",
      "totalIngresoBodegaRechazos",
      "resueltoPor",
      "resueltoAt",
      "solicitadoAt",
    ]) {
      expect(data).not.toHaveProperty(prohibido);
    }
  });

  it("R7: count=0 (raced / ya resuelto entre lectura y escritura) -> false, sin efectos", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    expect(await repo.transicionarVencidoASolicitado("m1")).toBe(false);
  });
});

// ============================================================================
// Feature 109 — existeCierreRechazado + transicionarRechazadoASolicitado (R28, modelo GLOBAL).
// Gemelos EXACTOS del `vencido`: `rechazado` ya NO es terminal (bloquea + re-solicitable).
// ============================================================================

describe("CierreDiaRepository.existeCierreRechazado (feature 109/R28)", () => {
  it("R28: true si hay un cierre rechazado del mensajero; WHERE guarda estado='rechazado'", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(1);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const r = await repo.existeCierreRechazado("m1");

    expect(r).toBe(true);
    const arg = prisma.cierreDia.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({ mensajeroId: "m1", estado: "rechazado" });
  });

  it("R28: false si no hay ninguno", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.count.mockResolvedValue(0);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    expect(await repo.existeCierreRechazado("m1")).toBe(false);
  });
});

describe("CierreDiaRepository.transicionarRechazadoASolicitado (feature 109/R28)", () => {
  it("R28: updateMany guardado por estado='rechazado'+mensajero; count=1 -> true; data SOLO estado", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const ok = await repo.transicionarRechazadoASolicitado("m1");

    expect(ok).toBe(true);
    const arg = prisma.cierreDia.updateMany.mock.calls[0][0];
    // Anti-TOCTOU: solo transiciona si SIGUE en `rechazado`.
    expect(arg.where).toEqual({ mensajeroId: "m1", estado: "rechazado" });
    // Money-safe: data SOLO `estado`. Nada de totales, pago, ingreso, resuelto_por/at, motivo.
    expect(arg.data).toEqual({ estado: "solicitado" });
  });

  it("R28: money-safe — NO toca snapshot, resuelto_por/at, motivo_rechazo ni solicitado_at", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.transicionarRechazadoASolicitado("m1");

    const data = prisma.cierreDia.updateMany.mock.calls[0][0].data;
    for (const prohibido of [
      "totalEfectivo",
      "totalGeneral",
      "totalPagoMensajero",
      "totalIngresoBodegaRechazos",
      "resueltoPor",
      "resueltoAt",
      "motivoRechazo",
      "solicitadoAt",
    ]) {
      expect(data).not.toHaveProperty(prohibido);
    }
  });

  it("R28: count=0 (raced / ya re-solicitado) -> false, sin efectos", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    expect(await repo.transicionarRechazadoASolicitado("m1")).toBe(false);
  });
});

// ============================================================================
// Feature 109 — crearCierre con corteSinGestionar (R4/R6/R8/R22): transiciona en_reparto ->
// sin_gestionar EN LA MISMA tx, via el choke point (actor null), y relaja la guarda "algo paso".
// ============================================================================

describe("CierreDiaRepository.crearCierre — corteSinGestionar (feature 109/R4/R6/R8/R22)", () => {
  // tx con lo que la transicion del corte + el flujo normal necesitan. SIN $queryRaw -> el emisor
  // de webhooks del choke point es no-op (guard defensivo de `emisorWebhookEstadoReal`).
  function buildCorteTx(opts: { enReparto?: { id: string }[]; movidas?: number; vinculadas?: number } = {}) {
    const enReparto = opts.enReparto ?? [{ id: "o1" }, { id: "o2" }];
    const tx = {
      cierreDia: { create: vi.fn() },
      orden: { findMany: vi.fn(), updateMany: vi.fn() },
      gestionOrden: { updateMany: vi.fn(), findMany: vi.fn() },
      cierreDetail: { createMany: vi.fn() },
      ordenHistorialEstado: { createMany: vi.fn() },
    };
    tx.cierreDia.create.mockResolvedValue({ id: "cv1" });
    tx.orden.findMany.mockResolvedValue(enReparto);
    tx.orden.updateMany.mockResolvedValue({ count: opts.movidas ?? enReparto.length });
    tx.gestionOrden.updateMany.mockResolvedValue({ count: opts.vinculadas ?? 0 });
    tx.gestionOrden.findMany.mockResolvedValue([]);
    tx.cierreDetail.createMany.mockResolvedValue({ count: 0 });
    tx.ordenHistorialEstado.createMany.mockResolvedValue({ count: 0 });
    return tx;
  }

  const CORTE = { enRepartoEstatusId: idEstado("en_reparto"), sinGestionarEstatusId: idEstado("sin_gestionar") };
  function corteInput(overrides: Record<string, unknown> = {}) {
    return {
      mensajeroId: "m1",
      estado: "vencido" as const,
      destinoTipo: "bodega_satelite" as const,
      destinoZonaId: "z1",
      corteSinGestionar: CORTE,
      totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
      pagoByGestionId: {},
      totalPagoMensajero: "0.00",
      ingresoByGestionId: {},
      totalIngresoBodegaRechazos: "0.00",
      ...overrides,
    };
  }

  it("R4/R22: transiciona en_reparto -> sin_gestionar GUARDADO por estatus_id=en_reparto; conserva mensajero", async () => {
    const tx = buildCorteTx();
    const prisma = buildPrisma({ $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.crearCierre(corteInput());

    // Pre-SELECT de las ordenes del mensajero en en_reparto.
    expect(tx.orden.findMany.mock.calls[0][0].where).toEqual({
      mensajeroAsignadoId: "m1",
      estatusId: idEstado("en_reparto"),
      deletedAt: null,
    });
    // updateMany GUARDADO por estatus_id=en_reparto -> sin_gestionar; NO limpia mensajero (Q1).
    const upd = tx.orden.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: { in: ["o1", "o2"] }, estatusId: idEstado("en_reparto"), deletedAt: null });
    expect(upd.data).toEqual({ estatusId: idEstado("sin_gestionar") });
    expect(upd.data).not.toHaveProperty("mensajeroAsignadoId"); // se conserva
    expect(upd.data).not.toHaveProperty("prioridad"); // money-safe: no toca prioridad
  });

  it("R6/R22: choke point con actor null + origen `corte_sin_gestionar`, SOLO de las transicionadas", async () => {
    const tx = buildCorteTx();
    const prisma = buildPrisma({ $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.crearCierre(corteInput());

    const arg = tx.ordenHistorialEstado.createMany.mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_reparto"),
        estatusDestinoId: idEstado("sin_gestionar"),
        actorUsuarioId: null, // R6: sistema/cron
        origenTipo: "corte_sin_gestionar", // R6
        motivo: null,
        gestionOrdenId: null,
      },
      {
        ordenId: "o2",
        estatusOrigenId: idEstado("en_reparto"),
        estatusDestinoId: idEstado("sin_gestionar"),
        actorUsuarioId: null,
        origenTipo: "corte_sin_gestionar",
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("R8: 0 gestiones vinculadas + >=1 sin_gestionar -> crea el `vencido` money-neutral (no null)", async () => {
    const tx = buildCorteTx({ vinculadas: 0, movidas: 2 });
    const prisma = buildPrisma({ $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const id = await repo.crearCierre(corteInput());

    expect(id).toBe("cv1"); // NO se hace rollback pese a 0 gestiones
    expect(tx.cierreDia.create.mock.calls[0][0].data.estado).toBe("vencido");
  });

  it("R8/R9: 0 gestiones + 0 en_reparto -> rollback -> null (no-op real)", async () => {
    const tx = buildCorteTx({ enReparto: [], vinculadas: 0 });
    const prisma = buildPrisma({ $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const id = await repo.crearCierre(corteInput());

    expect(id).toBeNull();
    // sin en_reparto no se hace updateMany de orden ni append.
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("sin corteSinGestionar (flujo 37): NO toca `orden` ni el historial", async () => {
    const tx = buildCorteTx({ vinculadas: 1 });
    const prisma = buildPrisma({ $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.crearCierre(corteInput({ estado: "solicitado", corteSinGestionar: undefined }));

    expect(tx.orden.findMany).not.toHaveBeenCalled();
    expect(tx.orden.updateMany).not.toHaveBeenCalled();
    expect(tx.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });
});

describe("CierreDiaRepository.crearCierre (R13/R14)", () => {
  it("en $transaction: INSERT cierre_dia (Decimal snapshot) + vincular gestiones + snapshot pago; devuelve id", async () => {
    const tx = {
      cierreDia: { create: vi.fn(async () => ({ id: "c1" })) },
      gestionOrden: {
        updateMany: vi.fn(async () => ({ count: 3 })),
        // Feature 69/T10: el snapshot lee las gestiones que la tx VINCULO. Vacio por
        // defecto: estos casos de la 37/39/41/56/67 no afirman nada del snapshot.
        findMany: vi.fn(async () => []),
      },
      cierreDetail: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
      gestionOrden: {
        updateMany: vi.fn(async () => ({ count: 2 })),
        // Feature 69/T10: el snapshot lee las gestiones que la tx VINCULO. Vacio por
        // defecto: estos casos de la 37/39/41/56/67 no afirman nada del snapshot.
        findMany: vi.fn(async () => []),
      },
      cierreDetail: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
      gestionOrden: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        // Feature 69/T10: el snapshot lee las gestiones que la tx VINCULO. Vacio por
        // defecto: estos casos de la 37/39/41/56/67 no afirman nada del snapshot.
        findMany: vi.fn(async () => []),
      },
      cierreDetail: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
      gestionOrden: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        // Feature 69/T10: el snapshot lee las gestiones que la tx VINCULO. Vacio por
        // defecto: estos casos de la 37/39/41/56/67 no afirman nada del snapshot.
        findMany: vi.fn(async () => []),
      },
      cierreDetail: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
      gestionOrden: {
        updateMany: vi.fn(async () => ({ count: 2 })),
        // Feature 69/T10: el snapshot lee las gestiones que la tx VINCULO. Vacio por
        // defecto: estos casos de la 37/39/41/56/67 no afirman nada del snapshot.
        findMany: vi.fn(async () => []),
      },
      cierreDetail: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
      gestionOrden: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        // Feature 69/T10: el snapshot lee las gestiones que la tx VINCULO. Vacio por
        // defecto: estos casos de la 37/39/41/56/67 no afirman nada del snapshot.
        findMany: vi.fn(async () => []),
      },
      cierreDetail: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
      orden: { deletedAt: null, estatusId: idEstado("en_bodega_central"), estatus: { value: "en_bodega_central" } },
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const row = await repo.findGestionParaDeshacer("g1");

    expect(prisma.gestionOrden.findUnique.mock.calls[0][0].where).toEqual({ id: "g1" });
    expect(row).toEqual({
      gestionId: "g1",
      ordenId: "o1",
      mensajeroId: "m1", // R9
      resultado: "devuelta", // R5
      cierreId: null, // R2
      anuladaAt: null, // R3
      orden: { deletedAt: null, estatusId: idEstado("en_bodega_central"), estatusValue: "en_bodega_central" }, // R5/R6
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
      orden: { deletedAt: borrada, estatusId: idEstado("entregada"), estatus: { value: "entregada" } },
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const row = await repo.findGestionParaDeshacer("g1");
    expect(row?.orden.deletedAt).toEqual(borrada);
  });

  it("gestion inexistente -> null", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findUnique.mockResolvedValue(null);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());
    expect(await repo.findGestionParaDeshacer("nope")).toBeNull();
  });

  it("R4: la ultima NO anulada de la orden = findFirst({ordenId, anuladaAt:null}) desc por createdAt", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findFirst.mockResolvedValue({ id: "g9" });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const id = await repo.findUltimaGestionNoAnuladaId("o1");

    expect(id).toBe("g9");
    const arg = prisma.gestionOrden.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ ordenId: "o1", anuladaAt: null }); // las anuladas no cuentan
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("R4: orden sin gestiones vigentes -> null", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findFirst.mockResolvedValue(null);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());
    expect(await repo.findUltimaGestionNoAnuladaId("o1")).toBeNull();
  });
});

describe("Feature 67 — anularGestionYDevolverAGestion (R11/R12/R18-R23/R29)", () => {
  const INPUT = {
    gestionId: "g1",
    ordenId: "o1",
    mensajeroId: "m1",
    actorUsuarioId: "m1",
    estatusEsperadoId: idEstado("en_bodega_central"),
    estatusEnRepartoId: idEstado("en_reparto"),
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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.anularGestionYDevolverAGestion(INPUT);

    const arg = (tx.orden.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // R5/R6: guardias — la orden sigue en el estado leido y no esta borrada.
    expect(arg.where).toEqual({ id: "o1", estatusId: idEstado("en_bodega_central"), deletedAt: null });
    // R18: `en_reparto` (unico estado desde el que se puede volver a gestionar).
    expect(arg.data.estatusId).toBe(idEstado("en_reparto"));
    // R19: repone la asignacion que el SEGUIMIENTO del reintento (47/R6) habia limpiado.
    expect(arg.data.mensajeroAsignadoId).toBe("m1");
    // Feature 76/R23 (W4): la reposicion es una reasignacion efectiva -> estampa asignado_at.
    expect(arg.data.asignadoAt).toBeInstanceOf(Date);
  });

  it("R20: appendCambioEstado con origen real, destino en_reparto, actor, enlace y `deshacer_gestion`", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.anularGestionYDevolverAGestion({ ...INPUT, actorUsuarioId: "m1" });

    const arg = (tx.ordenHistorialEstado.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.data).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("en_bodega_central"), // origen = estado REAL previo de la orden
        estatusDestinoId: idEstado("en_reparto"),
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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.anularGestionYDevolverAGestion(INPUT);

    expect(tx.usuario.update).not.toHaveBeenCalled();
    expect(tx.usuario.updateMany).not.toHaveBeenCalled();
  });

  it("R34: no produce ningun movimiento de wallet/tienda/pago (el repo ni los conoce)", async () => {
    const tx = buildTx();
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
        // Resolucion del cierre: viaja al histórico del mensajero (un `rechazado` sin motivo
        // no le dice qué corregir). Aquí sigue abierto -> ambos nulos.
        resueltoAt: null,
        motivoRechazo: null,
      },
    ]);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

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
      resueltoAt: null,
      motivoRechazo: null,
    });
  });
});

// ============================================================================
// Feature 69 — el SNAPSHOT (`cierre_detail`). Bloque money-critical: es lo que impide que
// editar la orden o la tarifa entre SOLICITAR y APROBAR mueva el dinero del cierre.
// ============================================================================

const TARIFA_T1: TarifaVigenteResuelta = {
  tarifaId: "ta1",
  fulfillment: "300.00",
  valorFlete: "1000.00",
  valorFleteGam: "800.00",
  valorFleteDevuelto: "500.00",
  valorFleteDevueltoGam: "400.00",
  comisionCod: "5.00",
  ivaFlete: "13.00",
  ivaComisionCod: "13.00",
};

// Gestion vinculada, tal como la lee `SNAPSHOT_SELECT` DENTRO de la tx.
function snapshotRow(overrides: { ordenId?: string; orden?: Record<string, unknown> } = {}) {
  return {
    ordenId: overrides.ordenId ?? "o1",
    orden: {
      montoCobrar: new Prisma.Decimal("25000.00"),
      cobraComision: true,
      zonaId: "z1",
      tiendaId: "t1",
      numGuia: 10,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
      zona: { nombre: "Cartago", esCentral: false },
      tienda: { nombre: "Tienda X" },
      provincia: { nombre: "Cartago" },
      canton: { nombre: "Central" },
      distrito: { nombre: "Oriental" },
      ...(overrides.orden ?? {}),
    },
  };
}

function buildSnapshotTx(
  rows: ReturnType<typeof snapshotRow>[],
  overrides: Record<string, unknown> = {},
) {
  return {
    cierreDia: { create: vi.fn(async () => ({ id: "c1" })) },
    gestionOrden: {
      updateMany: vi.fn(async () => ({ count: rows.length || 1 })),
      findMany: vi.fn(async () => rows),
    },
    cierreDetail: { createMany: vi.fn(async () => ({ count: rows.length })) },
    ...overrides,
  };
}

const INPUT_CIERRE = {
  mensajeroId: "m1",
  destinoTipo: "bodega_satelite" as const,
  destinoZonaId: "z1",
  totales: { efectivo: "10.00", simpe: "0.00", transferencia: "0.00", general: "10.00" },
  pagoByGestionId: { g1: "0.00" },
  totalPagoMensajero: "0.00",
  ingresoByGestionId: { g1: "0.00" },
  totalIngresoBodegaRechazos: "0.00",
};

describe("Feature 69 — crearCierre puebla cierre_detail (R3-R9/R11)", () => {
  it("R3: puebla el snapshot en la MISMA $transaction que el INSERT y la vinculacion", async () => {
    const tx = buildSnapshotTx([snapshotRow()]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    const id = await repo.crearCierre(INPUT_CIERRE);

    expect(id).toBe("c1");
    // Una sola tx: el snapshot no puede quedar fuera del todo-o-nada.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.cierreDetail.createMany).toHaveBeenCalledTimes(1);
  });

  // El invariante que mata la carrera (design §3): si el snapshot se construyera con la lista
  // que el service leyo ANTES de la tx, una gestion creada entre medias quedaria vinculada
  // (el updateMany no lleva ids) pero SIN fila -> con R14 (sin fallback) la aprobacion
  // abortaria. Por eso se lee `where: { cierreId }` DENTRO de la tx.
  it("R3: lee lo que la tx VINCULO (where cierreId), no la lista del service", async () => {
    const tx = buildSnapshotTx([snapshotRow()]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    await repo.crearCierre(INPUT_CIERRE);

    const arg = (tx.gestionOrden.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { where: unknown };
    expect(arg.where).toEqual({ cierreId: "c1" });
  });

  it("R4: si el createMany del snapshot falla, el error se propaga (rollback, sin efectos)", async () => {
    const boom = new Error("createMany fallo");
    const tx = buildSnapshotTx([snapshotRow()], {
      cierreDetail: {
        createMany: vi.fn(async () => {
          throw boom;
        }),
      },
    });
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    // NO se traga como el sentinela de 0-gestiones: un fallo real del snapshot debe
    // propagarse para que la tx haga rollback (cierre + vinculacion + pagos incluidos).
    await expect(repo.crearCierre(INPUT_CIERRE)).rejects.toThrow(boom);
  });

  it("R5: no puede haber filas de gestiones anuladas (el updateMany ya solo vincula vigentes)", async () => {
    // El snapshot filtra por `cierreId` a secas; el invariante lo sostiene el updateMany de
    // la vinculacion (67/R16). Se fija aqui: si alguien le quitara `anuladaAt: null` a esa
    // guardia, una gestion deshecha recibiria cierre_id y ENTRARIA al snapshot.
    const tx = buildSnapshotTx([snapshotRow()]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    await repo.crearCierre(INPUT_CIERRE);

    const vincula = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { where: unknown };
    expect(vincula.where).toEqual({ mensajeroId: "m1", cierreId: null, anuladaAt: null });
  });

  it("R6: congela los datos money-critical de la orden", async () => {
    const tx = buildSnapshotTx([snapshotRow()]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    await repo.crearCierre(INPUT_CIERRE);

    const data = ((tx.cierreDetail.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { data: Record<string, unknown>[] })
      .data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      cierreId: "c1",
      ordenId: "o1",
      cobraComision: true,
      zonaId: "z1",
      tiendaId: "t1",
      esCentral: false, // el flag de la zona EN ESE INSTANTE, no el FK
    });
  });

  it("R7: congela los descriptivos + los 5 nombres desnormalizados", async () => {
    const tx = buildSnapshotTx([snapshotRow()]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    await repo.crearCierre(INPUT_CIERRE);

    const data = ((tx.cierreDetail.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { data: Record<string, unknown>[] })
      .data;
    expect(data[0]).toMatchObject({
      numGuia: 10,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
      tiendaNombre: "Tienda X",
      zonaNombre: "Cartago",
      provinciaNombre: "Cartago",
      cantonNombre: "Central",
      distritoNombre: "Oriental",
    });
  });

  it("R7: distrito nulo (unico FK nullable de la orden) => distritoNombre null", async () => {
    const tx = buildSnapshotTx([snapshotRow({ orden: { distrito: null } })]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    await repo.crearCierre(INPUT_CIERRE);

    const data = ((tx.cierreDetail.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { data: Record<string, unknown>[] })
      .data;
    expect(data[0].distritoNombre).toBeNull();
  });

  it("R8: congela los 7 valores de la tarifa + tarifa_id, resueltos EN LA MISMA tx", async () => {
    const tx = buildSnapshotTx([snapshotRow()]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const tarifaRepo = buildTarifaRepo({ t1: TARIFA_T1 });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, tarifaRepo);

    await repo.crearCierre(INPUT_CIERRE);

    // El resolver se invoca con el cliente de la TX (no con `prisma`): si se resolviera
    // fuera, la tarifa congelada podria no ser la que la tx vio.
    const [txArg, tiendaIds] = (tarifaRepo.resolveTarifasPorTiendas as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(txArg).toBe(tx);
    expect(tiendaIds).toEqual(["t1"]);

    const data = ((tx.cierreDetail.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { data: Record<string, unknown>[] })
      .data;
    expect(data[0]).toMatchObject({ tarifaId: "ta1" });
    const esperado: Record<string, string> = {
      tarifaValorFlete: "1000.00",
      tarifaValorFleteGam: "800.00",
      tarifaValorFleteDevuelto: "500.00",
      tarifaValorFleteDevueltoGam: "400.00",
      tarifaComisionCod: "5.00",
      tarifaIvaFlete: "13.00",
      tarifaIvaComisionCod: "13.00",
    };
    for (const [col, valor] of Object.entries(esperado)) {
      // R11: Decimal escala 2, nunca number.
      expect(data[0][col]).toBeInstanceOf(Prisma.Decimal);
      expect((data[0][col] as Prisma.Decimal).toFixed(2)).toBe(valor);
    }
  });

  it("R9: tienda SIN tarifa => fila con las 8 columnas NULL y el cierre se crea igual", async () => {
    const tx = buildSnapshotTx([snapshotRow()]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    // Sin tarifa para `t1`: el resolver devuelve null (gap de datos).
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const id = await repo.crearCierre(INPUT_CIERRE);

    // Decision (c): el gap NO bloquea. El cierre lo solicita el MENSAJERO; la tarifa es
    // configuracion de la TIENDA: bloquear le impediria cerrar su dia por un dato que no
    // controla (y tumbaria el corte diario masivo de la 41).
    expect(id).toBe("c1");
    const data = ((tx.cierreDetail.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { data: Record<string, unknown>[] })
      .data;
    expect(data[0]).toMatchObject({
      tarifaId: null,
      tarifaValorFlete: null,
      tarifaValorFleteGam: null,
      tarifaValorFleteDevuelto: null,
      tarifaValorFleteDevueltoGam: null,
      tarifaComisionCod: null,
      tarifaIvaFlete: null,
      tarifaIvaComisionCod: null,
    });
  });

  it("R2 (EL GRANO): 2 gestiones vigentes de la MISMA orden => UNA sola fila", async () => {
    // Una orden puede acumular varias gestiones vigentes en el mismo cierre (reintentos
    // 46/47). El detalle es de la ORDEN: sin dedupe, el UNIQUE (cierre_id, orden_id)
    // rechazaria la segunda fila y tumbaria el cierre entero.
    const tx = buildSnapshotTx([snapshotRow(), snapshotRow(), snapshotRow({ ordenId: "o2" })]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    await repo.crearCierre(INPUT_CIERRE);

    const data = ((tx.cierreDetail.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { data: Record<string, unknown>[] })
      .data;
    expect(data).toHaveLength(2);
    expect(data.map((d) => d.ordenId)).toEqual(["o1", "o2"]);
  });

  it("R11: montoCobrar viaja como Decimal escala 2 (nunca number/parseFloat)", async () => {
    const tx = buildSnapshotTx([snapshotRow()]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    await repo.crearCierre(INPUT_CIERRE);

    const data = ((tx.cierreDetail.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { data: Record<string, unknown>[] })
      .data;
    expect(data[0].montoCobrar).toBeInstanceOf(Prisma.Decimal);
    expect((data[0].montoCobrar as Prisma.Decimal).toFixed(2)).toBe("25000.00");
  });

  it("R6: montoCobrar nulo en la orden se congela como null (no como 0)", async () => {
    const tx = buildSnapshotTx([snapshotRow({ orden: { montoCobrar: null } })]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    await repo.crearCierre(INPUT_CIERRE);

    const data = ((tx.cierreDetail.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown as { data: Record<string, unknown>[] })
      .data;
    expect(data[0].montoCobrar).toBeNull();
  });

  it("una tienda con varias ordenes se resuelve UNA vez (sin N+1)", async () => {
    const tx = buildSnapshotTx([
      snapshotRow({ ordenId: "o1" }),
      snapshotRow({ ordenId: "o2" }),
      snapshotRow({ ordenId: "o3", orden: { tiendaId: "t2" } }),
    ]);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const tarifaRepo = buildTarifaRepo({ t1: TARIFA_T1 });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, tarifaRepo);

    await repo.crearCierre(INPUT_CIERRE);

    // UNA sola llamada batch para todas las tiendas del cierre.
    expect(tarifaRepo.resolveTarifasPorTiendas).toHaveBeenCalledTimes(1);
    expect(tarifaRepo.resolveTarifaPorTienda).not.toHaveBeenCalled();
  });

  it("R9/C1: si no se vincula ninguna gestion (rollback) el snapshot NO se toca", async () => {
    const tx = buildSnapshotTx([], {
      gestionOrden: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findMany: vi.fn(async () => []),
      },
    });
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    expect(await repo.crearCierre(INPUT_CIERRE)).toBeNull();
    expect(tx.cierreDetail.createMany).not.toHaveBeenCalled();
  });
});

describe("Feature 69/R16 — la vista EN VIVO no depende del snapshot", () => {
  // R16: mientras el cierre no existe (gestiones con cierre_id IS NULL) NO hay snapshot por
  // definicion. `findGestionesPendientes` debe seguir resolviendo por relacion, en vivo.
  it("findGestionesPendientes sigue leyendo gestion_orden en vivo, sin tocar cierreDetail", async () => {
    const prisma = buildPrisma();
    prisma.gestionOrden.findMany.mockResolvedValue([detalleRow()]);
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    const rows = await repo.findGestionesPendientes("m1");

    expect(rows).toHaveLength(1);
    const arg = prisma.gestionOrden.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ mensajeroId: "m1", cierreId: null, anuladaAt: null });
    expect(prisma.cierreDetail.createMany).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Feature 158 (T1.10, R16) — la gestion `incidente` entra al cierre SIN cambios de repo.
// El `updateMany` que vincula NO filtra por `resultado` (solo propiedad + sin cierre + no
// anulada), asi que el quinto resultado entra solo. Este bloque lo FIJA: si alguien anadiera
// un filtro por resultado "para no cobrar el incidente", las gestiones `incidente` se quedarian
// fuera del cierre y el admin no tendria donde capturar el monto de la indemnizacion.
// ============================================================================

describe("Feature 158/R16 — crearCierre vincula tambien las gestiones `incidente`", () => {
  it("R16: el WHERE de la vinculacion NO filtra por `resultado` (el incidente entra solo)", async () => {
    const tx = {
      cierreDia: { create: vi.fn(async () => ({ id: "c1" })) },
      gestionOrden: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => []),
      },
      cierreDetail: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.crearCierre({
      mensajeroId: "m1",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z1",
      totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
      pagoByGestionId: { "g-inc": "0.00" },
      totalPagoMensajero: "0.00",
      ingresoByGestionId: { "g-inc": "0.00" },
      totalIngresoBodegaRechazos: "0.00",
    });

    const where = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    expect(where).toEqual({ mensajeroId: "m1", cierreId: null, anuladaAt: null });
    expect(where).not.toHaveProperty("resultado");
  });

  it("R16: la orden de un `incidente` recibe su fila de cierre_detail (mismo grano por orden)", async () => {
    // El snapshot se construye leyendo lo que la tx VINCULO; una gestion `incidente` aporta su
    // fila igual que cualquier otra (el dedupe es por `ordenId`, no por resultado).
    const rows = [snapshotRow({ ordenId: "o-incidente" })];
    const tx = buildSnapshotTx(rows);
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(
      prisma as unknown as PrismaClient,
      buildTarifaRepo({ t1: TARIFA_T1 }),
    );

    await repo.crearCierre({
      ...INPUT_CIERRE,
      pagoByGestionId: { "g-inc": "0.00" },
      ingresoByGestionId: { "g-inc": "0.00" },
    });

    const arg = (tx.cierreDetail.createMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      data: { cierreId: string; ordenId: string }[];
    };
    expect(arg.data).toHaveLength(1);
    expect(arg.data[0]).toMatchObject({ cierreId: "c1", ordenId: "o-incidente" });
  });

  it("R17: el snapshot de dinero de un `incidente` es 0.00 en pago y en ingreso de bodega", async () => {
    const tx = {
      cierreDia: { create: vi.fn(async () => ({ id: "c1" })) },
      gestionOrden: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => []),
      },
      cierreDetail: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = buildPrisma({
      $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    });
    const repo = new CierreDiaRepository(prisma as unknown as PrismaClient, buildTarifaRepo());

    await repo.crearCierre({
      mensajeroId: "m1",
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z1",
      totales: { efectivo: "0.00", simpe: "0.00", transferencia: "0.00", general: "0.00" },
      pagoByGestionId: { "g-inc": "0.00" },
      totalPagoMensajero: "0.00",
      ingresoByGestionId: { "g-inc": "0.00" },
      totalIngresoBodegaRechazos: "0.00",
    });

    const calls = (tx.gestionOrden.updateMany as ReturnType<typeof vi.fn>).mock.calls;
    // [0] = vinculacion; [1] = pago_mensajero; [2] = ingreso_bodega_rechazo.
    expect(calls[1][0].data.pagoMensajero.toString()).toBe("0");
    expect(calls[2][0].data.ingresoBodegaRechazo.toString()).toBe("0");
    // Y la `indemnizacion` NO se toca al SOLICITAR: se captura al APROBAR (R19/R22).
    for (const c of calls) expect(c[0].data).not.toHaveProperty("indemnizacion");
  });
});
