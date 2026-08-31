import { describe, it, expect, vi, beforeEach } from "vitest";
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
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";
import type { IWalletIndemnizacionFeedService } from "@/lib/interfaces/services/IWalletIndemnizacionFeedService";
import { ANCLAJE_DEVOLUCION } from "@/tests/fixtures/anclaje-devolucion";

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
    agregarPorCategoriaYTipo: vi.fn(),
    obtenerPorId: vi.fn(),
    agregarPorCategoria: vi.fn(),
    obtenerPorOrigen: vi.fn(), // ficha 333: lectura por la clave del libro; este camino no la usa
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
    // Feature 170 (T I.1): saldos paginados; doble no-op, esta suite no los lee.
    listarSaldosTiendasPaginado: vi.fn(),
    agregarDesglosePorTienda: vi.fn(), // feature 171: doble no-op, este test no lee el ledger
    // ficha 335: idem. Este camino no abre el selector de cierres de `/mi-wallet`.
    listarCierresDeTienda: vi.fn(async () => []),
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
    listarCuentasPorPagarPaginado: vi.fn(),
    listarCuentasPorPagarCompleto: vi.fn(),
    obtenerNombreMensajero: vi.fn(),
    // 293/T2.2-T3.3: los dos metodos NUEVOS del contrato (lectura). No-op aqui: este
    // doble no ejercita el premio.
    sumarPremiosVivosPorCierre: vi.fn(async () => ({})),
    listarPremiosPorDias: vi.fn(async () => []),
  };
  const walletMensajeroFeedService: IWalletMensajeroFeedService = {
    construirMovimientosDePago: vi.fn().mockResolvedValue({ libro: [], egresoCaja: [] }),
  };
  // Feature 158/T1.14: doble del feed del egreso de indemnizacion (misma tx que 42/43/44).
  // Por defecto vacio: los cierres de esta suite no tienen incidentes.
  const walletIndemnizacionFeedService: IWalletIndemnizacionFeedService = {
    construirEgresoIndemnizacion: vi.fn().mockResolvedValue([]),
  };
  return {
    walletMovimientoRepo,
    walletFeedService,
    walletTiendaMovimientoRepo,
    walletTiendaFeedService,
    pagoMensajeroMovimientoRepo,
    walletMensajeroFeedService,
    walletIndemnizacionFeedService,
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
    wallet.walletIndemnizacionFeedService,
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
    // Feature 264 (R27): la marca por cierre. `true` = sus ordenes sin gestionar SI se
    // registraron (sean cuantas sean, incluido cero).
    sinGestionRegistrado: true,
    ...overrides,
  };
}

