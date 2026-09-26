import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

import type { IFileStorage } from "@/lib/interfaces/external/IFileStorage";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { AporteCapitalTxRunner } from "@/lib/interfaces/services/IAporteCapitalService";
import type { PagoPorCuentaTxRunner } from "@/lib/interfaces/services/IPagoPorCuentaTiendaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { AporteCapitalRepository } from "@/lib/repositories/AporteCapitalRepository";
import { CierreDelDiaRepository } from "@/lib/repositories/CierreDelDiaRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { CierresAdminRepository } from "@/lib/repositories/CierresAdminRepository";
import { GastoFijoCobroRepository } from "@/lib/repositories/GastoFijoCobroRepository";
import { LiquidacionPagoRepository } from "@/lib/repositories/LiquidacionPagoRepository";
import { LiquidacionRepartoRepository } from "@/lib/repositories/LiquidacionRepartoRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { PagoPorCuentaTiendaRepository } from "@/lib/repositories/PagoPorCuentaTiendaRepository";
import { PagoMensajeroMovimientoRepository } from "@/lib/repositories/PagoMensajeroMovimientoRepository";
import { RankingSnapshotRepository } from "@/lib/repositories/RankingSnapshotRepository";
import { RechazoTiendaCobroRepository } from "@/lib/repositories/RechazoTiendaCobroRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";
import { UserRepository } from "@/lib/repositories/UserRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { WalletTiendaMovimientoRepository } from "@/lib/repositories/WalletTiendaMovimientoRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { AjusteCajaAnulacionRepository } from "@/lib/repositories/AjusteCajaAnulacionRepository";
import { AbonoTiendaRepository } from "@/lib/repositories/AbonoTiendaRepository";
import {
  EgresoCajaDocumentosRepository,
  IndemnizacionDocumentosRepository,
  PagoTiendaCajaDocumentosRepository,
  PremioCajaDocumentosRepository,
} from "@/lib/repositories/EgresoCajaDocumentosRepository";
import { CobroTiendaAnulacionRepository } from "@/lib/repositories/CobroTiendaAnulacionRepository";
import type { AbonoTiendaTxRunner } from "@/lib/interfaces/services/IAbonoTiendaService";
import { AbonoTiendaService } from "@/lib/services/AbonoTiendaService";
import { CajaAbonoTiendaFeedService } from "@/lib/services/CajaAbonoTiendaFeedService";
import { AporteCapitalService } from "@/lib/services/AporteCapitalService";
import { CajaAporteCapitalFeedService } from "@/lib/services/CajaAporteCapitalFeedService";
import { CajaCobroTiendaFeedService } from "@/lib/services/CajaCobroTiendaFeedService";
import { CajaPagoPorCuentaFeedService } from "@/lib/services/CajaPagoPorCuentaFeedService";
import { CajaPagoTiendaFeedService } from "@/lib/services/CajaPagoTiendaFeedService";
import { CajaPremioRankingFeedService } from "@/lib/services/CajaPremioRankingFeedService";
import { CierreDiaService } from "@/lib/services/CierreDiaService";
import { CierresAdminService } from "@/lib/services/CierresAdminService";
import { CobroTiendaService } from "@/lib/services/CobroTiendaService";
import { GastoFijoCobroService } from "@/lib/services/GastoFijoCobroService";
import { LiquidacionService } from "@/lib/services/LiquidacionService";
import { PagoPorCuentaTiendaService } from "@/lib/services/PagoPorCuentaTiendaService";
import { PremioRankingDevengoService } from "@/lib/services/PremioRankingDevengoService";
import { RechazoTiendaCobroService } from "@/lib/services/RechazoTiendaCobroService";
import { RechazoTiendaCobroAnulacionRepository } from "@/lib/repositories/RechazoTiendaCobroAnulacionRepository";
import { CajaRechazoTiendaCobroFeedService } from "@/lib/services/CajaRechazoTiendaCobroFeedService";
import { EgresoCajaAnulacionService } from "@/lib/services/EgresoCajaAnulacionService";
import { WalletEgresoService } from "@/lib/services/WalletEgresoService";
import { WalletFeedService } from "@/lib/services/WalletFeedService";
import { WalletIndemnizacionFeedService } from "@/lib/services/WalletIndemnizacionFeedService";
import { WalletMensajeroFeedService } from "@/lib/services/WalletMensajeroFeedService";
import { WalletMensajeroService } from "@/lib/services/WalletMensajeroService";
import { WalletService } from "@/lib/services/WalletService";
import { WalletTiendaFeedService } from "@/lib/services/WalletTiendaFeedService";
import { WalletTiendaService } from "@/lib/services/WalletTiendaService";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { sinRetenidas } from "@/tests/fixtures/retenidas-doble";

