import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { CierreDetalleFaltanteError } from "@/lib/utils/cierre-detalle";
import type { Alcance } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService } from "@/lib/interfaces/services/IWalletFeedService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IWalletTiendaFeedService } from "@/lib/interfaces/services/IWalletTiendaFeedService";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletMensajeroFeedService } from "@/lib/interfaces/services/IWalletMensajeroFeedService";

// Feature 38 — tests unit del CierresAdminRepository (mockea Prisma, sin DB real,
// patron cierre-dia-repository.test.ts). Cubre R2/R4/R5 (findCierresByAlcance con
// alcance en el WHERE), R10/R14 (resolverCierre aprobar/rechazar -> updated + audit),
// R12 (conflict), R13 (fuera_de_alcance), R15 (no toca gestion_orden).
// Feature 42/T8: el constructor gana el repo de movimientos + el feed de wallet, y
// resolverCierre corre en $transaction alimentando la wallet al APROBAR (R5/R7/R12).

// Dobles de wallet + un $transaction que ejecuta el callback con el mismo doble de tx
// (misma superficie que la tx real: cierreDia.updateMany + gestionOrden + walletMovimiento).
function buildWalletDeps() {
  const walletMovimientoRepo: IWalletMovimientoRepository = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listar: vi.fn(),
    agregarBalance: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
  };
  const walletFeedService: IWalletFeedService = {
    construirMovimientosDeIngreso: vi.fn().mockResolvedValue([]),
  };
  // Feature 43/T10: dobles del ledger por tienda (misma tx que la 42).
  const walletTiendaMovimientoRepo: IWalletTiendaMovimientoRepository = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listarPorTienda: vi.fn(),
    agregarSaldoPorTienda: vi.fn(),
    listarSaldosTodasTiendas: vi.fn(),
  };
  const walletTiendaFeedService: IWalletTiendaFeedService = {
    construirMovimientosPorTienda: vi.fn().mockResolvedValue([]),
  };
  // Feature 44/T10: dobles del libro del pago por mensajero (misma tx que 42/43). El feed
  // devuelve { libro, egresoCaja } (por defecto vacios); el egreso va con el repo de la 42.
  const pagoMensajeroMovimientoRepo: IPagoMensajeroMovimientoRepository = {
    crearMovimientos: vi.fn().mockResolvedValue(0),
    listarPorMensajero: vi.fn(),
    agregarCuentaPorPagar: vi.fn(),
    listarCuentasPorPagarTodos: vi.fn(),
    obtenerNombreMensajero: vi.fn(),
  };
  const walletMensajeroFeedService: IWalletMensajeroFeedService = {
    construirMovimientosDePago: vi.fn().mockResolvedValue({ libro: [], egresoCaja: [] }),
  };
  return {
    walletMovimientoRepo,
    walletFeedService,
    walletTiendaMovimientoRepo,
    walletTiendaFeedService,
    pagoMensajeroMovimientoRepo,
    walletMensajeroFeedService,
  };
}

// Construye el repo con los dobles de wallet y un $transaction que ejecuta el callback
// contra el propio `prisma` doble (tx === prisma en las pruebas).
function makeRepo(
  prisma: Record<string, unknown>,
  wallet = buildWalletDeps(),
): { repo: CierresAdminRepository; wallet: ReturnType<typeof buildWalletDeps> } {
  const withTx = {
    ...prisma,
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
  };
  const repo = new CierresAdminRepository(
    withTx as unknown as PrismaClient,
    wallet.walletMovimientoRepo,
    wallet.walletFeedService,
    wallet.walletTiendaMovimientoRepo,
    wallet.walletTiendaFeedService,
    wallet.pagoMensajeroMovimientoRepo,
    wallet.walletMensajeroFeedService,
  );
  return { repo, wallet };
}

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
    // Feature 69/T18 (R15): el detalle de un cierre YA CREADO sale del SNAPSHOT.
    cierreDetail: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

// Feature 69/T18 — el par que compone el detalle del admin: la GESTION aporta lo suyo y
// `cierre_detail` lo de la ORDEN, congelado.
function gestionRow(overrides: Record<string, unknown> = {}) {
  return {
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
    historialEstados: [], // feature 102: acotado al origen SLA (vacio = rechazo NO-SLA/otro resultado)
    ...overrides,
  };
}