function buildPrisma(overrides: Record<string, unknown> = {}) {
  return {
    cierreDia: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    // Feature 239 (T2.2): al APROBAR, la misma tx corre ademas el bloque de ANCLAJE, que empieza
    // leyendo las gestiones `devuelta` de ESTE cierre. Sin devoluciones el bloque es no-op —que
    // es lo que estas suites quieren— pero el doble tiene que RESPONDER, o la tx muere con un
    // TypeError. Vacio por defecto; la suite que MIDE el anclaje lo monta con datos.
    gestionOrden: {
      findMany: vi.fn().mockResolvedValue([]),
      // FEATURE 276 (T9): el bloque del corte cuenta los intentos DENTRO de la tx con un
      // `groupBy`. Vacio = ninguna barrida llega al umbral, que es el corpus de esta suite; la
      // rama del rechazo por tope se mide contra Postgres en
      // `cierre-sin-gestion-tope-sql-real.test.ts`, no aqui.
      groupBy: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "g-sintetica" }),
    },
    // Feature 69/T18 (R15): el detalle de un cierre YA CREADO sale del SNAPSHOT.
    cierreDetail: { findMany: vi.fn().mockResolvedValue([]) },
    // Feature 264 (B4): la TERCERA consulta del detalle — las ordenes que el corte barrio al
    // crear el cierre. Vacio por defecto (el cierre normal no barrio ninguna).
    cierreSinGestion: { findMany: vi.fn().mockResolvedValue([]) },
    // Feature 173/T B.2: al aprobar, el feed del contra-entrega LEE el ledger por tienda para
    // saber cuanto se le acredito a las tiendas en ESE cierre. En esta suite el repositorio
    // del ledger es un doble que no escribe nada, asi que el ledger esta VACIO — y devolver
    // vacio es lo coherente con el resto del doble, no un atajo: sin creditos no hay
    // contra-entrega que meter en la caja (R13).
    walletTiendaMovimiento: { findMany: vi.fn().mockResolvedValue([]) },
    // Pedido humano 2026-08-18: aprobar enciende `gestion_aprobada` en las ordenes cuya gestion
    // de ESTE cierre fue `devuelta` (un `updateMany` mas dentro de la misma tx). Ningun test de
    // este archivo mide esa escritura — se mide en su propio archivo—, pero TODOS pasan por
    // ella al aprobar, asi que el doble tiene que existir o la tx muere con un TypeError.
    orden: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
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
    // Feature 158/R9/R19: campos POR RAMA del incidente, tal como los lee
    // `GESTION_ADMIN_SELECT`. `null` en un resultado que no sea `incidente`.
    causaIncidente: null,
    indemnizacion: null,
    // Feature 212/R21: el desglose que lee GESTION_ADMIN_SELECT (Decimal, ya ordenado).
    pagos: [{ metodo: "efectivo", monto: new Prisma.Decimal("12.50") }],
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
    tarifaFulfillment: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await sembrarCatalogoEstados(); // feature 140: la guardia del choke point es de fallo CERRADO (catalogo real + pares legales)
});

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

    // R1: el select del historial va ACOTADO a las familias que se derivan, y a ninguna mas.
    //
    // ⏳ 2026-08-20 (feature 237, D6/R41): pasa de UNA igualdad a un `in` de DOS familias, y de
    // `take: 1` a `take: 2`. La segunda es `gestion_tienda_ayuda`, de la que sale
    // `desdeAyudaTienda`. Se hizo ASI —ensanchando esta lectura— y no con una segunda consulta,
    // precisamente para que el detalle de admin no pague ni una consulta de mas: es la pagina que
    // mas filas trae. `take: 2` porque son dos familias y con `take: 1` una podria tapar a la otra
    // segun el orden de lectura.
    //
    // ⏳ 2026-08-20 (feature 240, D6/R43): la lista pasa de DOS a TRES con `rechazo_tienda`, que es
    // la SEGUNDA via por la que la tienda registra una gestion (rechazar a mano una devolucion ya
    // anclada). Y el `take` pasa de `2` a `3` por la razon que el parrafo de arriba ya daba: con un
    // `take` mas corto que el numero de familias, una taparia a la otra segun el orden de lectura y
    // `desdeAyudaTienda` saldria `false` sobre una gestion que SI registro la tienda — dejandola
    // deshacible por el mensajero. Es dinero, no cosmetica.
    //
    // El literal se conserva como literal: es el censo de lo que esta consulta puede traer.
    const select = prisma.gestionOrden.findMany.mock.calls[0][0].select;
    expect(select.historialEstados).toEqual({
      where: {
        origenTipo: { in: ["escalado_devuelta_sla", "gestion_tienda_ayuda", "rechazo_tienda"] },
      },
      take: 3,
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
        tarifaFulfillment: new Prisma.Decimal("500.00"),
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
        tarifaFulfillment: new Prisma.Decimal("500.00"),
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
      estado: { in: ["solicitado"] }, // R12 + feature 111/R15 (Q1-B): SOLO `solicitado` (se retiró `vencido`)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    const arg = prisma.cierreDia.updateMany.mock.calls[0][0];
    expect(arg.data.estado).toBe("aprobado");
    expect(arg.data.motivoRechazo).toBeNull();
    // el maestro no se acota por zona en el WHERE.
    expect(arg.where).toEqual({
      id: "c1",
      estado: { in: ["solicitado"] },
      destinoTipo: "bodega_central",
    });
  });

  it("feature 111/R15 (Q1-B): la resolución NORMAL guarda SOLO `solicitado` (un `vencido` no casa)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_SAT,
      nuevoEstado: "aprobado",
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    const arg = prisma.cierreDia.updateMany.mock.calls[0][0];
    // R15: se RETIRÓ `vencido` de los origenes resolubles del approve/reject normal. Un cierre
    // `vencido` real no casaría este WHERE (updateMany afectaría 0 filas -> conflict); el flujo
    // normal exige que pase por `solicitado` (R6) o por la válvula de escape (R16).
    expect(arg.where.estado).toEqual({ in: ["solicitado"] });
    expect(arg.where.estado.in).not.toContain("vencido");
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
      resueltoPor: "adm-sat",
      motivoRechazo: null,
    });

    expect(r).toBe("fuera_de_alcance");
  });
});