import { clienteConSavepoint, serializarEscriturasReales, type TxDeTest } from "../_postgres-real";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 459 / T0.1 — EL ESCENARIO QUE EJERCE TODOS LOS CAMINOS QUE ESCRIBEN EN LA CAJA O EN EL
// LIBRO DE LAS TIENDAS, SEMBRADO POR LOS SERVICIOS REALES (design §12.1).
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Lo que se siembra A MANO es solo lo que ningun servicio de dinero escribe: personas, tarifas,
// ordenes, gestiones sueltas, la plantilla y el cobro pendiente de gasto fijo, y el podio
// congelado del ranking. TODO asiento de dinero (caja, libro de tienda, libro del mensajero) lo
// escribe el servicio real que lo escribe en produccion, cableado como en su `buildService()`:
//
//   · el cierre del dia: `CierreDiaService.solicitarCierre` + `CierresAdminService.aprobarCierre`
//     (dos tiendas, comision con centimos, una prepagada, una rechazada de calle y un incidente
//     con indemnizacion), con los CUATRO feeds reales;
//   · el cobro por rechazo (337): `RechazoTiendaCobroRepository.crearPendiente` + `aprobar`;
//   · pago a tienda y su anulacion, pago a otra tienda (`LiquidacionService`);
//   · reparto a mensajero, anulacion de su pago y un pago contra el cierre (`LiquidacionService`);
//   · cobro de un costo a una tienda (`CobroTiendaService`);
//   · sueldo y su reverso, gasto variable (`WalletEgresoService`);
//   · ajuste que suma y ajuste que resta (`WalletService.registrarMovimientoManual`);
//   · cobro de gasto fijo aprobado (`GastoFijoCobroService.aprobar`);
//   · premio del ranking y su anulacion (`PremioRankingDevengoService`).
//
// AISLAMIENTO. Todo corre dentro de una transaccion que SIEMPRE se revierte, en REPEATABLE READ:
// la base local es compartida y otros archivos de test commitean filas de caja a mitad de su
// ejecucion (los de concurrencia). Con READ COMMITTED, la lectura «antes» y la «despues» del libro
// entero podrian ver conjuntos distintos y la diferencia dejaria de ser la del escenario. Con
// REPEATABLE READ las dos lecturas miran la MISMA foto mas lo que escribe esta transaccion.

const URLS_NO_USADAS: ISignedUrlProvider = {
  createSignedUrl: async (ruta: string) => ruta,
  createSignedUrls: async (rutas: string[]) => Object.fromEntries(rutas.map((r) => [r, r])),
};

/** Los comprobantes no se ejercen en el escenario (ficha 459): subir uno aqui es un error del test. */
const STORAGE_NO_USADO: IFileStorage = {
  upload: async () => {
    throw new Error("el escenario 459 no sube comprobantes");
  },
  remove: async () => undefined,
};

/** Los estatus de orden que el escenario usa. */
const ESTATUS_USADOS = [
  "entregado",
  "devolucion_a_origen_por_rechazo",
  "incidente",
] as const;
type EstatusUsado = (typeof ESTATUS_USADOS)[number];

/**
 * Dia CR del podio del ranking de CADA siembra. `ranking_snapshot_dia.fecha` es UNIQUE, asi que dos
 * siembras en la misma transaccion necesitan dias distintos: un dia viejo (2021-2024, donde la base
 * no tiene podios) desplazado por un contador. El importe del premio no depende del dia.
 */
let siembras459 = 0;
function diaDelPremio(): string {
  const base = Date.UTC(2021, 0, 1) + Math.floor(Math.random() * 1000) * 86_400_000;
  siembras459 += 1;
  return new Date(base + siembras459 * 86_400_000).toISOString().slice(0, 10);
}

/** Reloj de las decisiones de cola (gasto fijo, cobro por rechazo). */
const AHORA_DECISION = new Date("2026-09-24T18:00:00.000Z");

export interface Catalogo459 {
  estatus: Map<string, string>;
  centralZonaId: string;
  tipoIdentificacionId: string;
  rolId: Record<"maestro" | "mensajero" | "adminTienda" | "adminSatelite", string>;
  fks: { provinciaId: string; cantonId: string };
}

/** Lee el catalogo que las FK exigen. Sin el, falla RUIDOSAMENTE (nunca un `return` mudo). */
export async function cargarCatalogo459(prisma: PrismaClient): Promise<Catalogo459> {
  const catalogo = await prisma.orderStatus.findMany({
    where: { value: { in: [...ESTATUS_USADOS] } },
    select: { id: true, value: true },
  });
  const estatus = new Map(catalogo.map((c) => [c.value as string, c.id]));
  for (const v of ESTATUS_USADOS) {
    if (!estatus.has(v)) throw new Error(`falta el estatus «${v}» en \`order_status\``);
  }
  const central = await prisma.zona.findFirst({ where: { esCentral: true }, select: { id: true } });
  const tipo = await prisma.tipoIdentificacion.findUnique({
    where: { value: "cedula" },
    select: { id: true },
  });
  const roles = await prisma.rol.findMany({ select: { id: true, value: true } });
  const rolDe = (v: string) => {
    const r = roles.find((x) => x.value === v);
    if (r === undefined) throw new Error(`falta el rol «${v}»: corre \`pnpm run db:seed\``);
    return r.id;
  };
  const orden = await prisma.orden.findFirst({ select: { provinciaId: true, cantonId: true } });
  if (central === null || tipo === null || orden === null) {
    throw new Error(
      "hay DATABASE_URL pero faltan la zona central, el tipo `cedula` o una orden de la que tomar " +
        "provincia y canton: corre `pnpm run db:seed` y `scripts/seed-zonas.ts`.",
    );
  }
  return {
    estatus,
    centralZonaId: central.id,
    tipoIdentificacionId: tipo.id,
    rolId: {
      maestro: rolDe("maestro"),
      mensajero: rolDe("mensajero"),
      adminTienda: rolDe("adminTienda"),
      adminSatelite: rolDe("adminSatelite"),
    },
    fks: { provinciaId: orden.provinciaId, cantonId: orden.cantonId },
  };
}