function detalleRow(overrides: Record<string, unknown> = {}) {
  return {
    ordenId: "o1",
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
    // Entradas de la fórmula del ingreso + tarifa congelada (feature 69/R6/R8). El default
    // es SIN tarifa (`tarifaId: null`): es el gap real de la R9, y así los tests que no
    // miran el ingreso no dependen de una tarifa inventada.
    montoCobrar: null,
    cobraComision: false,
    esCentral: false,
    tarifaId: null,
    tarifaValorFlete: null,
    tarifaValorFleteGam: null,
    tarifaValorFleteDevuelto: null,
    tarifaValorFleteDevueltoGam: null,
    tarifaComisionCod: null,
    tarifaIvaFlete: null,
    tarifaIvaComisionCod: null,
    ...overrides,
  };
}

describe("CierresAdminRepository.findCierresByAlcance (R2/R4/R5)", () => {
  it("R2: maestro -> WHERE solo destino_tipo=bodega_central (SIN destinoZonaId); orderBy solicitadoAt desc", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await repo.findCierresByAlcance(ALCANCE_MAESTRO);

    const arg = prisma.cierreDia.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ destinoTipo: "bodega_central" });
    expect(arg.where).not.toHaveProperty("destinoZonaId"); // el maestro no se acota por zona
    expect(arg.orderBy).toMatchObject({ solicitadoAt: "desc" });
  });

  it("R2: adminSatelite -> WHERE destino_tipo=bodega_satelite AND destino_zona_id=su zona", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findMany.mockResolvedValue([]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

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
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

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
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c-ajeno", ALCANCE_SAT);

    expect(r).toBeNull();
    const arg = prisma.cierreDia.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "c-ajeno", destinoTipo: "bodega_satelite", destinoZonaId: "z-cartago" });
    expect(prisma.gestionOrden.findMany).not.toHaveBeenCalled();
  });

  it("R6/R15: cierre en alcance -> compone gestiones (WHERE cierre_id = X) con el SNAPSHOT", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    // La GESTION aporta lo suyo; ya NO trae `orden` (la relacion viva desaparece del select).
    prisma.gestionOrden.findMany.mockResolvedValue([gestionRow()]);
    prisma.cierreDetail.findMany.mockResolvedValue([detalleRow()]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    expect(r).not.toBeNull();
    expect(prisma.gestionOrden.findMany.mock.calls[0][0].where).toEqual({ cierreId: "c1" });
    expect(prisma.cierreDetail.findMany.mock.calls[0][0].where).toEqual({ cierreId: "c1" });
    // MISMO DTO que antes de la 69: la UI no cambia.
    expect(r?.cierre.cierreId).toBe("c1");
    expect(r?.gestiones[0]).toMatchObject({
      gestionId: "g1",
      montoRecibido: "12.50",
      evidenciaStoragePath: "o1/e.jpg",
      pagoMensajero: "5.00",
      ingresoBodegaRechazo: "0.00",
    });
  });

  it("feature 102/R1: pide el historial ACOTADO al origen SLA y deriva esRechazoSla por gestion", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    prisma.gestionOrden.findMany.mockResolvedValue([
      // Rechazo SLA: trae una fila de historial (ya acotada al origen `escalado_devuelta_sla`).
      gestionRow({
        id: "g-sla",
        resultado: "rechazada",
        historialEstados: [{ origenTipo: "escalado_devuelta_sla" }],
      }),
      // Rechazo manual: sin fila de historial de ese origen -> NO-SLA (R2).
      gestionRow({ id: "g-man", resultado: "rechazada", historialEstados: [] }),
    ]);
    prisma.cierreDetail.findMany.mockResolvedValue([detalleRow()]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    // R1: el select del historial va acotado a `origen_tipo = escalado_devuelta_sla`, take 1.
    const select = prisma.gestionOrden.findMany.mock.calls[0][0].select;
    expect(select.historialEstados).toEqual({
      where: { origenTipo: "escalado_devuelta_sla" },
      take: 1,
      select: { origenTipo: true },
    });
    // R1/R2: la clasificacion sale del historial, no del monto.
    const byId = Object.fromEntries((r?.gestiones ?? []).map((g) => [g.gestionId, g.esRechazoSla]));
    expect(byId["g-sla"]).toBe(true);
    expect(byId["g-man"]).toBe(false);
  });

  it("deriva el desglose del ingreso de Ordenex de la TARIFA CONGELADA, con la fórmula de las wallets", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    prisma.gestionOrden.findMany.mockResolvedValue([gestionRow({ resultado: "entregada" })]);
    prisma.cierreDetail.findMany.mockResolvedValue([
      detalleRow({
        montoCobrar: new Prisma.Decimal("25000.00"),
        cobraComision: true,
        esCentral: true, // zona GAM -> se aplica la columna GAM, no la base
        tarifaId: "tar_88",
        tarifaValorFlete: new Prisma.Decimal("2000.00"),
        tarifaValorFleteGam: new Prisma.Decimal("2500.00"),
        tarifaValorFleteDevuelto: new Prisma.Decimal("1000.00"),
        tarifaValorFleteDevueltoGam: new Prisma.Decimal("1200.00"),
        tarifaComisionCod: new Prisma.Decimal("3.00"),
        tarifaIvaFlete: new Prisma.Decimal("13.00"),
        tarifaIvaComisionCod: new Prisma.Decimal("13.00"),
      }),
    ]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    expect(r?.gestiones[0].ingresoOrdenex).toMatchObject({
      montoCobrar: "25000.00",
      cobraComision: true,
      esCentral: true,
      flete: "2500.00", // columna GAM (R21: la zona elige columna, no fórmula)
      ivaFlete: "325.00", // 13% de 2500
      comisionCod: "750.00", // 3% de 25000
      ivaComisionCod: "97.50", // 13% de 750
      // Una entrega no deriva conceptos de devolución: `null`, no "0.00".
      fleteDevolucion: null,
      ivaFleteDevolucion: null,
      // Agrupados: cada concepto con su IVA. El de devolución no aplica -> null.
      fleteConIva: "2825.00", // 2500 + 325
      comisionConIva: "847.50", // 750 + 97.50
      fleteDevolucionConIva: null,
      total: "3672.50",
    });
    // La tarifa viaja COMPLETA, incluida la variante que no se aplicó (auditoría).
    expect(r?.gestiones[0].ingresoOrdenex?.tarifa).toMatchObject({
      tarifaId: "tar_88",
      valorFlete: "2000.00",
      valorFleteGam: "2500.00",
      comisionCod: "3.00",
    });
  });

  it("un rechazo deriva flete de devolución + su IVA, y NUNCA comisión (no hubo recaudo)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    prisma.gestionOrden.findMany.mockResolvedValue([gestionRow({ resultado: "rechazada" })]);
    prisma.cierreDetail.findMany.mockResolvedValue([
      detalleRow({
        montoCobrar: new Prisma.Decimal("25000.00"),
        cobraComision: true, // aunque cobre comisión: sin entrega no hay comisión
        esCentral: false,
        tarifaId: "tar_88",
        tarifaValorFlete: new Prisma.Decimal("2000.00"),
        tarifaValorFleteGam: new Prisma.Decimal("2500.00"),
        tarifaValorFleteDevuelto: new Prisma.Decimal("1000.00"),
        tarifaValorFleteDevueltoGam: new Prisma.Decimal("1200.00"),
        tarifaComisionCod: new Prisma.Decimal("3.00"),
        tarifaIvaFlete: new Prisma.Decimal("13.00"),
        tarifaIvaComisionCod: new Prisma.Decimal("13.00"),
      }),
    ]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    expect(r?.gestiones[0].ingresoOrdenex).toMatchObject({
      flete: null,
      comisionCod: null,
      ivaComisionCod: null,
      fleteDevolucion: "1000.00", // columna base (esCentral: false)
      ivaFleteDevolucion: "130.00", // 13% de 1000
      fleteConIva: null,
      comisionConIva: null,
      fleteDevolucionConIva: "1130.00", // 1000 + 130
      total: "1130.00",
    });
  });

  it("R9: sin tarifa congelada (tarifa_id NULL) no se deriva ingreso, y no lanza", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    prisma.gestionOrden.findMany.mockResolvedValue([gestionRow()]);
    prisma.cierreDetail.findMany.mockResolvedValue([
      detalleRow({ montoCobrar: new Prisma.Decimal("25000.00") }), // tarifaId: null por default
    ]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    expect(r?.gestiones[0].ingresoOrdenex).toMatchObject({
      tarifa: null,
      flete: null,
      comisionCod: null,
      total: "0.00",
      montoCobrar: "25000.00", // el COD congelado se sigue viendo
    });
  });

  it("R15: los descriptivos salen del SNAPSHOT, no de la orden viva", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    prisma.gestionOrden.findMany.mockResolvedValue([gestionRow()]);
    // La fila congelada dice "Tienda ORIGINAL"/"Cartago". Si el admin viera la orden viva,
    // veria lo que la orden diga HOY: exactamente lo que la feature viene a impedir.
    prisma.cierreDetail.findMany.mockResolvedValue([
      detalleRow({ tiendaNombre: "Tienda ORIGINAL", zonaNombre: "Cartago", numGuia: 10 }),
    ]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    expect(r?.gestiones[0]).toMatchObject({
      numGuia: 10,
      numRemision: "REM-1",
      destinatario: "Ana",
      direccion: "Av 1",
      producto: "Caja",
      tiendaNombre: "Tienda ORIGINAL",
      zonaNombre: "Cartago",
      provinciaNombre: "Cartago",
      cantonNombre: "Central",
      distritoNombre: "Oriental",
    });
    // El select de la gestion ya no navega la relacion `orden`.
    expect(prisma.gestionOrden.findMany.mock.calls[0][0].select).not.toHaveProperty("orden");
  });

  it("R19: una orden con deleted_at sigue apareciendo en el detalle del cierre", async () => {
    // Con el snapshot ya no depende del accidente de que `WITH_DETALLE` no filtrara
    // `deletedAt`: la fila congelada NO tiene deleted_at (es inmutable) y no se consulta
    // `orden` en absoluto. Borrar la orden no puede sacarla del cierre que la liquido.
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    prisma.gestionOrden.findMany.mockResolvedValue([gestionRow()]);
    prisma.cierreDetail.findMany.mockResolvedValue([detalleRow()]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    expect(r?.gestiones).toHaveLength(1);
    expect(r?.gestiones[0].ordenId).toBe("o1");
    // Ningun WHERE del detalle menciona `deletedAt`: la orden viva no participa.
    expect(JSON.stringify(prisma.cierreDetail.findMany.mock.calls[0][0])).not.toContain("deleted");
    expect(JSON.stringify(prisma.gestionOrden.findMany.mock.calls[0][0])).not.toContain("deleted");
  });

  it("R14: falta la fila congelada de una orden -> error duro (sin fallback a datos vivos)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    prisma.gestionOrden.findMany.mockResolvedValue([gestionRow()]);
    prisma.cierreDetail.findMany.mockResolvedValue([]); // sin snapshot
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await expect(repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO)).rejects.toThrow(
      CierreDetalleFaltanteError,
    );
  });
});