// ============================================================================
// Feature 111 — forzarSolicitudVencido (VÁLVULA DE ESCAPE, A3/R16/R17/R21).
// ============================================================================

describe("CierresAdminRepository.forzarSolicitudVencido (feature 111/R16)", () => {
  it("R16: count=1 -> updated; WHERE guarda estado='vencido' + alcance; data SOLO estado='solicitado'", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.forzarSolicitudVencido("c-venc", ALCANCE_SAT);

    expect(r).toBe("updated");
    const arg = prisma.cierreDia.updateMany.mock.calls[0][0];
    // R16 + feature 109/R28: guardia por estado ABIERTO ('vencido'|'rechazado') + alcance (anti-TOCTOU).
    expect(arg.where).toEqual({
      id: "c-venc",
      estado: { in: ["vencido", "rechazado"] },
      destinoTipo: "bodega_satelite",
      destinoZonaId: "z-cartago",
    });
    // R16/R21: money-safe — SOLO reescribe `estado`.
    expect(arg.data).toEqual({ estado: "solicitado" });
  });

  it("R16/R21/R17: la válvula NO recalcula totales ni registra auditoría (resuelto_por/at)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await repo.forzarSolicitudVencido("c-venc", ALCANCE_MAESTRO);

    const data = prisma.cierreDia.updateMany.mock.calls[0][0].data;
    // R17: la auditoría la deja la RESOLUCIÓN posterior (aprobar/rechazar el `solicitado`), no
    // la válvula. R21: no toca el snapshot money-critical.
    for (const prohibido of [
      "resueltoPor",
      "resueltoAt",
      "totalGeneral",
      "totalEfectivo",
      "totalPagoMensajero",
      "totalIngresoBodegaRechazos",
    ]) {
      expect(data).not.toHaveProperty(prohibido);
    }
    // El maestro no se acota por zona.
    expect(prisma.cierreDia.updateMany.mock.calls[0][0].where).toEqual({
      id: "c-venc",
      estado: { in: ["vencido", "rechazado"] }, // feature 109/R28
      destinoTipo: "bodega_central",
    });
  });

  // Feature 109/R28: la valvula generalizada tambien destraba un `rechazado` ABANDONADO.
  //
  // ⚠️ FEATURE 271 (R49) — NO BORRES ESTE CASO NI SU LITERAL: ES LA UNICA RED DE `ESTADOS_REABRIBLES`.
  // La 271 saco al `rechazado` de la cola de «pendientes de decision» (R48), asi que la UNICA salida
  // de un mensajero atrapado con un `rechazado` es esta valvula. La lista `["vencido","rechazado"]`
  // esta escrita A MANO en los tres `expect` de este bloque —no derivada de la constante—, que es lo
  // que los hace discriminar. Medido el 2026-08-23: quitando `rechazado` de
  // `CierresAdminRepository.ESTADOS_REABRIBLES` mueren **3 tests** de este archivo (este y los dos
  // que afirman el `where` entero). Los `cierres-admin-*.test.ts` de servicio DOBLAN el metodo y
  // nunca llegan a la constante: no cubren R49.
  it("R28: destraba un `rechazado` de su alcance -> updated (guarda estado IN vencido/rechazado)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.forzarSolicitudVencido("c-rech", ALCANCE_MAESTRO);

    expect(r).toBe("updated");
    const arg = prisma.cierreDia.updateMany.mock.calls[0][0];
    expect(arg.where.estado).toEqual({ in: ["vencido", "rechazado"] });
    expect(arg.data).toEqual({ estado: "solicitado" });
  });

  it("R16: count=0 pero existe en alcance (ya no es vencido) -> conflict, sin efectos", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreDia.count.mockResolvedValue(1); // existe en alcance pero ya no `vencido`
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.forzarSolicitudVencido("c-venc", ALCANCE_SAT);

    expect(r).toBe("conflict");
    const countArg = prisma.cierreDia.count.mock.calls[0][0];
    expect(countArg.where).toEqual({ id: "c-venc", destinoTipo: "bodega_satelite", destinoZonaId: "z-cartago" });
    expect(countArg.where).not.toHaveProperty("estado"); // solo alcance
  });

  it("R16: count=0 y fuera de alcance (otra bodega/zona o inexistente) -> fuera_de_alcance", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreDia.count.mockResolvedValue(0);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.forzarSolicitudVencido("c-ajeno", ALCANCE_SAT);

    expect(r).toBe("fuera_de_alcance");
  });

  it("R16: NO alimenta wallets ni corre en $transaction (no mueve dinero)", async () => {
    const prisma = buildPrisma();
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 1 });
    const wallet = buildWalletDeps();
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>, wallet);

    await repo.forzarSolicitudVencido("c-venc", ALCANCE_MAESTRO);

    expect(wallet.walletFeedService.construirMovimientosDeIngreso).not.toHaveBeenCalled();
    expect(wallet.walletMovimientoRepo.crearMovimientos).not.toHaveBeenCalled();
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
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
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
        resueltoPor: "adm-maestro",
        motivoRechazo: null,
      }),
    ).rejects.toThrow("insert pago mensajero fallo");
    // 42 y 43 alcanzaron a insertarse, pero el fallo del 44 revierte TODA la tx (todo-o-nada).
    expect(wallet.walletMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1); // solo el ingreso 42
    expect(wallet.walletTiendaMovimientoRepo.crearMovimientos).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Feature 109 — LIBERACION de `sin_gestionar` al APROBAR (R16/R17/R18/R19/R20/R27).