/** Portador del valor: se lanza para forzar el ROLLBACK sin perder lo que se calculo. */
class Revertir459 extends Error {
  constructor(readonly valor: unknown) {
    super("rollback deliberado del escenario 459");
    this.name = "Revertir459";
  }
}

/**
 * `enTransaccionRevertida` de `_postgres-real.ts`, en REPEATABLE READ (ver la cabecera) y con el
 * lock de aviso de las escrituras reales como PRIMERA sentencia.
 */
export async function enTransaccionRevertida459<T>(
  prisma: PrismaClient,
  fn: (tx: TxDeTest) => Promise<T>,
): Promise<T> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await serializarEscriturasReales(tx);
        throw new Revertir459(await fn(tx));
      },
      {
        timeout: 180_000,
        maxWait: 60_000,
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  } catch (error) {
    if (error instanceof Revertir459) return error.valor as T;
    throw error;
  }
  throw new Error("la transaccion termino sin revertirse: imposible");
}

/** Los servicios REALES, cableados como su `buildService()`, sobre la tx del test (savepoints reales). */
export function montarServicios459(tx: TxDeTest) {
  const c = clienteConSavepoint(tx);
  const runTx = <T>(fn: (t: never) => Promise<T>): Promise<T> =>
    c.$transaction((t) => fn(t as never)) as Promise<T>;
  const cajaRepo = new WalletMovimientoRepository(c);
  const tiendaRepo = new WalletTiendaMovimientoRepository(c);
  const mensajeroRepo = new PagoMensajeroMovimientoRepository(c);
  const zonaRepo = new ZonaRepository(c);
  const ordenRepo = new OrdenRepository(c);
  const tarifaZonaRepo = new TarifaZonaMensajeroRepository(c);
  const cierreDiaRepo = new CierreDiaRepository(c, new TarifaVigenteRepository(c));
  const adminRepo = new CierresAdminRepository(
    c,
    cajaRepo,
    new WalletFeedService(),
    tiendaRepo,
    new WalletTiendaFeedService({ TIENDA_DEBITA_FLETE_DEVOLUCION: true }),
    mensajeroRepo,
    new WalletMensajeroFeedService(),
    new WalletIndemnizacionFeedService(),
  );
  return {
    cliente: c,
    adminRepo,
    cierreMensajero: new CierreDiaService(
      cierreDiaRepo,
      zonaRepo,
      ordenRepo,
      URLS_NO_USADAS,
      tarifaZonaRepo,
    ),
    cierresAdmin: new CierresAdminService(
      adminRepo,
      zonaRepo,
      ordenRepo,
      URLS_NO_USADAS,
      new LiquidacionPagoRepository(c),
      mensajeroRepo,
      sinRetenidas(), // FICHA 462: 7.o argumento requerido; la caja no mide la marca
    ),
    liquidacion: new LiquidacionService(
      new LiquidacionPagoRepository(c),
      tiendaRepo,
      mensajeroRepo,
      (fn) => c.$transaction((t) => fn(t as never)),
      new CajaPagoTiendaFeedService(cajaRepo),
      new LiquidacionRepartoRepository(c),
    ),
    // Ficha 461 (T B.7): el cobro con su puerto de caja REAL y su repositorio de anulaciones, cableado
    // como su `buildCobroTiendaService()`.
    cobroTienda: new CobroTiendaService(
      tiendaRepo,
      new UserRepository(c),
      new CajaCobroTiendaFeedService(cajaRepo),
      new CobroTiendaAnulacionRepository(c),
      (fn) => c.$transaction((t) => fn(t as never)),
    ),
    rechazoCobroRepo: new RechazoTiendaCobroRepository(c),
    rechazoCobro: new RechazoTiendaCobroService(
      new RechazoTiendaCobroRepository(c),
      cajaRepo,
      tiendaRepo,
      c,
      (fn) => c.$transaction((t) => fn(t as never)),
      // Ficha 458-B (D7): la anulacion del cobro por rechazo, cableada como su `buildService()`.
      {
        repo: new RechazoTiendaCobroAnulacionRepository(c),
        caja: new CajaRechazoTiendaCobroFeedService(cajaRepo),
      },
      { TIENDA_DEBITA_FLETE_DEVOLUCION: true },
    ),
    // Ficha 458-B (D13): la anulacion con motivo de un egreso de caja, cableada como su `buildService()`.
    egresoAnulacion: new EgresoCajaAnulacionService(
      cajaRepo,
      new AjusteCajaAnulacionRepository(c),
      (fn) => c.$transaction((t) => fn(t as never)),
    ),
    gastoFijo: new GastoFijoCobroService(new GastoFijoCobroRepository(c), cajaRepo, c, (fn) =>
      c.$transaction((t) => fn(t as never)),
    ),
    premio: new PremioRankingDevengoService(
      new RankingSnapshotRepository(c),
      new CierreDelDiaRepository(c),
      mensajeroRepo,
      new CajaPremioRankingFeedService(cajaRepo),
      (fn) => c.$transaction((t) => fn(t as never)),
    ),
    egresos: new WalletEgresoService(cajaRepo, c),
    wallet: new WalletService(cajaRepo, c, new AporteCapitalRepository(c), {
      pagosPorCuenta: new PagoPorCuentaTiendaRepository(c),
      aportes: new AporteCapitalRepository(c),
      cobros: new CobroTiendaAnulacionRepository(c),
      ajustes: new AjusteCajaAnulacionRepository(c),
      abonos: new AbonoTiendaRepository(c), // ficha 457 (R41)
      // Ficha 458-B (R71): egresos, indemnizaciones y cobros por rechazo.
      egresos: new EgresoCajaDocumentosRepository(c),
      indemnizaciones: new IndemnizacionDocumentosRepository(c),
      rechazos: new RechazoTiendaCobroAnulacionRepository(c),
      // Ficha 458-C (revision B3, R71): el pago de Ordenex a una tienda y el premio del ranking.
      pagosATienda: new PagoTiendaCajaDocumentosRepository(c),
      premios: new PremioCajaDocumentosRepository(c),
    }),
    // Ficha 459 (T B.14) — los dos escritores nuevos, cableados como su `buildService()`.
    pagoPorCuenta: new PagoPorCuentaTiendaService(
      new PagoPorCuentaTiendaRepository(c),
      tiendaRepo,
      new LiquidacionPagoRepository(c),
      new UserRepository(c),
      new CajaPagoPorCuentaFeedService(cajaRepo),
      STORAGE_NO_USADO,
      URLS_NO_USADAS,
      ((fn: (t: never) => Promise<unknown>) =>
        c.$transaction((t) => fn(t as never))) as unknown as PagoPorCuentaTxRunner,
    ),
    aporteCapital: new AporteCapitalService(
      new AporteCapitalRepository(c),
      new CajaAporteCapitalFeedService(cajaRepo),
      cajaRepo,
      STORAGE_NO_USADO,
      URLS_NO_USADAS,
      ((fn: (t: never) => Promise<unknown>) =>
        c.$transaction((t) => fn(t as never))) as unknown as AporteCapitalTxRunner,
    ),
    // Ficha 457 (T5.4) — el pago de una tienda a Ordenex, cableado como su `buildService()`: el puerto
    // de caja REAL, el MISMO candado (`LiquidacionPagoRepository`) y el repositorio del documento.
    abonoTienda: new AbonoTiendaService(
      new AbonoTiendaRepository(c),
      tiendaRepo,
      new LiquidacionPagoRepository(c),
      new UserRepository(c),
      new CajaAbonoTiendaFeedService(cajaRepo),
      STORAGE_NO_USADO,
      URLS_NO_USADAS,
      ((fn: (t: never) => Promise<unknown>) =>
        c.$transaction((t) => fn(t as never))) as unknown as AbonoTiendaTxRunner,
    ),
    walletTienda: new WalletTiendaService(tiendaRepo),
    walletMensajero: new WalletMensajeroService(mensajeroRepo),
    runTx,
  };
}