describe("CierresAdminRepository.resolverCierre (R10/R12/R13/R14/R15)", () => {
  it("R10/R14: updateMany count=1 -> updated; WHERE guarda estado=solicitado + alcance; data lleva audit", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

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
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

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
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

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
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

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
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

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

describe("CierresAdminRepository.resolverCierre — enganche wallet (feature 42/T8: R5/R7/R12)", () => {
  it("R5: aprobar (count=1) construye e inserta los movimientos de ingreso EN LA TX", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const movs = [
      { tipo: "ingreso", categoria: "ingreso_flete", monto: "1000.00", origenTipo: "cierre_dia", origenId: "c1", descripcion: null, registradoPor: null },
    ];
    (wallet.walletFeedService.construirMovimientosDeIngreso as ReturnType<typeof vi.fn>).mockResolvedValue(movs);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    expect(r).toBe("updated");
    // R5: el feed se invoca con el cierreId y un cliente de tx; el repo inserta esos movs.
    expect(wallet.walletFeedService.construirMovimientosDeIngreso).toHaveBeenCalledTimes(1);
    expect(wallet.walletFeedService.construirMovimientosDeIngreso).toHaveBeenCalledWith("c1", expect.anything());
    expect(wallet.walletMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect((wallet.walletMovimientoRepo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(movs);
  });

  it("rechazar NO alimenta la wallet (solo aprobado)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_SAT,
      nuevoEstado: "rechazado",
      resueltoPor: "adm-sat",
      motivoRechazo: "cuadre erroneo",
    });

    expect(wallet.walletFeedService.construirMovimientosDeIngreso).not.toHaveBeenCalled();
    expect(wallet.walletMovimientoRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("count=0 (conflict) NO alimenta la wallet aunque el destino sea aprobado", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreDia.count.mockResolvedValue(1);
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("conflict");
    expect(wallet.walletFeedService.construirMovimientosDeIngreso).not.toHaveBeenCalled();
    expect(wallet.walletMovimientoRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R12: vencido->aprobado (count=1) alimenta la wallet exactamente una vez", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    const r = await repo.resolverCierre({
      cierreId: "c-vencido",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("updated");
    // R12: una sola alimentacion por la transicion (la idempotencia DB evita duplicar en
    // re-aprobaciones; aqui se verifica que se invoca una unica vez por transicion).
    expect(wallet.walletMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("R7: si el insert de movimientos falla, el $transaction propaga y NO queda 'updated'", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    (wallet.walletFeedService.construirMovimientosDeIngreso as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tipo: "ingreso", categoria: "ingreso_flete", monto: "1.00", origenTipo: "cierre_dia", origenId: "c1", descripcion: null, registradoPor: null },
    ]);
    // El insert falla dentro de la tx -> el callback rechaza -> $transaction propaga
    // (rollback de la aprobacion en la tx real; aqui verificamos que el error se propaga).
    (wallet.walletMovimientoRepo.crearMovimientos as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("insert wallet fallo"),
    );
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    await expect(
      repo.resolverCierre({
        cierreId: "c1",
        alcance: ALCANCE_MAESTRO,
        nuevoEstado: "aprobado",
        resueltoPor: "adm-maestro",
        motivoRechazo: null,
      }),
    ).rejects.toThrow("insert wallet fallo");
    // NO se alcanzo el retorno "updated": el error atraviesa el $transaction (todo-o-nada).
  });
});

describe("CierresAdminRepository.resolverCierre — enganche ledger por tienda (feature 43/T10: R5/R7/R12/R13)", () => {
  it("R5: aprobar (count=1) construye e inserta los movimientos POR TIENDA en la MISMA tx, tras la 42", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const movsTienda = [
      { tiendaId: "t1", tipo: "credito", categoria: "cod_recaudado", monto: "10000.00", origenTipo: "cierre_dia", origenId: "c1", descripcion: null, registradoPor: null },
      { tiendaId: "t1", tipo: "debito", categoria: "flete", monto: "1000.00", origenTipo: "cierre_dia", origenId: "c1", descripcion: null, registradoPor: null },
    ];
    (wallet.walletTiendaFeedService.construirMovimientosPorTienda as ReturnType<typeof vi.fn>).mockResolvedValue(movsTienda);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    expect(r).toBe("updated");
    // La 42 se alimenta primero; luego el ledger por tienda con el mismo cierreId + tx.
    expect(wallet.walletMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect(wallet.walletTiendaFeedService.construirMovimientosPorTienda).toHaveBeenCalledTimes(1);
    expect(wallet.walletTiendaFeedService.construirMovimientosPorTienda).toHaveBeenCalledWith("c1", expect.anything());
    expect(wallet.walletTiendaMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect((wallet.walletTiendaMovimientoRepo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(movsTienda);
  });

  it("rechazar NO alimenta el ledger por tienda (solo aprobado)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_SAT,
      nuevoEstado: "rechazado",
      resueltoPor: "adm-sat",
      motivoRechazo: "cuadre erroneo",
    });

    expect(wallet.walletTiendaFeedService.construirMovimientosPorTienda).not.toHaveBeenCalled();
    expect(wallet.walletTiendaMovimientoRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("count=0 (conflict) NO alimenta el ledger por tienda aunque el destino sea aprobado", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreDia.count.mockResolvedValue(1);
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("conflict");
    expect(wallet.walletTiendaFeedService.construirMovimientosPorTienda).not.toHaveBeenCalled();
    expect(wallet.walletTiendaMovimientoRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R13: vencido->aprobado (count=1) alimenta el ledger por tienda exactamente una vez", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    const r = await repo.resolverCierre({
      cierreId: "c-vencido",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("updated");
    expect(wallet.walletTiendaMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("R7: si el insert del ledger por tienda falla, el $transaction propaga (rollback de TODO, incluida la 42)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    (wallet.walletTiendaFeedService.construirMovimientosPorTienda as ReturnType<typeof vi.fn>).mockResolvedValue([
      { tiendaId: "t1", tipo: "debito", categoria: "flete", monto: "1.00", origenTipo: "cierre_dia", origenId: "c1", descripcion: null, registradoPor: null },
    ]);
    (wallet.walletTiendaMovimientoRepo.crearMovimientos as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("insert wallet tienda fallo"),
    );
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    await expect(
      repo.resolverCierre({
        cierreId: "c1",
        alcance: ALCANCE_MAESTRO,
        nuevoEstado: "aprobado",
        resueltoPor: "adm-maestro",
        motivoRechazo: null,
      }),
    ).rejects.toThrow("insert wallet tienda fallo");
    // La 42 alcanzo a construirse/insertarse, pero el fallo del 43 revierte TODA la tx.
    expect(wallet.walletMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });
});

describe("CierresAdminRepository.resolverCierre — enganche pago al mensajero (feature 44/T10: R5/R7/R11/R12/R17)", () => {
  it("R5/R17: aprobar (count=1) construye e inserta el LIBRO por mensajero + el EGRESO en la caja 42, tras 42/43", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const libro = [
      { mensajeroId: "m1", tipo: "devengo", categoria: "pago_devengado", monto: "1000.00", origenTipo: "cierre_dia", origenId: "c1", descripcion: null, registradoPor: null },
      { mensajeroId: "m1", tipo: "pago", categoria: "pago_efectivo", monto: "300.00", origenTipo: "cierre_dia", origenId: "c1", descripcion: null, registradoPor: null },
    ];
    const egresoCaja = [
      { tipo: "egreso", categoria: "egreso_pago_mensajero", monto: "1000.00", origenTipo: "cierre_dia", origenId: "c1", descripcion: null, registradoPor: null },
    ];
    (wallet.walletMensajeroFeedService.construirMovimientosDePago as ReturnType<typeof vi.fn>).mockResolvedValue({ libro, egresoCaja });
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    expect(r).toBe("updated");
    // El feed del pago se invoca con el cierreId + un cliente de tx.
    expect(wallet.walletMensajeroFeedService.construirMovimientosDePago).toHaveBeenCalledTimes(1);
    expect(wallet.walletMensajeroFeedService.construirMovimientosDePago).toHaveBeenCalledWith("c1", expect.anything());
    // el LIBRO se inserta con el repo del pago por mensajero.
    expect(wallet.pagoMensajeroMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
    expect((wallet.pagoMensajeroMovimientoRepo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(libro);
    // R17 (Qa): el EGRESO se inserta con el repo de la 42 (segunda llamada: la 1a es el ingreso).
    expect(wallet.walletMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(2);
    expect((wallet.walletMovimientoRepo.crearMovimientos as ReturnType<typeof vi.fn>).mock.calls[1][1]).toEqual(egresoCaja);
  });

  it("rechazar NO alimenta el pago al mensajero (solo aprobado)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_SAT,
      nuevoEstado: "rechazado",
      resueltoPor: "adm-sat",
      motivoRechazo: "cuadre erroneo",
    });

    expect(wallet.walletMensajeroFeedService.construirMovimientosDePago).not.toHaveBeenCalled();
    expect(wallet.pagoMensajeroMovimientoRepo.crearMovimientos).not.toHaveBeenCalled();
    // R11: sin aprobacion, la caja 42 tampoco recibe el egreso.
    expect(wallet.walletMovimientoRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("count=0 (conflict) NO alimenta el pago al mensajero aunque el destino sea aprobado", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreDia.count.mockResolvedValue(1);
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    const r = await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("conflict");
    expect(wallet.walletMensajeroFeedService.construirMovimientosDePago).not.toHaveBeenCalled();
    expect(wallet.pagoMensajeroMovimientoRepo.crearMovimientos).not.toHaveBeenCalled();
  });

  it("R12: vencido->aprobado (count=1) alimenta el pago al mensajero exactamente una vez", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    const r = await repo.resolverCierre({
      cierreId: "c-vencido",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("updated");
    expect(wallet.pagoMensajeroMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });

  it("R7: si el insert del LIBRO por mensajero falla, el $transaction propaga (rollback de TODO, incl. 42 y 43)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    (wallet.walletMensajeroFeedService.construirMovimientosDePago as ReturnType<typeof vi.fn>).mockResolvedValue({
      libro: [{ mensajeroId: "m1", tipo: "devengo", categoria: "pago_devengado", monto: "1.00", origenTipo: "cierre_dia", origenId: "c1", descripcion: null, registradoPor: null }],
      egresoCaja: [],
    });
    (wallet.pagoMensajeroMovimientoRepo.crearMovimientos as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("insert pago mensajero fallo"),
    );
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    await expect(
      repo.resolverCierre({
        cierreId: "c1",
        alcance: ALCANCE_MAESTRO,
        nuevoEstado: "aprobado",
        resueltoPor: "adm-maestro",
        motivoRechazo: null,
      }),
    ).rejects.toThrow("insert pago mensajero fallo");
    // 42 y 43 alcanzaron a insertarse, pero el fallo del 44 revierte TODA la tx (todo-o-nada).
    expect(wallet.walletMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1); // solo el ingreso 42
    expect(wallet.walletTiendaMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });
});