// SOLO en la rama `aprobado` de resolverCierre; molde de recuperarABodega (guardado por estado).
// ============================================================================

describe("CierresAdminRepository.resolverCierre — liberación de `sin_gestionar` (feature 109/R16-R20)", () => {
  const LIBERACION = {
    sinGestionarEstatusId: idEstado("sin_gestionar"),
    enBodegaEstatusId: idEstado("en_bodega_central"),
    enBodegaSateliteEstatusId: idEstado("en_bodega_satelite"),
    centralZonaId: "z-central",
    // FEATURE 276 (T9): destino del rechazo por tope + umbral inyectado. Con el corpus de esta
    // suite ninguna barrida llega al umbral, asi que la rama nueva es un no-op aqui.
    rechazadaEstatusId: idEstado("rechazada"),
    umbralIntentos: 3,
  };

  // Prisma con lo que la liberacion + los wallets necesitan. SIN $queryRaw -> el emisor de
  // webhooks del choke point es no-op (guard defensivo). tx === prisma (makeRepo).
  function buildLiberacionPrisma(
    ordenes: { id: string; zonaId: string }[],
    opts: { mensajeroId?: string | null; movidas?: number } = {},
  ) {
    const prisma = {
      cierreDia: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn(),
        findUnique: vi.fn(),
      },
      gestionOrden: {
        findMany: vi.fn().mockResolvedValue([]), // feature 239: sin devoluciones -> anclaje no-op
      // FEATURE 276 (T9): el bloque del corte cuenta los intentos DENTRO de la tx con un
      // `groupBy`. Vacio = ninguna barrida llega al umbral, que es el corpus de esta suite; la
      // rama del rechazo por tope se mide contra Postgres en
      // `cierre-sin-gestion-tope-sql-real.test.ts`, no aqui.
        groupBy: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "g-sintetica" }),
      },
      cierreDetail: { findMany: vi.fn().mockResolvedValue([]) },
      orden: { findMany: vi.fn(), updateMany: vi.fn() },
      ordenHistorialEstado: { createMany: vi.fn() },
    };
    prisma.cierreDia.findUnique.mockResolvedValue(
      opts.mensajeroId === null ? null : { mensajeroId: opts.mensajeroId ?? "m1" },
    );
    prisma.orden.findMany.mockResolvedValue(ordenes);
    // `where.id.in` es el updateMany de la LIBERACION (rutea por ids). Desde el pedido humano de
    // 2026-08-18 la rama `aprobado` corre ademas el de `gestion_aprobada`, que filtra por la
    // relacion `gestiones` y no lleva `id`: el acceso es opcional para sobrevivir a los dos.
    prisma.orden.updateMany.mockImplementation((args: { where: { id?: { in: string[] } } }) =>
      Promise.resolve({ count: opts.movidas ?? args.where.id?.in.length ?? 0 }),
    );
    prisma.ordenHistorialEstado.createMany.mockResolvedValue({ count: 0 });
    return prisma;
  }

  function aprobar(repo: CierresAdminRepository) {
    return repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "aprobado",
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
      liberacionSinGestionar: LIBERACION,
    });
  }

  it("R16/R17: transiciona por ZONA (central->en_bodega_central / satelite->en_bodega_satelite), limpia mensajero + prioridad=true", async () => {
    const prisma = buildLiberacionPrisma([
      { id: "o1", zonaId: "z-central" }, // -> en_bodega_central
      { id: "o2", zonaId: "z-sat" }, // -> en_bodega_satelite
    ]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("updated");
    // R16/R19: pre-SELECT de las `sin_gestionar` del mensajero del cierre.
    expect(prisma.orden.findMany.mock.calls[0][0].where).toEqual({
      mensajeroAsignadoId: "m1",
      estatusId: idEstado("sin_gestionar"),
      deletedAt: null,
    });
    // dos updateMany (uno por destino), cada uno GUARDADO por estatus_id=sin_gestionar.
    //
    // 2026-08-19 (feature 239/T2.5): SE RETIRA el `.filter(c => c.where.id !== undefined)` que
    // habia aqui. Excluia por la FORMA DEL WHERE, y lo que excluia era la unica escritura de la
    // transaccion que no tenia ninguna asercion (la de `gestion_aprobada`). Esa escritura ya no
    // existe; el hueco de cobertura tampoco tiene por que seguir existiendo. Se cuentan TODAS.
    const calls = prisma.orden.updateMany.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2); // exactamente las dos de la liberacion: ni una escritura mas
    const central = calls.find((c) => c.data.estatusId === idEstado("en_bodega_central"));
    const sat = calls.find((c) => c.data.estatusId === idEstado("en_bodega_satelite"));
    expect(central.where).toEqual({ id: { in: ["o1"] }, estatusId: idEstado("sin_gestionar"), deletedAt: null });
    expect(sat.where).toEqual({ id: { in: ["o2"] }, estatusId: idEstado("sin_gestionar"), deletedAt: null });
    // R16/R17: limpia mensajero/asignado_at + prioridad=true en la MISMA escritura.
    for (const c of [central, sat]) {
      expect(c.data).toMatchObject({
        mensajeroAsignadoId: null,
        asignadoAt: null,
        prioridad: true,
      });
    }
  });

  it("R18/R22: append por el choke point con actor=admin + origen `liberacion_sin_gestionar`", async () => {
    const prisma = buildLiberacionPrisma([{ id: "o1", zonaId: "z-sat" }]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await aprobar(repo);

    const entradas = prisma.ordenHistorialEstado.createMany.mock.calls.flatMap((c) => c[0].data);
    expect(entradas).toEqual([
      {
        ordenId: "o1",
        estatusOrigenId: idEstado("sin_gestionar"),
        estatusDestinoId: idEstado("en_bodega_satelite"),
        actorUsuarioId: "adm-maestro", // R18: el admin que aprobo
        origenTipo: "liberacion_sin_gestionar", // R18
        motivo: null,
        gestionOrdenId: null,
      },
    ]);
  });

  it("R19/R20: cierre NORMAL (0 `sin_gestionar`) -> no-op: no updateMany de orden ni append", async () => {
    const prisma = buildLiberacionPrisma([]); // el mensajero no tiene ordenes congeladas
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("updated"); // el flujo de aprobacion (wallets) NO se ve afectado
    // 2026-08-19 (feature 239/T2.5): sin `.filter(... where.id !== undefined)`. Se cuentan TODAS
    // las escrituras sobre `orden` de la transaccion: cero es cero, sin excepciones por forma.
    expect(prisma.orden.updateMany.mock.calls).toHaveLength(0);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R19: la liberación SOLO corre en la rama `aprobado` — un rechazo NO libera (R27)", async () => {
    const prisma = buildLiberacionPrisma([{ id: "o1", zonaId: "z-sat" }]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    // Rechazar NO pasa liberacionSinGestionar (el service no lo hace); aunque lo pasara, la
    // liberacion vive DENTRO del `if (nuevoEstado === 'aprobado')`.
    await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "rechazado",
      resueltoPor: "adm-maestro",
      motivoRechazo: "cuadre",
      liberacionSinGestionar: LIBERACION,
    });

    expect(prisma.orden.findMany).not.toHaveBeenCalled();
    // 2026-08-19 (feature 239/T2.5): sin `.filter(... where.id !== undefined)`. Se cuentan TODAS
    // las escrituras sobre `orden` de la transaccion: cero es cero, sin excepciones por forma.
    expect(prisma.orden.updateMany.mock.calls).toHaveLength(0);
    expect(prisma.ordenHistorialEstado.createMany).not.toHaveBeenCalled();
  });

  it("R19: sin `liberacionSinGestionar` en el input -> no hay liberación (aunque apruebe)", async () => {
    const prisma = buildLiberacionPrisma([{ id: "o1", zonaId: "z-sat" }]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await repo.resolverCierre({
      cierreId: "c1",
      alcance: ALCANCE_MAESTRO,
      nuevoEstado: "aprobado",
      anclajeDevolucion: ANCLAJE_DEVOLUCION, // feature 239/T2.1: obligatorio al aprobar
      confirmacionFisica: [], // feature 238/T3.2: obligatorio al aprobar (vacio = el cierre no devuelve nada)
      resueltoPor: "adm-maestro",
      motivoRechazo: null,
    });

    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });

  it("R19: count=0 (conflict) NO libera aunque el destino sea aprobado", async () => {
    const prisma = buildLiberacionPrisma([{ id: "o1", zonaId: "z-sat" }]);
    prisma.cierreDia.updateMany.mockResolvedValue({ count: 0 });
    prisma.cierreDia.count.mockResolvedValue(1);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await aprobar(repo);

    expect(r).toBe("conflict");
    expect(prisma.orden.findMany).not.toHaveBeenCalled();
  });
});