export type Servicios459 = ReturnType<typeof montarServicios459>;

/** Lo que el escenario deja sembrado y que las lecturas necesitan para acotar. */
export interface Escenario459 {
  maestro: Actor;
  tiendaA: string;
  tiendaB: string;
  mensajeroId: string;
  cierreId: string;
  cierrePremioId: string;
  filaPremioId: string;
  /** Lo que devolvio cada paso del escenario (`status`), para comprobar que NINGUNO fallo. */
  pasos: Record<string, string>;
}

function afirmarOk(pasos: Record<string, string>, nombre: string, r: { status: string }): void {
  pasos[nombre] = r.status;
  if (r.status !== "ok") {
    throw new Error(`escenario 459: el paso «${nombre}» respondio ${JSON.stringify(r)}`);
  }
}

/**
 * Siembra el escenario de design §12.1 ENTERO sobre `tx`. Dos llamadas sobre la misma `tx`
 * siembran dos escenarios independientes (sufijos aleatorios), sin choques ni duplicados.
 */
export async function sembrarEscenario459(
  tx: TxDeTest,
  cat: Catalogo459,
): Promise<Escenario459> {
  const s = montarServicios459(tx);
  const sufijo = randomUUID().slice(0, 8);
  let n = 0;
  const pasos: Record<string, string> = {};
  const idDe = (v: EstatusUsado): string => cat.estatus.get(v) as string;

  // ── Personas ──────────────────────────────────────────────────────────────────────────────
  const zona = await tx.zona.create({
    data: {
      sinpeNumero: "80000000",
      sinpeNombre: "Titular 459",
      nombre: `Zona satelite 459 ${sufijo}`,
    },
    select: { id: true },
  });
  await tx.tarifaZonaMensajero.create({
    data: { zonaId: zona.id, vehiculoId: null, cobroEntregado: "1500.00", cobroRechazado: "164.00" },
  });

  const crearUsuario = async (
    prefijo: string,
    rolId: string,
    zonaId: string | null,
  ): Promise<string> => {
    const clave = `${sufijo}-${(n += 1)}`;
    const u = await tx.usuario.create({
      data: {
        nombre: `${prefijo} 459 ${clave}`,
        email: `${prefijo.toLowerCase()}459-${clave}@example.test`,
        telefono: "88880000",
        passwordHash: "no-se-usa",
        cedula: `459-${prefijo}-${clave}`,
        tipoIdentificacionId: cat.tipoIdentificacionId,
        rolId,
        zonaId,
        estado: "activo",
        fulfillment: false,
      },
      select: { id: true },
    });
    return u.id;
  };

  const mensajeroId = await crearUsuario("Mensajero", cat.rolId.mensajero, zona.id);
  const adminSatId = await crearUsuario("AdminSat", cat.rolId.adminSatelite, zona.id);
  const maestroId = await crearUsuario("Maestro", cat.rolId.maestro, null);
  const tiendaA = await crearUsuario("TiendaA", cat.rolId.adminTienda, null);
  const tiendaB = await crearUsuario("TiendaB", cat.rolId.adminTienda, null);
  const maestro: Actor = { usuarioId: maestroId, rol: "maestro" };
  const actorMensajero: Actor = { usuarioId: mensajeroId, rol: "mensajero" };
  const actorAdminSat: Actor = { usuarioId: adminSatId, rol: "adminSatelite", zonaId: zona.id };

  // Tarifa de NIVEL 2 (la tienda entera, sin zona) para cada tienda. Las ordenes van a la zona
  // CENTRAL, asi que se cobra la columna GAM. Comision con decimales para que un redondeo
  // distinto entre la caja y el libro de la tienda se note.
  const tarifa = (tiendaId: string, t: Record<string, string>) =>
    tx.tarifa.create({
      data: {
        tiendaId,
        zonaId: null,
        valorFlete: t.flete,
        valorFleteGam: t.fleteGam,
        valorFleteDevuelto: t.fleteDev,
        valorFleteDevueltoGam: t.fleteDevGam,
        comisionCod: t.comision,
        ivaFlete: "13.00",
        ivaComisionCod: "13.00",
        isDefault: true,
      },
    });
  await tarifa(tiendaA, {
    flete: "2000.00",
    fleteGam: "2500.00",
    fleteDev: "1000.00",
    fleteDevGam: "1200.00",
    comision: "3.50",
  });
  await tarifa(tiendaB, {
    flete: "2600.00",
    fleteGam: "3000.00",
    fleteDev: "1300.00",
    fleteDevGam: "1500.00",
    comision: "2.75",
  });

  // ── Ordenes y gestiones sueltas del dia ───────────────────────────────────────────────────
  const guiaBase = 459_000_000 + Math.floor(Math.random() * 40_000_000);
  const sembrarOrden = async (o: {
    tiendaId: string;
    estatus: EstatusUsado;
    montoCobrar: string | null;
  }) => {
    const clave = `${sufijo}-${(n += 1)}`;
    const numGuia = guiaBase + n;
    const orden = await tx.orden.create({
      data: {
        numGuia,
        numRemision: `R459-${clave}`,
        destinatario: `Dest ${clave}`,
        telefonoDest: "88880000",
        producto: `Prod ${clave}`,
        estatusId: idDe(o.estatus),
        mensajeroAsignadoId: mensajeroId,
        montoCobrar: o.montoCobrar,
        tiendaId: o.tiendaId,
        zonaId: cat.centralZonaId,
        provinciaId: cat.fks.provinciaId,
        cantonId: cat.fks.cantonId,
      },
      select: { id: true },
    });
    return { ordenId: orden.id, numGuia };
  };

  const sembrarGestion = async (g: {
    ordenId: string;
    resultado: "entregado" | "devolucion_a_origen_por_rechazo" | "incidente";
    pagos?: Array<{ metodo: "efectivo" | "SINPE"; monto: string }>;
    montoRecibido?: string;
    cierreId?: string | null;
  }): Promise<string> => {
    const origenTipo: OrdenHistorialOrigenTipo = "gestion";
    const gestion = await tx.gestionOrden.create({
      data: {
        ordenId: g.ordenId,
        mensajeroId,
        resultado: g.resultado,
        cierreId: g.cierreId ?? null,
        ...(g.montoRecibido !== undefined ? { montoRecibido: g.montoRecibido } : {}),
        ...(g.resultado === "devolucion_a_origen_por_rechazo" ? { motivo: "No la recibe" } : {}),
        ...(g.resultado === "incidente"
          ? { motivo: "Paquete perdido en ruta", causaIncidente: "perdido" as const }
          : {}),
      },
      select: { id: true },
    });
    for (const p of g.pagos ?? []) {
      await tx.gestionOrdenPago.create({
        data: { gestionId: gestion.id, metodo: p.metodo, monto: p.monto },
      });
    }
    await tx.ordenHistorialEstado.create({
      data: {
        ordenId: g.ordenId,
        estatusOrigenId: null,
        estatusDestinoId: idDe(g.resultado),
        actorUsuarioId: null,
        origenTipo,
        gestionOrdenId: gestion.id,
      },
    });
    return gestion.id;
  };

  // O1 (tienda A): entregada, contra-entrega 14 900,00 cobrado 2 000,00 en efectivo y el resto por
  // SINPE (asi el efectivo del cierre queda por debajo del pago al mensajero y queda pendiente).
  const o1 = await sembrarOrden({ tiendaId: tiendaA, estatus: "entregado", montoCobrar: "14900.00" });
  await sembrarGestion({
    ordenId: o1.ordenId,
    resultado: "entregado",
    montoRecibido: "14900.00",
    pagos: [
      { metodo: "efectivo", monto: "2000.00" },
      { metodo: "SINPE", monto: "12900.00" },
    ],
  });
  // O2 (tienda B): entregada, contra-entrega 16 617,00 por SINPE (comision 2,75 % con centimos).
  const o2 = await sembrarOrden({ tiendaId: tiendaB, estatus: "entregado", montoCobrar: "16617.00" });
  await sembrarGestion({
    ordenId: o2.ordenId,
    resultado: "entregado",
    montoRecibido: "16617.00",
    pagos: [{ metodo: "SINPE", monto: "16617.00" }],
  });
  // O3 (tienda A): PREPAGADA entregada — cargo sin contra-entrega.
  const o3 = await sembrarOrden({ tiendaId: tiendaA, estatus: "entregado", montoCobrar: null });
  await sembrarGestion({ ordenId: o3.ordenId, resultado: "entregado" });
  // O4 (tienda B): rechazada de calle — flete de devolucion; su paquete se confirma al aprobar.
  const o4 = await sembrarOrden({
    tiendaId: tiendaB,
    estatus: "devolucion_a_origen_por_rechazo",
    montoCobrar: "9000.00",
  });
  const g4 = await sembrarGestion({ ordenId: o4.ordenId, resultado: "devolucion_a_origen_por_rechazo" });
  // O5 (tienda A): incidente — se indemniza al aprobar.
  const o5 = await sembrarOrden({ tiendaId: tiendaA, estatus: "incidente", montoCobrar: "7000.00" });
  const g5 = await sembrarGestion({ ordenId: o5.ordenId, resultado: "incidente" });

  // ── El cierre: solicitar (mensajero) y aprobar (admin de la bodega) ───────────────────────
  const solicitud = await s.cierreMensajero.solicitarCierre(actorMensajero);
  if (solicitud.status !== "ok" || solicitud.cierreId === undefined) {
    throw new Error(`escenario 459: solicitarCierre respondio ${JSON.stringify(solicitud)}`);
  }
  const cierreId = solicitud.cierreId;
  pasos.solicitarCierre = solicitud.status;
  const aprobacion = await s.cierresAdmin.aprobarCierre(
    cierreId,
    actorAdminSat,
    [{ gestionId: g5, monto: "6500.00" }],
    [{ gestionId: g4, numGuia: o4.numGuia }],
  );
  afirmarOk(pasos, "aprobarCierre", aprobacion);

  // ── Cobro por rechazo de tienda (337), fuera de todo cierre ───────────────────────────────
  const o6 = await sembrarOrden({
    tiendaId: tiendaA,
    estatus: "devolucion_a_origen_por_rechazo",
    montoCobrar: "5000.00",
  });
  // `cierreId` apunta al cierre YA APROBADO: la gestion sintetica del rechazo de tienda no es
  // trabajo del dia, y asi ningun cierre posterior del mensajero la recoge.
  const g6 = await sembrarGestion({
    ordenId: o6.ordenId,
    resultado: "devolucion_a_origen_por_rechazo",
    cierreId,
  });
  await s.rechazoCobroRepo.crearPendiente(tx, {
    gestionId: g6,
    ordenId: o6.ordenId,
    tiendaId: tiendaA,
    montoFlete: "1000.00",
    montoIva: "130.00",
    tarifaId: null,
    generadoEl: "2026-09-24",
  });
  const cobroRechazo = await tx.rechazoTiendaCobro.findFirstOrThrow({
    where: { gestionId: g6 },
    select: { id: true },
  });
  afirmarOk(
    pasos,
    "aprobarCobroRechazo",
    await s.rechazoCobro.aprobar({ id: cobroRechazo.id }, maestro, AHORA_DECISION),
  );

  // ── Pagos a tiendas ───────────────────────────────────────────────────────────────────────
  const hoy = fechaCalendarioCR(new Date());
  const pagoA = await s.liquidacion.registrarPagoTienda(
    {
      claveIdempotencia: randomUUID(),
      tiendaId: tiendaA,
      monto: "5000.00",
      metodo: "efectivo",
      fechaPago: hoy,
    },
    maestro,
  );
  afirmarOk(pasos, "pagoTiendaA", pagoA);
  const pagoADoc = await tx.liquidacionPago.findFirstOrThrow({
    where: { tiendaId: tiendaA },
    select: { id: true },
  });
  afirmarOk(
    pasos,
    "anularPagoTiendaA",
    await s.liquidacion.anularPago({ pagoId: pagoADoc.id, motivo: "Se pago a la cuenta equivocada" }, maestro),
  );
  afirmarOk(
    pasos,
    "pagoTiendaB",
    await s.liquidacion.registrarPagoTienda(
      {
        claveIdempotencia: randomUUID(),
        tiendaId: tiendaB,
        monto: "3000.00",
        metodo: "SINPE",
        referencia: "SINPE-459-B",
        fechaPago: hoy,
      },
      maestro,
    ),
  );

  // ── Cobro de un costo a una tienda (381): no toca la caja ─────────────────────────────────
  afirmarOk(
    pasos,
    "cobroCostoB",
    await s.cobroTienda.registrarCobro(
      { claveIdempotencia: randomUUID(), tiendaId: tiendaB, monto: "2500.50", descripcion: "Pago publicidad de la tienda" },
      maestro,
    ),
  );

  // ── Mensajero: reparto, anulacion de su pago y un pago contra el cierre ───────────────────
  afirmarOk(
    pasos,
    "repartoMensajero",
    await s.liquidacion.registrarRepartoMensajero(
      {
        claveIdempotencia: randomUUID(),
        mensajeroId,
        monto: "1000.00",
        metodo: "efectivo",
        fechaPago: hoy,
      },
      maestro,
    ),
  );
  const pagoReparto = await tx.liquidacionPago.findFirstOrThrow({
    where: { mensajeroId, repartoId: { not: null } },
    select: { id: true },
  });
  afirmarOk(
    pasos,
    "anularPagoMensajero",
    await s.liquidacion.anularPago({ pagoId: pagoReparto.id, motivo: "Monto equivocado" }, maestro),
  );
  afirmarOk(
    pasos,
    "pagoMensajero",
    await s.liquidacion.registrarPagoMensajero(
      {
        claveIdempotencia: randomUUID(),
        cierreId,
        monto: "664.00",
        metodo: "efectivo",
        fechaPago: hoy,
      },
      maestro,
    ),
  );

  // ── Egresos administrativos y ajustes ─────────────────────────────────────────────────────
  const sueldo = await s.egresos.registrarEgreso(
    { claveIdempotencia: randomUUID(), tipoEgreso: "sueldo", monto: "45000.00", descripcion: "Sueldo quincena 459" },
    maestro,
  );
  afirmarOk(pasos, "sueldo", sueldo);
  if (sueldo.status !== "ok") throw new Error("imposible");
  afirmarOk(
    pasos,
    "reversarSueldo",
    await s.egresos.reversarEgreso({ movimientoId: sueldo.movimiento.id }, maestro),
  );
  afirmarOk(
    pasos,
    "gastoVariable",
    await s.egresos.registrarEgreso(
      { claveIdempotencia: randomUUID(), tipoEgreso: "gasto_variable", monto: "12345.67", descripcion: "Cajas de carton 459" },
      maestro,
    ),
  );
  afirmarOk(
    pasos,
    "ajusteSuma",
    await s.wallet.registrarMovimientoManual(
      { claveIdempotencia: randomUUID(), tipo: "ingreso", categoria: "ingreso_ajuste", monto: "1000.25", descripcion: "Ajuste 459 +" },
      maestro,
    ),
  );
  afirmarOk(
    pasos,
    "ajusteResta",
    await s.wallet.registrarMovimientoManual(
      { claveIdempotencia: randomUUID(), tipo: "egreso", categoria: "egreso_ajuste", monto: "500.10", descripcion: "Ajuste 459 -" },
      maestro,
    ),
  );

  // ── Gasto fijo: plantilla + cobro pendiente (lo que deja el cron) y su aprobacion ─────────
  const plantillaId = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "gasto_fijo_plantilla"
       ("id","concepto","monto","activa","periodicidad_unidad","periodicidad_cantidad","fecha_cobro")
     VALUES ($1, $2, '80000.00'::numeric, false, 'meses'::"PeriodicidadUnidad", 1, DATE '2026-09-01')`,
    plantillaId,
    `Alquiler 459 ${sufijo}`,
  );
  const cobroGastoFijoId = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO "gasto_fijo_cobro"
       ("id","plantilla_id","origen_id","periodo","concepto","monto","estado","generado_el")
     VALUES ($1, $2, $3, '2026-09', $4, '80000.00'::numeric,
             'pendiente'::"gasto_fijo_cobro_estado", DATE '2026-09-01')`,
    cobroGastoFijoId,
    plantillaId,
    `${plantillaId}:2026-09`,
    `Alquiler 459 ${sufijo}`,
  );
  afirmarOk(
    pasos,
    "aprobarGastoFijo",
    await s.gastoFijo.aprobar({ id: cobroGastoFijoId }, maestro, AHORA_DECISION),
  );

  // ── Premio del ranking y su anulacion ─────────────────────────────────────────────────────
  // Precondicion (no es dinero): un cierre APROBADO del mensajero con una gestion de ese dia y el
  // podio congelado. El cierre se siembra a mano con P = 0: no aporta ningun asiento propio.
  const DIA_PREMIO_459 = diaDelPremio();
  const cierrePremio = await tx.cierreDia.create({
    data: {
      mensajeroId,
      estado: "aprobado",
      destinoTipo: "bodega_satelite",
      destinoZonaId: zona.id,
      totalPagoMensajero: new Prisma.Decimal("0.00"),
      totalEfectivo: new Prisma.Decimal("0.00"),
      solicitadoAt: new Date(`${DIA_PREMIO_459}T23:00:00.000Z`),
    },
    select: { id: true },
  });
  const o7 = await sembrarOrden({ tiendaId: tiendaA, estatus: "entregado", montoCobrar: null });
  await tx.gestionOrden.create({
    data: {
      ordenId: o7.ordenId,
      mensajeroId,
      resultado: "entregado",
      cierreId: cierrePremio.id,
      createdAt: new Date(`${DIA_PREMIO_459}T15:00:00.000Z`),
    },
  });
  const snapshot = await tx.rankingSnapshotDia.create({
    data: { fecha: new Date(`${DIA_PREMIO_459}T00:00:00.000Z`), minAsignadasPodio: 1, filas: 1 },
    select: { id: true },
  });
  const fila = await tx.rankingSnapshotFila.create({
    data: {
      snapshotId: snapshot.id,
      puesto: 1,
      posicion: 1,
      mensajeroId,
      mensajeroNombre: "Mensajero 459",
      entregadas: 18,
      asignadas: 21,
      premioMonto: new Prisma.Decimal("5000.00"),
      premioDescripcion: "Primer puesto 459",
    },
    select: { id: true },
  });
  afirmarOk(pasos, "registrarPremio", await s.premio.registrarPremio({ filaId: fila.id }, maestro));
  afirmarOk(
    pasos,
    "anularPremio",
    await s.premio.anularPremio({ filaId: fila.id, motivo: "Premio duplicado" }, maestro),
  );

  return {
    maestro,
    tiendaA,
    tiendaB,
    mensajeroId,
    cierreId,
    cierrePremioId: cierrePremio.id,
    filaPremioId: fila.id,
    pasos,
  };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// LECTURAS — por los servicios REALES de lectura (los que sirven a las pantallas).
// ═════════════════════════════════════════════════════════════════════════════════════════════

/** Resta de dos importes STRING, con `Prisma.Decimal`, a escala 2. Nunca `number`. */
export function menos(a: string, b: string): string {
  return new Prisma.Decimal(a).sub(new Prisma.Decimal(b)).toFixed(2);
}

/** Lo que devuelven, SIN filtros, las lecturas del libro entero de la caja. */
export async function leerCajaEntera(s: Servicios459, actor: Actor) {
  const resumen = await s.wallet.verResumenCaja({ page: 1, pageSize: 10 }, actor);
  const desglose = await s.egresos.verDesgloseEgresos({ page: 1, pageSize: 10 }, actor);
  if (resumen.status !== "ok" || desglose.status !== "ok") {
    throw new Error("la lectura de la caja no respondio ok");
  }
  return { resumen: resumen.resumen, composicion: resumen.composicion, desglose: desglose.desglose };
}

export type LecturaCaja459 = Awaited<ReturnType<typeof leerCajaEntera>>;

/** Las filas que ESTE escenario escribio en cada libro, normalizadas y ordenadas. */
export async function filasDelEscenario(
  tx: TxDeTest,
  esc: Escenario459,
  idsCajaPrevios: ReadonlySet<string>,
): Promise<{ caja: string[]; tiendaA: string[]; tiendaB: string[]; mensajero: string[] }> {
  const caja = (
    await tx.walletMovimiento.findMany({
      select: { id: true, origenTipo: true, tipo: true, categoria: true, monto: true },
    })
  )
    .filter((f) => !idsCajaPrevios.has(f.id))
    .map((f) => `${f.origenTipo}|${f.tipo}|${f.categoria}|${f.monto.toFixed(2)}`)
    .sort();
  const deTienda = async (tiendaId: string) =>
    (
      await tx.walletTiendaMovimiento.findMany({
        where: { tiendaId },
        select: { origenTipo: true, tipo: true, categoria: true, monto: true },
      })
    )
      .map((f) => `${f.origenTipo}|${f.tipo}|${f.categoria}|${f.monto.toFixed(2)}`)
      .sort();
  const mensajero = (
    await tx.pagoMensajeroMovimiento.findMany({
      where: { mensajeroId: esc.mensajeroId },
      select: { origenTipo: true, tipo: true, categoria: true, monto: true },
    })
  )
    .map((f) => `${f.origenTipo}|${f.tipo}|${f.categoria}|${f.monto.toFixed(2)}`)
    .sort();
  return {
    caja,
    tiendaA: await deTienda(esc.tiendaA),
    tiendaB: await deTienda(esc.tiendaB),
    mensajero,
  };
}