// ==============================================================================================
// FEATURE 264 (B4, R7/R9/R11/R12/R27) — EL DETALLE DEL ADMIN TRAE LAS ORDENES SIN GESTIONAR.
//
// Lo que este bloque puede demostrar y lo que NO. Puede demostrar la FORMA del retorno, que el
// `where` y el `orderBy` que se emiten son los que decimos, y que el alcance corta antes. NO
// puede demostrar que ese `where` seleccione de verdad las filas correctas: eso es semantica de
// Postgres y un doble es una re-implementacion mia de ella. Ese trabajo lo hace
// `tests/integration/db/cierre-sin-gestion-sql-real.test.ts`, contra la base, porque este repo ya
// midio cuatro veces que una mutacion de un `where` sobrevive en verde por aqui arriba.
// ==============================================================================================

describe("264/B4 — findCierreByIdEnAlcance devuelve las ordenes sin gestionar del cierre", () => {
  /** La fila CRUDA tal como la proyecta `SIN_GESTION_SELECT` (con la relacion del estatus). */
  function sinGestionRow(overrides: Record<string, unknown> = {}) {
    return {
      ordenId: "o-barrida",
      numGuia: 77,
      numRemision: "REM-77",
      destinatario: "Beto",
      producto: "Sobre",
      tiendaNombre: "Tienda Y",
      zonaNombre: "Heredia",
      estatusOrigen: { value: "ayuda_tienda" },
      ...overrides,
    };
  }

  function prismaConLista(filas: Record<string, unknown>[], cierre = cierreResumenRow()) {
    const prisma = buildPrisma();
    prisma.cierreDia.findFirst.mockResolvedValue(cierre);
    prisma.gestionOrden.findMany.mockResolvedValue([]);
    (prisma.cierreSinGestion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(filas);
    return prisma;
  }

  it("R7/R12: consulta por `cierre_id` en el WHERE y con un `orderBy` explicito", async () => {
    const prisma = prismaConLista([sinGestionRow()]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    const arg = (prisma.cierreSinGestion.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      where: unknown;
      orderBy: unknown;
      select: Record<string, unknown>;
    };
    // R7: el acotamiento va en el WHERE. Un filtro en memoria dejaria que las barridas de OTRO
    // cierre del mismo mensajero viajaran hasta el servicio antes de descartarse.
    expect(arg.where).toEqual({ cierreId: "c1" });
    // R12: orden estable y determinista entre dos lecturas del MISMO cierre.
    expect(arg.orderBy).toEqual([{ numGuia: "asc" }, { numRemision: "asc" }]);
    // `created_at` NO se proyecta: en las filas del backfill valdria la fecha de la migracion, y
    // un dato que miente en el 100 % de las filas viejas es peor que un dato ausente.
    expect(arg.select).not.toHaveProperty("createdAt");
  });

  it("R9: la lista viaja con los ocho campos y el estatus de origen ya traducido", async () => {
    const prisma = prismaConLista([sinGestionRow()]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    expect(r?.sinGestion).toEqual([
      {
        ordenId: "o-barrida",
        numGuia: 77,
        numRemision: "REM-77",
        destinatario: "Beto",
        producto: "Sobre",
        tiendaNombre: "Tienda Y",
        zonaNombre: "Heredia",
        estatusOrigen: "ayuda_tienda",
      },
    ]);
  });

  it("R10: ni un campo de dinero en las filas que salen del repositorio", async () => {
    const prisma = prismaConLista([sinGestionRow()]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    const claves = Object.keys(r?.sinGestion[0] ?? {}).join(" ").toLowerCase();
    for (const palabra of [
      "monto",
      "pago",
      "cobro",
      "ingreso",
      "tarifa",
      "comision",
      "evidencia",
      "resultado",
    ]) {
      expect(claves).not.toContain(palabra);
    }
  });

  it("R9/R32: sin guia y sin estatus de origen viajan como `null`, no se omiten ni se inventan", async () => {
    const prisma = prismaConLista([sinGestionRow({ numGuia: null, estatusOrigen: null })]);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    expect(r?.sinGestion).toHaveLength(1); // NO se descarta la fila
    expect(r?.sinGestion[0].numGuia).toBeNull();
    expect(r?.sinGestion[0].estatusOrigen).toBeNull();
  });

  it("R27: emite `sinGestionRegistrado` tal cual lo tiene el cierre (aqui, `false`)", async () => {
    const prisma = prismaConLista([], cierreResumenRow({ sinGestionRegistrado: false }));
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO);

    // `[]` + `false` NO es «no hubo ninguna»: es «no lo sabemos». Los dos viajan juntos.
    expect(r?.sinGestion).toEqual([]);
    expect(r?.sinGestionRegistrado).toBe(false);
    // Contrapunto obligatorio: con la marca en `true` el mismo `[]` significa otra cosa.
    const otro = buildPrisma();
    otro.cierreDia.findFirst.mockResolvedValue(cierreResumenRow());
    otro.gestionOrden.findMany.mockResolvedValue([]);
    const { repo: repo2 } = makeRepo(otro as unknown as Record<string, unknown>);
    expect((await repo2.findCierreByIdEnAlcance("c1", ALCANCE_MAESTRO))?.sinGestionRegistrado).toBe(
      true,
    );
  });

  it("R8: fuera de alcance corta ANTES de consultar la lista (no se distingue de inexistente)", async () => {
    const prisma = prismaConLista([sinGestionRow()]);
    prisma.cierreDia.findFirst.mockResolvedValue(null);
    const { repo } = makeRepo(prisma as unknown as Record<string, unknown>);

    const r = await repo.findCierreByIdEnAlcance("c-ajeno", ALCANCE_SAT);

    expect(r).toBeNull();
    // La guardia de alcance NO se repite en la consulta de la lista, y no hace falta: el
    // `findFirst` ya devolvio `null` y el `Promise.all` ni se lanza.
    expect(prisma.cierreSinGestion.findMany).not.toHaveBeenCalled();
  });
});