/** Saldo y desglose de una tienda, por las lecturas de `/wallet/tiendas`. */
export async function leerTienda(s: Servicios459, actor: Actor, tiendaId: string) {
  const saldos = await s.walletTienda.listarSaldosTiendas(actor);
  const detalle = await s.walletTienda.listarMovimientosDeTienda(
    { tiendaId, page: 1, pageSize: 50 },
    actor,
  );
  if (saldos.status !== "ok" || detalle.status !== "ok") {
    throw new Error("la lectura de la tienda no respondio ok");
  }
  const fila = saldos.tiendas.find((t) => t.tiendaId === tiendaId);
  if (fila === undefined) throw new Error(`la tienda ${tiendaId} no aparece en los saldos`);
  return { saldo: fila.saldo, signo: fila.signo, desglose: detalle.data.desglose };
}

/** Cuenta por pagar del mensajero, por la lectura de `/wallet/mensajeros`. */
export async function leerMensajero(s: Servicios459, actor: Actor, mensajeroId: string) {
  const cuentas = await s.walletMensajero.listarCuentasPorPagar(actor);
  const libro = await s.walletMensajero.listarPagosDeMensajero(
    { mensajeroId, page: 1, pageSize: 50 },
    actor,
  );
  if (cuentas.status !== "ok" || libro.status !== "ok") {
    throw new Error("la lectura del mensajero no respondio ok");
  }
  const fila = cuentas.mensajeros.find((m) => m.mensajeroId === mensajeroId);
  if (fila === undefined) throw new Error(`el mensajero ${mensajeroId} no aparece en las cuentas`);
  return {
    devengado: fila.devengado,
    pagado: fila.pagado,
    cuentaPorPagar: fila.cuentaPorPagar,
    signo: fila.signo,
    cuentaDelLibro: libro.data.cuenta,
  };
}
