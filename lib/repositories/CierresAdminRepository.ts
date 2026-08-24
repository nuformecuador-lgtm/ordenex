import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ActualizarPagosGestionInput,
  ActualizarPagosGestionResult,
  Alcance,
  CierreAdminResumenRow,
  GestionEditableDelCierre,
  GestionIncidenteDelCierre,
  GestionRetornableDelCierre,
  ICierresAdminRepository,
  ResolverCierreInput,
  ResolverCierreResult,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type {
  CierreGestionPendienteRow,
  CierreSinGestionRow,
} from "@/lib/interfaces/repositories/ICierreDiaRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletFeedService } from "@/lib/interfaces/services/IWalletFeedService";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type { IWalletTiendaFeedService } from "@/lib/interfaces/services/IWalletTiendaFeedService";
import type { IPagoMensajeroMovimientoRepository } from "@/lib/interfaces/repositories/IPagoMensajeroMovimientoRepository";
import type { IWalletMensajeroFeedService } from "@/lib/interfaces/services/IWalletMensajeroFeedService";
import type { IWalletIndemnizacionFeedService } from "@/lib/interfaces/services/IWalletIndemnizacionFeedService";
import type { ICajaCodFeedService } from "@/lib/interfaces/services/ICajaCodFeedService";
import { CajaCodFeedService } from "@/lib/services/CajaCodFeedService";
import type { CierreEstado } from "@/lib/types/cierre";
import type {
  IngresoOrdenexDTO,
  TarifaSnapshotDTO,
} from "@/lib/interfaces/services/ICierreDiaService";
import type { CierreGestionDescargaDTO } from "@/lib/interfaces/services/ICierresAdminService";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import type {
  CatalogoFiltrosCierresDTO,
  FiltrosCierres,
  FiltrosDescargaGestiones,
} from "@/lib/types/filtros-cierres";
import { inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";
import { ESTADOS_COLA_CIERRE_DIA } from "@/lib/utils/colas-cierre";
// Feature 238 (T1.3/T3.3): el PUNTO UNICO de «que paquete vuelve a bodega». Lo leen las DOS
// consultas de esta feature —la del conjunto esperado y la de la marca— para que no puedan
// divergir entre si ni de lo que la pantalla pinta.
import { RESULTADOS_QUE_VUELVEN } from "@/lib/types/gestion-retorno";

/** Valores de rol que este catálogo consulta. Salen del seed, no se inventan aquí. */
const ROL_ADMIN_SATELITE = "adminSatelite";
const ROL_MENSAJERO = "mensajero";
import { CierreDetalleFaltanteError, tarifaDe } from "@/lib/utils/cierre-detalle";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { esRechazoSla, ORIGEN_TIPO_RECHAZO_SLA } from "@/lib/utils/rechazo-sla-flag";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";
import {
  esGestionDeLaTienda,
  ORIGENES_GESTION_DE_LA_TIENDA,
} from "@/lib/utils/gestion-de-la-tienda-flag";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
// 💰 FEATURE 273 (T9, R21/R33): el PREDICADO UNICO del conteo de intentos, IMPORTADO y no
// reescrito. R33 prohibe que esta ficha toque el criterio; importarlo es lo que hace imposible
// tener aqui una segunda definicion que divergiera del numero que ven las demas superficies.
import { whereIntentosVigentes } from "@/lib/repositories/OrdenHistorialRepository";

/**
 * 💰 FEATURE 273 (T9, R23/R38) — el `motivo` de la gestion SINTETICA del rechazo por agotamiento.
 *
 * Texto FIJO. No lleva guia, ni destinatario, ni direccion, ni id de orden, ni id de usuario: esta
 * fila la va a leer un admin en el detalle de un cierre y va a sostener un cobro
 * (`cobroRechazado`, 56). `tests/unit/guards/tope-intentos-pii.guardia.test.ts` lo comprueba.
 */
export const MOTIVO_RECHAZO_TOPE_INTENTOS =
  "rechazada al aprobar el cierre: sin gestionar y sin intentos de entrega disponibles";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";
import { toLineasPago } from "@/lib/utils/lineas-pago";
import { computeTotales } from "@/lib/utils/cierre-totales";
// Feature 264 (B4): la proyeccion y el ORDEN de la lista de ordenes sin gestionar, declarados
// una sola vez y compartidos con el detalle propio del mensajero (misma pantalla, mismo dato).
import {
  ORDEN_SIN_GESTION,
  SIN_GESTION_SELECT,
  toSinGestionRow,
} from "@/lib/utils/cierre-sin-gestion";

// Estados de ORIGEN que la resolucion NORMAL (aprobar/rechazar) puede transicionar (R12).
// Feature 111/R15 (Q1-B): se RETIRA `vencido` (revierte parcialmente la 41 R19). El approve/
// reject normal opera SOLO sobre `solicitado`: el flujo normal de un `vencido` es que el
// mensajero lo solicite (`vencido -> solicitado`, R6) o que el admin lo destrabe por la
// VALVULA DE ESCAPE (`forzarSolicitudVencido`, R16) y luego lo apruebe/rechace ya como
// `solicitado`. Los totales NO se recalculan (R4).
const ESTADOS_RESOLUBLES: CierreEstado[] = ["solicitado"];

// Feature 111/R16 + feature 109/R28: estados que la VALVULA DE ESCAPE toca. Transiciona un cierre
// ABIERTO ABANDONADO (`vencido` o —modelo GLOBAL 109— `rechazado`) a `solicitado`, en nombre del
// mensajero ausente que dejaria su bodega bloqueada; guardada por estado. Solo cambia `estado`.
const ESTADOS_REABRIBLES: CierreEstado[] = ["vencido", "rechazado"];

// Pedido humano (2026-08-19): cierre ABIERTO = la plata todavia no esta aprobada. Es el unico
// momento en el que un admin/maestro puede CORREGIR el reparto por metodo que declaro el
// mensajero. `aprobado` y `rechazado` quedan congelados: el primero porque ya se liquido, el
// segundo porque su correccion es re-solicitarlo y volver a declararlo.
//
// NO es `ESTADOS_RESOLUBLES` (solo `solicitado`): un `vencido` es un cierre abierto que el
// mensajero nunca llego a solicitar, y su desglose es tan corregible como el de un `solicitado`.
const ESTADOS_ABIERTOS: CierreEstado[] = ["solicitado", "vencido"];

// El unico resultado con desglose que corregir: los otros cuatro no cobran nada (R8/R25).
const RESULTADO_ENTREGADA = "entregada" as const;
const ESTADO_SOLICITADO: CierreEstado = "solicitado";

/**
 * Feature 173/T B.2 (design §3.1) — el feed que mete el CONTRA-ENTREGA en la caja principal.
 *
 * Va como constante del modulo y NO como dependencia del constructor, y es deliberado: el
 * design lo pide con esas palabras («cero dependencias nuevas en ese constructor»). Puede
 * hacerse porque este feed no tiene estado ni dependencias propias —`new CajaCodFeedService()`
 * no recibe nada— y porque lo que SI hace falta para escribir en la caja, el repositorio de la
 * 42, YA esta inyectado desde la feature 42.
 *
 * El efecto practico de no tocar el constructor es que ninguno de los 12 sitios que construyen
 * este repositorio cambia: las suites de la 42, la 43, la 44 y la 158 se quedan fuera del diff
 * (R68), en vez de ganar un octavo argumento mecanico cada una.
 */
const CAJA_COD_FEED: ICajaCodFeedService = new CajaCodFeedService();

// Feature 42/T8: la resolucion del cierre ahora orquesta una transaccion (para alimentar
// la wallet atomicamente al aprobar, R5/R7) -> el cliente necesita `$transaction`.
// Feature 69/T18: el detalle del admin sale del SNAPSHOT -> necesita `cierreDetail`.
// `zona` y `usuario` entran por el CATÁLOGO de los filtros (pedido humano del 2026-08-16), que
// es una lectura de SOLO CATÁLOGO: proyecta `{id, nombre}` (y la zona del mensajero) y nada más.
// Siguen siendo los únicos delegados que este repositorio puede tocar: el `Pick` es la lista, y
// ampliarla es una decisión que se ve en el diff.
type CierresAdminPrismaClient = Pick<
  PrismaClient,
  | "cierreDia"
  | "gestionOrden"
  | "cierreDetail"
  // Feature 264 (B4): SOLO LECTURA. La escritura del vinculo vive en la tx del corte
  // (`CierreDiaRepository.crearCierre`); aqui se lee para pintar el detalle y —desde la FEATURE 271
  // (T5.1, R35)— para ACOTAR A ESTE CIERRE la liberacion de `sin_gestionar` al aprobar. Sigue
  // siendo lectura: la fila del vinculo no se toca ni se borra al aprobar.
  | "cierreSinGestion"
  | "zona"
  | "usuario"
  | "$transaction"
>;

// Feature 69/T18 (R15) — proyeccion del detalle del cierre YA CREADO: los DESCRIPTIVOS
// congelados de la orden (`WITH_DETALLE` los navegaba VIVOS via `gestion_orden.orden.*`).
// Exportado desde T23: `CierresBodegaAdminRepository` (feature 40) muestra el detalle del
// MISMO cierre_dia ya creado y debe leerlo del MISMO snapshot. Compartir la proyeccion y el
// mapper (y no re-escribirlos) es lo que impide que las dos pantallas de admin diverjan.
export const DETALLE_ADMIN_SELECT = {
  ordenId: true,
  numGuia: true,
  numRemision: true,
  destinatario: true,
  direccion: true,
  producto: true,
  tiendaNombre: true,
  zonaNombre: true,
  provinciaNombre: true,
  cantonNombre: true,
  distritoNombre: true,
  // Entradas de la formula del ingreso + la tarifa congelada (feature 69/R6/R8). El admin
  // ve el desglose completo (flete, IVA, comision) y de que tarifa salio, sin volver a
  // consultar datos VIVOS: el snapshot es la unica fuente (R14).
  montoCobrar: true,
  cobraComision: true,
  esCentral: true,
  tarifaId: true,
  tarifaValorFlete: true,
  tarifaValorFleteGam: true,
  tarifaValorFleteDevuelto: true,
  tarifaValorFleteDevueltoGam: true,
  tarifaFulfillment: true, // 2026-08-19: monto congelado que el detalle y las descargas muestran
  tarifaComisionCod: true,
  tarifaIvaFlete: true,
  tarifaIvaComisionCod: true,
} as const;

// Feature 69/T18 — lo que aporta la GESTION (que NO se congela: es suyo, no de la orden).
// Feature 102/T2 (R1/R3): + la relacion `historialEstados` ACOTADA al origen SLA (feature 99),
// para DERIVAR `esRechazoSla` por gestion sin columna/migracion nueva. `where` + `take: 1` la
// dejan barata (a lo sumo una fila por gestion); el util `esRechazoSla` es el predicado.
/**
 * Las familias de historial que ESTA proyeccion necesita leer, y las UNICAS. Fuera del `as const`
 * del select a proposito: `as const` congelaria el array como `readonly`, y el filtro de Prisma
 * pide uno mutable. Cada miembro alimenta una derivacion pura distinta sobre el MISMO array.
 */
const FAMILIAS_DERIVADAS_DEL_HISTORIAL: OrdenHistorialOrigenTipo[] = [
  ORIGEN_TIPO_RECHAZO_SLA, // feature 102/R1: `esRechazoSla`
  // Feature 237/R41 + 240/R43: `desdeAyudaTienda`. Paso de UN valor a la LISTA, porque la tienda
  // registra gestiones por dos caminos (la pestaña de ayuda y el rechazo manual de una devolucion
  // anclada). Se expande aqui y no se cita el valor suelto: el dia que la lista crezca, esta
  // proyeccion se entera sola.
  ...ORIGENES_GESTION_DE_LA_TIENDA,
];

export const GESTION_ADMIN_SELECT = {
  id: true,
  ordenId: true,
  resultado: true,
  montoRecibido: true,
  metodoPago: true,
  motivo: true,
  fechaReprogramacion: true,
  evidenciaStoragePath: true,
  pagoMensajero: true, // feature 39: snapshot del pago al mensajero
  ingresoBodegaRechazo: true, // feature 56: snapshot del ingreso de bodega por rechazo
  causaIncidente: true, // feature 158/R9/R34: causa tipificada del incidente
  indemnizacion: true, // feature 158/R19/R22/R34: monto capturado al aprobar (null antes)
  // Feature 212/R21/R22/R23: el DESGLOSE del recaudo. Esta proyeccion alimenta los DOS
  // detalles de admin (cierres 38/40 y cierres de bodega, que la reusan con este mismo
  // mapper), asi que el desglose llega a los tres caminos con una sola definicion. Sin
  // fallback al par escalar: una proyeccion que lo olvide da CERO, no un total plausible.
  // `orderBy` sobre el enum nativo = orden de declaracion (efectivo, SINPE, transferencia).
  pagos: { select: { metodo: true, monto: true }, orderBy: { metodo: "asc" } },
  // Feature 237 (D6/R41) — el `where` pasa de UNA igualdad a un `in` de DOS familias, y con eso
  // esta MISMA lectura alimenta AHORA DOS derivaciones (`esRechazoSla` y `desdeAyudaTienda`).
  // ⭑ COSTE: **CERO consultas nuevas** en los dos detalles de admin — la relacion ya se pedia; lo
  // unico que cambia es cuantas familias acepta su filtro. Se hizo asi, y no con una segunda
  // lectura, precisamente porque esta es la pagina que mas filas trae.
  //
  // `take` = TANTAS COMO FAMILIAS FILTRADAS, y no `take: 1`: son familias distintas y una gestion
  // podria, en teoria, tener fila de varias. Con un `take` corto una taparia a la otra segun el
  // orden de lectura, que es la clase de fallo que se ve en produccion y nunca en un test.
  //
  // ⏳ 2026-08-20 (feature 240): aqui habia un `2` LITERAL, correcto mientras las familias fueran
  // dos. Al entrar `rechazo_tienda` serian tres y el `2` habria empezado a truncar EN SILENCIO —el
  // fallo exacto contra el que ese comentario avisaba—. Se ata al tamaño de la lista para que no
  // vuelva a poder desincronizarse: quien añada una familia ya no tiene que acordarse de este
  // numero.
  historialEstados: {
    where: { origenTipo: { in: FAMILIAS_DERIVADAS_DEL_HISTORIAL } },
    take: FAMILIAS_DERIVADAS_DEL_HISTORIAL.length,
    select: { origenTipo: true },
  },
} as const;

type DetalleAdminRow = Prisma.CierreDetailGetPayload<{ select: typeof DETALLE_ADMIN_SELECT }>;
type GestionAdminRow = Prisma.GestionOrdenGetPayload<{ select: typeof GESTION_ADMIN_SELECT }>;

// Money-safe: Decimal -> string escala 2 fija (nunca number/parseFloat).
function decimalToString(d: Prisma.Decimal | null): string | null {
  return d === null ? null : d.toFixed(2);
}

/**
 * Proyecta la tarifa congelada de la fila al DTO, o `null` si la tienda no tenia tarifa
 * vigente al solicitar (`tarifa_id IS NULL`, gap conocido de la feature 69/R9). Con
 * `tarifa_id` presente el resto no puede ser null (R8: se congelan todas o ninguna), y
 * `tarifaVigente` ya normalizo esos campos a STRING escala 2.
 */
function toTarifaSnapshot(d: DetalleAdminRow): TarifaSnapshotDTO | null {
  const t = tarifaDe(d);
  if (d.tarifaId === null || t === null) return null;
  return {
    tarifaId: d.tarifaId,
    valorFlete: t.valorFlete,
    valorFleteGam: t.valorFleteGam,
    valorFleteDevuelto: t.valorFleteDevuelto,
    valorFleteDevueltoGam: t.valorFleteDevueltoGam,
    comisionCod: t.comisionCod,
    ivaFlete: t.ivaFlete,
    ivaComisionCod: t.ivaComisionCod,
    // Se lee de la COLUMNA, no de `tarifaDe`: esa reconstruye la `TarifaVigente` que consume la
    // formula, y el fulfillment no es una entrada de la formula.
    fulfillment: d.tarifaFulfillment === null ? null : d.tarifaFulfillment.toFixed(2),
  };
}

/**
 * Deriva el desglose del ingreso de Ordenex de UNA gestion desde el snapshot, con la MISMA
 * `derivarIngresoOrden` que alimenta las wallets al aprobar: si el admin viera una formula
 * y la liquidacion usara otra, el descuadre seria invisible. Por eso aca no se re-implementa
 * nada, solo se serializa lo que la funcion devuelve.
 *
 * Un concepto AUSENTE en el derivado (`undefined`) se emite como `null`: no aplica a este
 * resultado (una entrega no tiene flete de devolucion). Eso es distinto de "0.00", que es un
 * monto real. El `total` suma solo los presentes.
 */
function toIngresoOrdenex(
  g: Pick<GestionAdminRow, "resultado">,
  d: DetalleAdminRow,
): IngresoOrdenexDTO {
  const tarifa = tarifaDe(d);
  const montoCobrar = decimalToString(d.montoCobrar);
  const derivado = derivarIngresoOrden(
    {
      resultado: g.resultado,
      esCentral: d.esCentral,
      montoCobrar,
      cobraComision: d.cobraComision,
    },
    tarifa,
  );
  let total = new Prisma.Decimal(0);
  for (const monto of Object.values(derivado)) {
    if (monto !== undefined) total = total.plus(monto);
  }
  const opt = (v: Prisma.Decimal | undefined): string | null =>
    v === undefined ? null : v.toFixed(2);
  // Agrupa un concepto con su IVA. Si NINGUNO de los dos aplica -> `null` (el concepto no
  // existe para este resultado), no "0.00": eso es lo que distingue "no aplica" de un cero.
  const conIva = (
    base: Prisma.Decimal | undefined,
    iva: Prisma.Decimal | undefined,
  ): string | null => {
    if (base === undefined && iva === undefined) return null;
    return (base ?? new Prisma.Decimal(0)).plus(iva ?? 0).toFixed(2);
  };
  return {
    montoCobrar,
    cobraComision: d.cobraComision,
    esCentral: d.esCentral,
    flete: opt(derivado.ingreso_flete),
    ivaFlete: opt(derivado.ingreso_iva_flete),
    fleteDevolucion: opt(derivado.ingreso_flete_devolucion),
    ivaFleteDevolucion: opt(derivado.ingreso_iva_flete_devolucion),
    comisionCod: opt(derivado.ingreso_comision_cod),
    ivaComisionCod: opt(derivado.ingreso_iva_comision_cod),
    fleteConIva: conIva(derivado.ingreso_flete, derivado.ingreso_iva_flete),
    fleteDevolucionConIva: conIva(
      derivado.ingreso_flete_devolucion,
      derivado.ingreso_iva_flete_devolucion,
    ),
    comisionConIva: conIva(derivado.ingreso_comision_cod, derivado.ingreso_iva_comision_cod),
    total: total.toFixed(2),
    tarifa: toTarifaSnapshot(d),
  };
}

/**
 * Feature 69/T18 (R15) — compone gestion + snapshot en el MISMO DTO que devolvia
 * `toPendienteRow` (la UI no cambia). La gestion aporta lo suyo (`resultado`, `montoRecibido`,
 * evidencia, snapshots 39/56); `cierre_detail` aporta lo de la ORDEN, CONGELADO.
 */
export function toPendienteRowDesdeSnapshot(
  g: GestionAdminRow,
  d: DetalleAdminRow,
): CierreGestionPendienteRow {
  return {
    gestionId: g.id,
    ordenId: g.ordenId,
    numGuia: d.numGuia,
    numRemision: d.numRemision,
    destinatario: d.destinatario,
    direccion: d.direccion,
    zonaNombre: d.zonaNombre,
    provinciaNombre: d.provinciaNombre,
    cantonNombre: d.cantonNombre,
    distritoNombre: d.distritoNombre,
    producto: d.producto,
    tiendaNombre: d.tiendaNombre,
    resultado: g.resultado,
    montoRecibido: decimalToString(g.montoRecibido),
    // Feature 212/R31: el par escalar se CONSERVA (la 213 decide su retiro)...
    metodoPago: g.metodoPago,
    // ...y el desglose por metodo viaja al lado, money-safe STRING, ya ordenado por la
    // consulta (R21/R22). Es lo unico que suma en `computeTotales`.
    pagos: toLineasPago(g.pagos),
    motivo: g.motivo,
    fechaReprogramacion: g.fechaReprogramacion
      ? g.fechaReprogramacion.toISOString().slice(0, 10)
      : null,
    evidenciaStoragePath: g.evidenciaStoragePath,
    pagoMensajero: decimalToString(g.pagoMensajero),
    ingresoBodegaRechazo: decimalToString(g.ingresoBodegaRechazo),
    // Feature 102/R1/R9: `true` si la gestion tiene una transicion del cron SLA enlazada
    // (`historialEstados` ya viene acotado a esas familias por `GESTION_ADMIN_SELECT`).
    esRechazoSla: esRechazoSla(g.historialEstados),
    // Feature 237 (D6/R41) + 240 (R43): y `true` si la registro LA TIENDA — por la pestaña de
    // ayuda o rechazando a mano una devolucion anclada. Sale de
    // LA MISMA lectura de historial que la linea de arriba: dos predicados PUROS sobre un solo
    // array, ninguna consulta de mas. El detalle de admin lo lleva por la misma razon que el del
    // mensajero: quien audita un cobro tiene que poder ver QUIEN lo decidio.
    desdeAyudaTienda: esGestionDeLaTienda(g.historialEstados),
    // Feature 158/R9/R34: la causa del incidente, para que el admin sepa QUE paso antes de
    // decidir el monto de la indemnizacion. `null` en cualquier otro resultado.
    causaIncidente: g.causaIncidente,
    // Feature 158/R19/R22/R34: el monto capturado al APROBAR (money-safe Decimal -> STRING).
    // `null` mientras el cierre siga `solicitado`: ahi significa «todavia no hay monto», no
    // «monto cero». A diferencia de la vista del mensajero, el detalle de ADMIN SI lo lleva —
    // es quien lo captura y quien tiene que poder auditarlo despues.
    indemnizacion: decimalToString(g.indemnizacion),
    ingresoOrdenex: toIngresoOrdenex(g, d),
  };
}

// Proyeccion de la cabecera de un cierre (join a mensajero/zona para nombres).
const CIERRE_RESUMEN_SELECT = {
  id: true,
  mensajeroId: true,
  estado: true,
  destinoTipo: true,
  destinoZonaId: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  totalPagoMensajero: true, // feature 39/R17: snapshot total del pago al mensajero
  totalIngresoBodegaRechazos: true, // feature 56/R16: snapshot total del ingreso de bodega por rechazos
  solicitadoAt: true,
  resueltoAt: true,
  motivoRechazo: true,
  mensajero: { select: { nombre: true } },
  destinoZona: { select: { nombre: true } },
} as const;

type CierreResumenRow = Prisma.CierreDiaGetPayload<{ select: typeof CIERRE_RESUMEN_SELECT }>;

function toResumenRow(r: CierreResumenRow): CierreAdminResumenRow {
  return {
    cierreId: r.id,
    mensajeroId: r.mensajeroId,
    mensajeroNombre: r.mensajero.nombre,
    estado: r.estado,
    destinoTipo: r.destinoTipo,
    destinoZonaId: r.destinoZonaId,
    destinoZonaNombre: r.destinoZona.nombre,
    totales: {
      efectivo: r.totalEfectivo.toFixed(2),
      simpe: r.totalSimpe.toFixed(2),
      transferencia: r.totalTransferencia.toFixed(2),
      general: r.totalGeneral.toFixed(2),
    },
    totalPagoMensajero: r.totalPagoMensajero.toFixed(2), // R17: snapshot money-safe STRING
    totalIngresoBodegaRechazos: r.totalIngresoBodegaRechazos.toFixed(2), // feature 56/R16: snapshot money-safe STRING
    solicitadoAt: r.solicitadoAt.toISOString(),
    resueltoAt: r.resueltoAt ? r.resueltoAt.toISOString() : null,
    motivoRechazo: r.motivoRechazo,
  };
}

/**
 * Feature 158 (T1.14, R21/R22) — un monto de indemnizacion apunto a una gestion que NO cumple
 * la guardia `(id, cierreId, resultado = incidente)`: no existe, es de otro cierre, o no es un
 * incidente. Se LANZA para que la `$transaction` haga rollback de TODO (la aprobacion, los
 * movimientos de 42/43/44 y los montos ya escritos). Es un error de PROGRAMACION/carrera, no
 * un resultado de dominio: el service ya valido la cobertura EXACTA antes de llamar, asi que
 * llegar aqui significa que el cierre cambio entre la lectura y la escritura.
 *
 * Mensaje SIN PII (patron `TransicionIlegalError`): solo el id del cierre, ni gestiones ni
 * montos ni actores.
 */
export class IndemnizacionNoAplicableError extends Error {
  constructor(readonly cierreId: string) {
    super(`indemnizacion no aplicable a una gestion del cierre ${cierreId}`);
    this.name = "IndemnizacionNoAplicableError";
  }
}

/**
 * Feature 238 (T3.3, design §4.2, R18/R44) — la marca de confirmacion fisica apunta a una gestion
 * que NO cumple la guardia `(id IN ids, cierreId, resultado IN RESULTADOS_QUE_VUELVEN)`: no
 * existe, es de otro cierre, o su paquete no vuelve a bodega.
 *
 * Se LANZA para que la `$transaction` revierta TODO (R18): la aprobacion del cierre, los cinco
 * feeds de dinero, la liberacion de `sin_gestionar`, la devolucion de las `rechazada` y el anclaje
 * de la 239. Sin efectos parciales, y en particular sin un cierre aprobado cuyos paquetes nadie
 * confirmo.
 *
 * Es un error de PROGRAMACION o de CARRERA, no un resultado de dominio: el servicio ya valido la
 * cobertura EXACTA antes de llamar, asi que llegar aqui significa que el cierre cambio entre la
 * lectura y la escritura.
 *
 * Mensaje SIN PII (R44, patron `IndemnizacionNoAplicableError`): solo el id del cierre — ni
 * gestiones, ni guias, ni destinatarios, ni actores.
 */
export class ConfirmacionFisicaNoAplicableError extends Error {
  constructor(readonly cierreId: string) {
    super(`confirmacion fisica no aplicable a una gestion del cierre ${cierreId}`);
    this.name = "ConfirmacionFisicaNoAplicableError";
  }
}

// WHERE del alcance: siempre por destino_tipo; por destino_zona_id SOLO si el alcance
// lo acota (adminSatelite). El maestro (destinoZonaId null) ve todos los central.
function alcanceWhere(alcance: Alcance): { destinoTipo: Alcance["destinoTipo"]; destinoZonaId?: string } {
  return {
    destinoTipo: alcance.destinoTipo,
    ...(alcance.destinoZonaId !== null ? { destinoZonaId: alcance.destinoZonaId } : {}),
  };
}

/**
 * Pedido humano del 2026-08-16 — el WHERE de los FILTROS del listado (fecha, bodega destino,
 * mensajero), declarado UNA vez para los cuatro caminos que leen estos listados: las dos
 * paginas y los dos conjuntos de los que salen los archivos.
 *
 * TRES cosas que este bloque hace y que no son adorno:
 *
 *  1. **Recorta, no reabre.** Lo que devuelve se compone con `alcanceWhere` en el MISMO objeto,
 *     y las claves no chocan: el alcance escribe `destinoTipo`/`destinoZonaId` (escalares) y el
 *     filtro escribe `destinoZonaId: { in: [...] }`... que SI chocaria. Por eso el filtro de
 *     zona NO se escribe como clave hermana: va dentro de un `AND`, que es la unica forma de
 *     que las dos condiciones se exijan A LA VEZ. Un `adminSatelite` que pida la zona del
 *     vecino obtiene la interseccion —vacio—, nunca la zona del vecino.
 *  2. **Las fechas son de CALENDARIO DE COSTA RICA**, no instantes UTC. `solicitadoAt` es un
 *     instante; «del 1 al 3» significa desde el inicio del 1 en CR hasta el inicio del 4 en CR,
 *     y por eso el limite superior es `lt` del dia SIGUIENTE y no `lte` del mismo dia: con
 *     `lte` se perderian los cierres solicitados entre las 00:00 y las 23:59:59.999 del ultimo
 *     dia del rango, que es justo el dia que el usuario acaba de pedir.
 *  3. **Se filtra por `solicitadoAt`**, la fecha por la que estos listados ya se ordenaban y la
 *     unica que TODOS los cierres tienen: filtrar la cola por `resueltoAt` la dejaria siempre
 *     vacia, porque un cierre sin resolver no tiene esa fecha.
 */
export function filtrosWhere(filtros: FiltrosCierres | undefined): Prisma.CierreDiaWhereInput[] {
  if (!filtros) return [];
  const condiciones: Prisma.CierreDiaWhereInput[] = [];

  if (filtros.desde !== undefined || filtros.hasta !== undefined) {
    condiciones.push({
      solicitadoAt: {
        ...(filtros.desde !== undefined ? { gte: inicioDelDiaCREnUtc(filtros.desde) } : {}),
        ...(filtros.hasta !== undefined
          ? { lt: inicioDelDiaSiguienteCREnUtc(filtros.hasta) }
          : {}),
      },
    });
  }
  if (filtros.destinoZonaIds !== undefined) {
    condiciones.push({ destinoZonaId: { in: [...filtros.destinoZonaIds] } });
  }
  if (filtros.mensajeroIds !== undefined) {
    condiciones.push({ mensajeroId: { in: [...filtros.mensajeroIds] } });
  }
  return condiciones;
}

/**
 * Feature 184 — Tanda D (R16) — el ORDEN de los cierres del dia del admin, declarado UNA vez.
 *
 * Lo comparten los CINCO caminos que leen este listado: el listado sin paginar, las dos
 * paginas (cola e historico) y los dos CONJUNTOS de los que salen los archivos. Estaba escrito
 * tres veces —una por metodo— y la tanda D habria sumado dos copias mas.
 *
 * No es simetria: en cuanto un archivo depende de estos conjuntos, si su orden diverge del de
 * la pagina, la fila 26 del archivo deja de ser la primera de la pagina 2 (R5) y no hay ninguna
 * pantalla que lo diga. Una sola declaracion tampoco lo vuelve invisible: los casos de los
 * `*-where.test.ts` fijan el valor ABSOLUTO, asi que cambiar la constante los pone rojos.
 */
const ORDEN_CIERRES_ADMIN = { solicitadoAt: "desc" } as const satisfies Prisma.CierreDiaOrderByWithRelationInput;

/**
 * Feature 184 — Tanda D (R16) — el criterio del HISTORICO, declarado UNA vez para su pagina y
 * para su conjunto.
 *
 * R44 de la 170 sigue vigente y es el motivo del `notIn`: es el espejo EXACTO del `else` con
 * que el servicio manda al historico todo lo que no esta en la cola. Con un
 * `in: ["aprobado","rechazado"]` un estado nuevo del enum desapareceria de las dos listas en
 * vez de caer en el historico.
 */
function historicoWhere(
  alcance: Alcance,
  filtros?: FiltrosCierres,
): Prisma.CierreDiaWhereInput {
  const recortes = filtrosWhere(filtros);
  return {
    ...alcanceWhere(alcance), // R2/R13: el alcance, en el WHERE y nunca en memoria
    estado: { notIn: [...ESTADOS_COLA_CIERRE_DIA] },
    // Sin filtros, `AND: []` no se escribe: el criterio queda IDENTICO al de antes del
    // 2026-08-16, byte a byte, y los `*-where.test.ts` que fijan su valor absoluto lo prueban.
    ...(recortes.length > 0 ? { AND: recortes } : {}),
  };
}

/**
 * Feature 184 — Tanda D (R16) — el criterio de la COLA, declarado UNA vez para su pagina y para
 * su conjunto.
 *
 * COMPLEMENTO EXACTO del de arriba: mismo `alcanceWhere` y la MISMA constante de estados, aqui
 * con `in` (el espejo del `if` del servicio) y alli con `notIn`. Que las dos mitades lean la
 * misma constante es lo que garantiza que ninguna fila quede en las dos listas ni se caiga de
 * las dos — y en esta cola «caerse» significa que un cierre `vencido` deja de verse, con la
 * bodega de su mensajero bloqueada hasta que alguien lo note.
 */
function colaWhere(alcance: Alcance, filtros?: FiltrosCierres): Prisma.CierreDiaWhereInput {
  const recortes = filtrosWhere(filtros);
  return {
    ...alcanceWhere(alcance),
    estado: { in: [...ESTADOS_COLA_CIERRE_DIA] },
    ...(recortes.length > 0 ? { AND: recortes } : {}),
  };
}

/**
 * Feature 230 (T2.1/T7.1, R22/R41) — proyeccion de una gestion para la HOJA FUNDIDA.
 *
 * Es `GESTION_ADMIN_SELECT` con dos diferencias, y las dos son requisitos:
 *
 *  1. **NO selecciona `evidenciaStoragePath`.** No basta con no emitirlo: no se lee. Un campo
 *     que la consulta no trae no puede acabar en el DTO por descuido, ni ser firmado «de paso»
 *     (R22/R41). Lo atornilla `cierres-admin-gestiones-where.test.ts`, que compara esta lista de
 *     claves contra la del detalle y falla si la evidencia reaparece o si la del detalle crece
 *     sin que nadie decida si esta tambien debe crecer.
 *  2. **Sube al cierre** por `mensajeroNombre` y `solicitadoAt` (R8/R11). La descarga de hoy es
 *     de UN cierre y el mensajero va en el nombre del archivo; al cruzar cierres, sin esas dos
 *     celdas las filas no se distinguen.
 *
 * Se declara UNA vez y la usan los DOS repositorios (design §10, riesgo 4): dos proyecciones
 * paralelas es exactamente como el mismo mensajero acaba saliendo con filas distintas segun
 * desde que pantalla se descargue.
 */
export const GESTION_DESCARGA_SELECT = {
  id: true,
  ordenId: true,
  // El grano de `cierre_detail` es (cierre_id, orden_id): una MISMA orden puede aparecer en
  // varios cierres. Al cruzar cierres, emparejar solo por `orden_id` cogeria la fila congelada
  // del cierre equivocado. NO se emite: es la clave del join, no una celda (R42).
  cierreId: true,
  resultado: true,
  montoRecibido: true,
  metodoPago: true,
  motivo: true,
  fechaReprogramacion: true,
  pagoMensajero: true,
  ingresoBodegaRechazo: true,
  causaIncidente: true,
  indemnizacion: true,
  pagos: { select: { metodo: true, monto: true }, orderBy: { metodo: "asc" } },
  historialEstados: {
    where: { origenTipo: ORIGEN_TIPO_RECHAZO_SLA },
    take: 1,
    select: { origenTipo: true },
  },
  // R8/R11: la identidad del CIERRE al que pertenece la gestion.
  cierre: { select: { solicitadoAt: true, mensajero: { select: { nombre: true } } } },
} as const;

type GestionDescargaRow = Prisma.GestionOrdenGetPayload<{
  select: typeof GESTION_DESCARGA_SELECT;
}>;

/**
 * Feature 230 (T2.1/T7.1, R26/R42/R43) — gestion + snapshot congelado -> la fila del DTO de la
 * hoja fundida.
 *
 * Gemelo de `toPendienteRowDesdeSnapshot` y con las MISMAS derivaciones (`decimalToString`,
 * `toLineasPago`, `esRechazoSla`, `toIngresoOrdenex`), pero NO es aquel con campos de menos:
 * es otro DTO. Lo que sale y lo que NO sale son requisitos verificables —sin uuid (R42), sin
 * nada de evidencia (R41), con mensajero y fecha del cierre (R8/R11)—, y un DTO que los
 * declarara opcionales no los sostendria.
 *
 * Exportado como su gemelo y por el mismo motivo: lo usan los DOS repositorios de admin, y
 * compartir el mapper —no copiarlo— es lo que impide que las dos salidas divergan (R26).
 */
export function toGestionDescargaDTO(
  g: GestionDescargaRow,
  d: DetalleAdminRow,
): CierreGestionDescargaDTO {
  // `cierre` es nullable en el modelo (una gestion del dia aun sin cerrar tiene `cierre_id`
  // NULL), pero los DOS caminos de esta feature exigen el cierre en su WHERE. Si llega null,
  // el WHERE dejo de acotar y la fila no tiene ni mensajero ni fecha que emitir: se LANZA con
  // contexto, no se rellena con un texto vacio que se leeria como «sin mensajero».
  if (g.cierre === null) {
    throw new Error(`gestion ${g.id} sin cierre: la proyeccion de descarga exige cierre_id`);
  }
  return {
    mensajeroNombre: g.cierre.mensajero.nombre,
    cierreSolicitadoAt: g.cierre.solicitadoAt.toISOString(),
    numGuia: d.numGuia,
    numRemision: d.numRemision,
    destinatario: d.destinatario,
    direccion: d.direccion,
    zonaNombre: d.zonaNombre,
    provinciaNombre: d.provinciaNombre,
    cantonNombre: d.cantonNombre,
    distritoNombre: d.distritoNombre,
    producto: d.producto,
    tiendaNombre: d.tiendaNombre,
    resultado: g.resultado,
    montoRecibido: decimalToString(g.montoRecibido),
    pagos: toLineasPago(g.pagos),
    motivo: g.motivo,
    fechaReprogramacion: g.fechaReprogramacion
      ? g.fechaReprogramacion.toISOString().slice(0, 10)
      : null,
    esRechazoSla: esRechazoSla(g.historialEstados),
    causaIncidente: g.causaIncidente,
    // R47: `null` = todavia sin capturar. NUNCA se sustituye por cero, que diria lo contrario.
    indemnizacion: decimalToString(g.indemnizacion),
    pagoMensajero: decimalToString(g.pagoMensajero),
    ingresoBodegaRechazo: decimalToString(g.ingresoBodegaRechazo),
    ingresoOrdenex: toIngresoOrdenex(g, d),
  };
}

/**
 * Feature 230 (T2.1/T7.1) — el snapshot congelado con su clave de join COMPLETA.
 *
 * Es `DETALLE_ADMIN_SELECT` mas `cierreId`, y no es cosmetico: el grano de `cierre_detail` es
 * `(cierre_id, orden_id)`, asi que en una lectura de UN cierre basta la orden —es lo que hacen
 * los dos detalles de admin—, pero al CRUZAR cierres el `orden_id` deja de ser unico y el
 * emparejamiento cogeria la fila congelada del cierre equivocado. Con montos dentro.
 */
export const DETALLE_DESCARGA_SELECT = {
  ...DETALLE_ADMIN_SELECT,
  cierreId: true,
} as const;

type DetalleDescargaRow = Prisma.CierreDetailGetPayload<{
  select: typeof DETALLE_DESCARGA_SELECT;
}>;

/**
 * Feature 230 (T2.1/T7.1, R26) — empareja cada gestion con su fila congelada y proyecta el DTO.
 *
 * Declarada UNA vez para los dos repositorios: el emparejamiento por `(cierreId, ordenId)` y el
 * criterio de «falta la fila congelada» son lo que las dos salidas tienen que compartir para no
 * divergir (R26).
 *
 * **`CierreDetalleFaltanteError` se conserva como error DURO**, igual que en los dos detalles de
 * admin, y a proposito: un fallback que compusiera la fila con datos VIVOS mostraria valores de
 * HOY disfrazados de congelados —justo el camino de lectura que la feature 69 vino a matar—.
 * El riesgo asumido CRECE aqui y se documenta (design §10.2): antes tumbaba el detalle de un
 * cierre abierto a mano; ahora, un solo cierre corrupto tumba la descarga de un rango de meses.
 * Es riesgo aceptado y declarado, no un descuido.
 */
export function componerGestionesDescarga(
  gestiones: GestionDescargaRow[],
  detalle: DetalleDescargaRow[],
): CierreGestionDescargaDTO[] {
  const porCierreYOrden = new Map(detalle.map((d) => [`${d.cierreId}:${d.ordenId}`, d]));
  return gestiones.map((g) => {
    const d = porCierreYOrden.get(`${g.cierreId}:${g.ordenId}`);
    if (d === undefined) throw new CierreDetalleFaltanteError(g.cierreId ?? "", g.ordenId);
    return toGestionDescargaDTO(g, d);
  });
}

/**
 * Feature 230 (T2.1/T7.1, R11) — el ORDEN de la hoja fundida, declarado UNA vez para los dos
 * caminos.
 *
 * Primera clave: `ORDEN_CIERRES_ADMIN` ELEVADO a la relacion, para que los cierres salgan en el
 * mismo orden en que el listado los enseña. Segunda: el `createdAt desc` con que el detalle de
 * un cierre presenta sus gestiones, para que dentro de cada cierre el archivo diga lo mismo que
 * la pantalla. Las dos juntas son R11: un orden DETERMINISTA y explicable, no el que la base
 * quiera devolver.
 */
export const ORDEN_GESTIONES_DESCARGA = [
  { cierre: ORDEN_CIERRES_ADMIN },
  { createdAt: "desc" },
] as const satisfies Prisma.GestionOrdenOrderByWithRelationInput[];

/**
 * Feature 38 — repositorio de "Cierres del dia" del admin. SOLO queries Prisma. El
 * ALCANCE (rol+zona destino) va SIEMPRE en el WHERE (R2/R13), nunca en memoria.
 *
 * Feature 69/T18 (R15): el detalle de un cierre YA CREADO se compone del SNAPSHOT
 * (`cierre_detail`) + la gestion, y devuelve el MISMO DTO (`CierreGestionPendienteRow`): la UI
 * no cambia. Ya NO reusa `WITH_DETALLE`/`toPendienteRow` de la 37 — esos siguen existiendo
 * para la vista EN VIVO (`findGestionesPendientes`: gestiones con `cierre_id IS NULL`, que por
 * definicion no tienen snapshot). R16 = no romper eso.
 */
export class CierresAdminRepository implements ICierresAdminRepository {
  constructor(
    private readonly prisma: CierresAdminPrismaClient,
    // Feature 42/T8: dependencias del enganche a la wallet (por inyeccion, no logica en el
    // repo: el repo orquesta la tx, el feed construye los movimientos, el repo de wallet
    // los inserta idempotentemente).
    private readonly walletMovimientoRepo: IWalletMovimientoRepository,
    private readonly walletFeedService: IWalletFeedService,
    // Feature 43/T10: enganche al LEDGER por tienda (por inyeccion, misma tx). El feed
    // construye los movimientos por tienda (credito COD + debitos por concepto) y el repo de
    // tienda los inserta idempotentemente EN LA MISMA tx que la 42 (atomico, R5/R7/R12/R13).
    private readonly walletTiendaMovimientoRepo: IWalletTiendaMovimientoRepository,
    private readonly walletTiendaFeedService: IWalletTiendaFeedService,
    // Feature 44/T10: enganche al LIBRO del pago por mensajero (por inyeccion, misma tx). El
    // feed construye los movimientos (devengo + pago) Y el egreso egreso_pago_mensajero de la
    // caja 42 (F1.4-Qa=SI, R17); el repo del libro los inserta idempotentemente y el egreso se
    // inserta con el repo de la 42, TODO en la MISMA tx que 42/43 (atomico, R5/R7/R11/R12).
    private readonly pagoMensajeroMovimientoRepo: IPagoMensajeroMovimientoRepository,
    private readonly walletMensajeroFeedService: IWalletMensajeroFeedService,
    // Feature 158/T1.14 (R22/R26): feed del EGRESO de indemnizacion. Se inyecta como los
    // demas; el repo orquesta la tx, el feed construye el movimiento leyendo lo que esta misma
    // tx acaba de escribir, y el repo de la 42 lo inserta idempotentemente.
    private readonly walletIndemnizacionFeedService: IWalletIndemnizacionFeedService,
  ) {}

  /**
   * Feature 158 (T1.12, R19/R21/R25): las gestiones `incidente` del cierre, con el ALCANCE en el
   * WHERE (via la relacion `cierre`), nunca filtrado en memoria. Fuera de alcance -> [] (no se
   * distingue de "el cierre no tiene incidentes": R25 no revela nada).
   *
   * Fix «tope de negocio» (2026-08-04): el `select` gana `orden.montoCobrar`, el valor de la
   * orden, que es el tope de NEGOCIO del monto de indemnizacion. Es una COLUMNA MAS en la MISMA
   * consulta —mismo WHERE, mismo alcance, ninguna query extra—: el tope no puede costar un
   * round-trip por gestion. Money-safe: sale ya como STRING escala 2 (`null` si la orden no
   * declara valor).
   */
  async findGestionesIncidenteDelCierre(
    cierreId: string,
    alcance: Alcance,
  ): Promise<GestionIncidenteDelCierre[]> {
    const rows = await this.prisma.gestionOrden.findMany({
      // MISMO predicado que la escritura del monto y que el feed: `(cierreId, incidente)`. Que
      // los tres coincidan es lo que impide que el service exija un monto para una gestion que
      // el feed luego no sumaria.
      where: { cierreId, resultado: "incidente", cierre: alcanceWhere(alcance) },
      select: { id: true, orden: { select: { montoCobrar: true } } },
    });
    return rows.map((r) => ({
      gestionId: r.id,
      ordenMontoCobrar: decimalToString(r.orden.montoCobrar),
    }));
  }

  /**
   * Feature 238 (T1.3, design §3.3, R2/R4/R6) — el CONJUNTO ESPERADO de la confirmacion fisica.
   * Molde literal de `findGestionesIncidenteDelCierre`, con tres diferencias que importan:
   *
   *  - `resultado IN RESULTADOS_QUE_VUELVEN` en vez de `= 'incidente'`, y la lista sale del PUNTO
   *    UNICO (`lib/types/gestion-retorno.ts`), no de un literal aqui. Que este WHERE, el de la
   *    escritura de la marca y el de la pantalla lean la MISMA declaracion es lo que impide
   *    exigir la confirmacion de una gestion que la escritura despues no encontraria.
   *  - `anuladaAt: null` como DEFENSA EXPLICITA, no como filtro necesario: una gestion con
   *    `cierre_id` poblado no puede anularse (el vinculo solo lo reciben gestiones vigentes,
   *    `CierreDiaRepository` «PUNTO MONEY-CRITICAL» de la 67, y `deshacerGestion` exige
   *    `cierre_id IS NULL`). Se escribe igual, por simetria con el bloque de anclaje de la 239.
   *  - La proyeccion trae `orden.numGuia` para que R12 se pueda verificar en el servicio contra
   *    la guia REAL del paquete, en la misma consulta y sin un N+1 por fila.
   *
   * El ALCANCE va en el WHERE, por la relacion al cierre (R6): nunca se filtra en memoria, y un
   * cierre fuera de alcance devuelve `[]` sin distinguirse de uno inexistente.
   */
  async findGestionesRetornablesDelCierre(
    cierreId: string,
    alcance: Alcance,
  ): Promise<GestionRetornableDelCierre[]> {
    const rows = await this.prisma.gestionOrden.findMany({
      where: {
        cierreId,
        resultado: { in: [...RESULTADOS_QUE_VUELVEN] },
        anuladaAt: null,
        cierre: alcanceWhere(alcance),
      },
      select: { id: true, resultado: true, orden: { select: { numGuia: true } } },
    });
    return rows.map((r) => ({
      gestionId: r.id,
      numGuia: r.orden.numGuia,
      resultado: r.resultado,
    }));
  }

  /** R2/R4/R5/R8/R9: cierres del alcance, mas reciente primero, totales -> string. */
  async findCierresByAlcance(alcance: Alcance): Promise<CierreAdminResumenRow[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: alcanceWhere(alcance), // R2/R13: filtro por alcance en el WHERE, usa el indice [destinoTipo, destinoZonaId]
      orderBy: ORDEN_CIERRES_ADMIN,
      select: CIERRE_RESUMEN_SELECT,
    });
    return rows.map(toResumenRow);
  }

  /**
   * Feature 184 — Tanda D (T D.1, R1/R14/R15/R16) — el HISTORICO ENTERO del alcance, sin
   * recorte: el conjunto del que sale el archivo de «Cierres del dia — historico».
   *
   * **Por que existe, y por que no bastaba reusar.** Hasta hoy ese archivo se producia
   * releyendo `listarCierresAdmin()`, que llama a `findCierresByAlcance`: el alcance ENTERO,
   * cola e historico juntos, para quedarse con una de las dos mitades. `findCierresByAlcance`
   * NO se puede reusar aqui —a diferencia de lo que pasaba en las tandas B y C, donde el
   * conjunto ya existia— porque no es este conjunto: es su union con el de la cola. Descargar
   * la cola de 30 filas traia tambien los 2000 del historico, y al reves.
   *
   * Es `findHistoricoPaginado` sin `skip`/`take` y sin el `count`: MISMO `historicoWhere` y
   * MISMO `ORDEN_CIERRES_ADMIN` (R16), de una sola declaracion cada uno, para que la pagina N
   * sea el segmento N de este conjunto (R5). UNA consulta y ninguna mas (R15): el `count` de la
   * pagina no viaja aqui, porque el total de un conjunto sin recorte es su longitud.
   */
  async findHistoricoCompleto(
    alcance: Alcance,
    filtros?: FiltrosCierres,
  ): Promise<CierreAdminResumenRow[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: historicoWhere(alcance, filtros),
      orderBy: ORDEN_CIERRES_ADMIN,
      select: CIERRE_RESUMEN_SELECT,
    });
    return rows.map(toResumenRow);
  }

  /**
   * Feature 184 — Tanda D (T D.1, R1/R14/R15/R16) — la COLA ENTERA de pendientes de decision del
   * alcance, sin recorte: el conjunto del que sale el archivo de «Cierres del dia pendientes».
   *
   * Espejo exacto del de arriba, y con el mismo motivo para existir: el archivo de esta cola
   * salia de `findCierresByAlcance`, que trae ADEMAS todo el historico del alcance para
   * descartarlo en memoria.
   *
   * La particion sigue viva en los CUATRO caminos: `colaWhere` y `historicoWhere` leen la MISMA
   * `ESTADOS_COLA_CIERRE_DIA`, una con `in` y otra con `notIn`, y las dos paginas y los dos
   * conjuntos salen de esas dos funciones. Ninguna fila puede quedar en las dos listas ni
   * caerse de las dos.
   */
  async findColaCompleta(
    alcance: Alcance,
    filtros?: FiltrosCierres,
  ): Promise<CierreAdminResumenRow[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: colaWhere(alcance, filtros),
      orderBy: ORDEN_CIERRES_ADMIN,
      select: CIERRE_RESUMEN_SELECT,
    });
    return rows.map(toResumenRow);
  }

  /**
   * Feature 170 — FASE 2 (T I.1, R40/R41/R44/R51/R54): una pagina del HISTORICO + el total.
   *
   * El `where` se construye UNA vez y lo comparten `findMany` y `count`: escribirlo dos veces
   * es como el total acaba contando un conjunto distinto del que se muestra. El alcance sigue
   * saliendo de `alcanceWhere` (R2/R13, el indice [destinoTipo, destinoZonaId]) y el orden
   * sigue siendo `solicitadoAt desc` (R51), igual que el listado sin paginar.
   */
  async findHistoricoPaginado(
    alcance: Alcance,
    rango: RangoPagina,
    filtros?: FiltrosCierres,
  ): Promise<PaginaRepositorio<CierreAdminResumenRow>> {
    // Feature 184/R16: el criterio sale de `historicoWhere`, la MISMA declaracion que usa el
    // conjunto completo del que sale el archivo. Estaba escrito aqui y habria que haberlo
    // escrito otra vez alli.
    const where = historicoWhere(alcance, filtros);
    const [rows, total] = await Promise.all([
      this.prisma.cierreDia.findMany({
        where,
        orderBy: ORDEN_CIERRES_ADMIN, // R51: el mismo criterio del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: CIERRE_RESUMEN_SELECT,
      }),
      this.prisma.cierreDia.count({ where }), // R41: el total del CONJUNTO, no de la pagina
    ]);
    return { items: rows.map(toResumenRow), total };
  }

  /**
   * Feature 170 — FASE 2 (T J.1, R40/R41/R44/R51/R54): una pagina de la COLA de pendientes de
   * decision + el total.
   *
   * Es el COMPLEMENTO EXACTO de `findHistoricoPaginado`: mismo `alcanceWhere`, mismo orden y
   * el MISMO `ESTADOS_COLA_CIERRE_DIA`, aqui con `in` (el espejo del `if` del servicio) y alli
   * con `notIn` (el espejo del `else`). Que los dos lean la misma constante es lo que garantiza
   * que ninguna fila pueda quedar en las dos listas ni caerse de las dos — y en esta cola
   * «caerse» significa que un cierre `vencido` deja de verse, con la bodega de su mensajero
   * bloqueada hasta que alguien lo note.
   *
   * El total es el que la cabecera de la pantalla mostrara (R42): es el del CONJUNTO de la
   * cola, no el de la pagina, y sale del mismo `where` que las filas.
   */
  async findColaPaginada(
    alcance: Alcance,
    rango: RangoPagina,
    filtros?: FiltrosCierres,
  ): Promise<PaginaRepositorio<CierreAdminResumenRow>> {
    // Feature 184/R16: mismo criterio compartido que el conjunto completo de esta cola.
    const where = colaWhere(alcance, filtros);
    const [rows, total] = await Promise.all([
      this.prisma.cierreDia.findMany({
        where,
        orderBy: ORDEN_CIERRES_ADMIN, // R51: el mismo criterio del listado sin paginar
        skip: rango.skip,
        take: rango.take,
        select: CIERRE_RESUMEN_SELECT,
      }),
      this.prisma.cierreDia.count({ where }), // R41: el total del CONJUNTO, no de la pagina
    ]);
    return { items: rows.map(toResumenRow), total };
  }

  /**
   * Pedido humano del 2026-08-16 — las OPCIONES de los filtros de esta pantalla, con las reglas
   * que el humano fijó ese mismo día:
   *
   *   BODEGAS: es un filtro por ZONA, y solo se listan las zonas que pueden SER una bodega —las
   *   que tienen un `adminSatelite` asignado— más la CENTRAL (la GAM). Una zona sin admin de
   *   zona no es una bodega satélite operativa: ofrecerla sería un nombre que nunca devuelve
   *   nada. La central entra siempre, porque es el destino de los cierres que no van a satélite.
   *   (`esCentral` es la columna que la feature 54 renombró desde `es_gam`: misma zona, otro
   *   nombre. Aquí importa porque «GAM» sigue siendo como el humano la llama.)
   *
   *   MENSAJEROS: TODOS los del rol, sin filtrar por estado. Un mensajero dado de baja sigue
   *   siendo dueño de sus cierres pasados, y excluirlo haría esos cierres imposibles de filtrar
   *   en el histórico —la misma trampa que la feature 144 declaró para las cuentas de tienda—.
   *   Cada uno viaja con SU zona: es lo que permite que elegir una bodega recorte la lista de
   *   mensajeros a los de esa zona (el `parentValue` del filtro dependiente).
   *
   * EL ALCANCE SE SIGUE APLICANDO, y aquí hay que ponerlo a mano porque este catálogo ya no se
   * deriva de los cierres: un `adminSatelite` solo ve SU zona y los mensajeros de SU zona. Sin
   * esa acotación, su selector le ofrecería el nombre de la bodega vecina y de su gente —que no
   * devolvería ni una fila, porque el filtro se cruza con el alcance en el `WHERE`, pero le
   * enseñaría una lista de nombres que no le corresponde ver—.
   */
  async findCatalogoFiltros(alcance: Alcance): Promise<CatalogoFiltrosCierresDTO> {
    // El acceso total (`destinoZonaId === null`) ve el catálogo entero; el satélite, la suya.
    const zonaDelActor = alcance.destinoZonaId;
    const [zonas, mensajeros] = await Promise.all([
      this.prisma.zona.findMany({
        where:
          zonaDelActor !== null
            ? { id: zonaDelActor }
            : {
                OR: [
                  { esCentral: true }, // la GAM
                  { usuarios: { some: { rol: { value: ROL_ADMIN_SATELITE } } } },
                ],
              },
        select: { id: true, nombre: true },
        orderBy: { nombre: "asc" }, // orden determinista
      }),
      this.prisma.usuario.findMany({
        where: {
          rol: { value: ROL_MENSAJERO },
          ...(zonaDelActor !== null ? { zonaId: zonaDelActor } : {}),
        },
        // Proyección mínima: id, nombre y su zona. NUNCA email, teléfono, cédula ni hash.
        select: { id: true, nombre: true, zonaId: true },
        orderBy: { nombre: "asc" },
      }),
    ]);

    return {
      zonas,
      mensajeros: mensajeros.map((m: { id: string; nombre: string; zonaId: string | null }) => ({
        id: m.id,
        nombre: m.nombre,
        // `null` = mensajero sin zona asignada (la columna es nullable). Se ofrece igual: sus
        // cierres existen. Lo que no puede es colgar de ninguna bodega en el encadenado.
        zonaId: m.zonaId,
      })),
    };
  }

  /**
   * R6/R7/R9/R13: cierre (solo si casa el alcance) + sus gestiones. Feature 69/T18 (R15/R19):
   * el detalle se compone del SNAPSHOT + la gestion, en el MISMO DTO.
   */
  async findCierreByIdEnAlcance(
    cierreId: string,
    alcance: Alcance,
  ): Promise<{
    cierre: CierreAdminResumenRow;
    gestiones: CierreGestionPendienteRow[];
    sinGestion: CierreSinGestionRow[];
    sinGestionRegistrado: boolean;
  } | null> {
    const cierre = await this.prisma.cierreDia.findFirst({
      where: { id: cierreId, ...alcanceWhere(alcance) }, // R13: guardia de alcance en el WHERE
      // Feature 264 (R27/R28): la marca se pide SOLO aqui, no en `CIERRE_RESUMEN_SELECT`. Los
      // otros cinco usos de esa proyeccion son LISTADOS, que no pintan la seccion: ensancharla
      // les cobraria una columna por fila a cambio de nada.
      select: { ...CIERRE_RESUMEN_SELECT, sinGestionRegistrado: true },
    });
    if (cierre === null) return null; // R13: no existe o de otra bodega/zona (no se distingue)

    // Feature 69/T18 (R15): el detalle de un cierre YA CREADO sale del SNAPSHOT, no de la
    // orden VIVA. Antes esto reusaba `WITH_DETALLE`, que navegaba `gestion_orden.orden.*`: el
    // admin veia los valores de HOY, no los del cierre que esta revisando.
    // R19 sale de aqui gratis: una orden con `deleted_at` sigue mostrandose, y ahora por
    // diseño y no por el accidente de que `WITH_DETALLE` no filtraba `deletedAt`.
    const [gestiones, detalle, sinGestion] = await Promise.all([
      this.prisma.gestionOrden.findMany({
        where: { cierreId }, // R6: gestiones vinculadas a ESTE cierre
        orderBy: { createdAt: "desc" },
        select: GESTION_ADMIN_SELECT,
      }),
      this.prisma.cierreDetail.findMany({
        where: { cierreId },
        select: DETALLE_ADMIN_SELECT,
      }),
      // FEATURE 264 (B4, R7/R12) — LAS ORDENES QUE EL CORTE BARRIO AL CREAR ESTE CIERRE.
      //
      // Tercera consulta del MISMO `Promise.all`, no una tercera ida a la base en serie: el
      // detalle ya paga dos y esta viaja con ellas.
      //
      // R7 va en el `where`, NO en un filtro en memoria: es la unica forma de que las barridas de
      // OTRO cierre del mismo mensajero —o de otro mensajero— no puedan colarse. Este repo ya
      // midio cuatro veces que una mutacion de un `where` sobrevive en verde a los tests de
      // servicio, que usan dobles y no ven el SQL; por eso existe
      // `tests/integration/db/cierre-sin-gestion-sql-real.test.ts`.
      //
      // EL ALCANCE (R8) NO SE REPITE, y no es un olvido: el `findFirst` de arriba ya devolvio
      // `null` y corto antes de llegar aqui si el cierre no casa. Es el mismo camino por el que
      // hoy se protegen las gestiones.
      this.prisma.cierreSinGestion.findMany({
        where: { cierreId },
        orderBy: ORDEN_SIN_GESTION, // R12: determinista, con los `null` de guia en sitio estable
        select: SIN_GESTION_SELECT, // sin `createdAt`: no se pinta (design §2.1)
      }),
    ]);
    const byOrden = new Map(detalle.map((d) => [d.ordenId, d]));
    return {
      cierre: toResumenRow(cierre),
      // R11: lo congelado, tal cual. Ni un `JOIN` con la orden VIVA, que es el error que la
      // feature 69/T18 ya pago una vez en esta misma pantalla.
      sinGestion: sinGestion.map(toSinGestionRow),
      // R27/R28: viaja SIEMPRE junto a la lista. `[]` con `false` no es «no hubo ninguna».
      sinGestionRegistrado: cierre.sinGestionRegistrado,
      // Grano: N gestiones de una orden comparten su UNICA fila congelada.
      // Sin fallback (R14/decision (a)): si falta la fila, es un error DURO, no un silencio
      // que muestre datos vivos disfrazados de congelados.
      gestiones: gestiones.map((g) => {
        const d = byOrden.get(g.ordenId);
        if (d === undefined) throw new CierreDetalleFaltanteError(cierreId, g.ordenId);
        return toPendienteRowDesdeSnapshot(g, d);
      }),
    };
  }

  /**
   * Feature 230 — Tanda 2 (T2.1, R11/R13/R14/R15/R22/R24/R41) — TODAS las gestiones de los
   * cierres del dia que caen dentro del alcance del actor y de los recortes del dialogo.
   *
   * Es la mecanica de `findCierreByIdEnAlcance` —dos consultas, `gestion_orden` +
   * `cierre_detail`, emparejadas por su clave, con error DURO si falta la fila congelada—
   * llevada de UN cierre a MUCHOS, con tres diferencias que son requisitos:
   *
   *  1. **El alcance va en el WHERE, dentro de la relacion `cierre`** (R14/R15), exactamente
   *     como ya hace `findGestionesIncidenteDelCierre`. Los recortes del dialogo se componen
   *     como claves hermanas del mismo objeto, es decir por CONJUNCION: solo pueden QUITAR
   *     filas del alcance, nunca ensancharlo (R37).
   *  2. **`ORDEN_GESTIONES_DESCARGA`** (R11), que eleva a la relacion la MISMA constante de
   *     orden del listado.
   *  3. **`GESTION_DESCARGA_SELECT`, que NO lee `evidencia_storage_path`** (R22/R41).
   *
   * DOS consultas y no N+1: reusar el metodo por id en bucle costaria una consulta por cierre
   * —y, en este camino, un lote de firma de URL por cierre— para tirar las URL despues.
   */
  async findGestionesPorAlcanceCompleto(
    alcance: Alcance,
    filtros: FiltrosDescargaGestiones,
  ): Promise<CierreGestionDescargaDTO[]> {
    const gestiones = await this.prisma.gestionOrden.findMany({
      where: {
        // El alcance y los recortes se componen con `AND`, EXACTAMENTE como `historicoWhere` y
        // `colaWhere`: es la unica forma de que las dos condiciones se exijan a la vez. Como
        // claves hermanas, un `mensajeroId` de recorte podria SUSTITUIR al del alcance en vez
        // de sumarse — que es lo que la guardia `filtros-cierres-alcance` vigila arriba.
        cierre: { ...alcanceWhere(alcance), AND: filtrosWhere(filtros) },
      },
      orderBy: [...ORDEN_GESTIONES_DESCARGA],
      select: GESTION_DESCARGA_SELECT,
    });
    // Sin gestiones no hay snapshot que pedir: la segunda consulta se ahorra entera. No es una
    // optimizacion cosmetica — `cierreId: { in: [] }` es una consulta que se paga para nada, y
    // el conjunto vacio es el desenlace NORMAL de R38 (mensajero sin cierres o fuera de alcance).
    if (gestiones.length === 0) return [];

    const cierreIds = [...new Set(gestiones.map((g) => g.cierreId).filter((id) => id !== null))];
    const detalle = await this.prisma.cierreDetail.findMany({
      where: { cierreId: { in: cierreIds } },
      select: DETALLE_DESCARGA_SELECT,
    });
    return componerGestionesDescarga(gestiones, detalle);
  }

  /**
   * R10-R15 + feature 42/T8 (R5/R7): transicion atomica guardada. Envuelta en
   * `$transaction`: mantiene el `updateMany` guardado (estado resoluble + alcance) y, SOLO
   * si la aprobacion se aplico (count===1 Y nuevoEstado==='aprobado'), alimenta la wallet
   * con los movimientos de ingreso del cierre en la MISMA tx (atomico: si el insert falla,
   * la aprobacion hace rollback). La alimentacion es IDEMPOTENTE (skipDuplicates -> ON
   * CONFLICT DO NOTHING, R6/R13): re-aprobar o un vencido->aprobado no duplica (R12). Un
   * `rechazado` NO alimenta. La distincion count===0 (conflict vs fuera_de_alcance) queda
   * igual.
   */
  /**
   * Pedido humano (2026-08-19) — la gestion a corregir, con el alcance en el WHERE.
   *
   * `cierre: { is: {...} }` y no `cierreId` a secas: la guardia tiene que ser sobre el CIERRE
   * (su destino), que es donde vive el alcance. Una gestion sin cierre no casa el `is` y sale
   * `null`, que es justo lo que se quiere: esta correccion es la de un cierre.
   */
  async findGestionEditableEnCierre(
    gestionId: string,
    alcance: Alcance,
  ): Promise<GestionEditableDelCierre | null> {
    const fila = await this.prisma.gestionOrden.findFirst({
      where: {
        id: gestionId,
        anuladaAt: null,
        cierre: { is: alcanceWhere(alcance) },
      },
      select: {
        id: true,
        cierreId: true,
        resultado: true,
        montoRecibido: true,
        cierre: { select: { estado: true } },
        pagos: { select: { metodo: true, monto: true } },
      },
    });
    if (!fila || fila.cierreId === null || fila.cierre === null) return null;
    return {
      gestionId: fila.id,
      cierreId: fila.cierreId,
      cierreEstado: fila.cierre.estado,
      resultado: fila.resultado,
      // Money-safe: STRING escala 2, nunca `Number`.
      montoRecibido: fila.montoRecibido === null ? null : fila.montoRecibido.toFixed(2),
      pagos: toLineasPago(fila.pagos),
    };
  }

  async actualizarPagosGestion(
    input: ActualizarPagosGestionInput,
  ): Promise<ActualizarPagosGestionResult> {
    const { gestionId, alcance, editadoPor, lineas } = input;
    const alcanceGuard = alcanceWhere(alcance);

    return this.prisma.$transaction(async (tx) => {
      // (1) Anti-TOCTOU: la MISMA condicion que dejo pasar la lectura, reevaluada al escribir.
      // El sello del rastro ES la guardia — si no se sella, no se toca ni una linea.
      const sello = await tx.gestionOrden.updateMany({
        where: {
          id: gestionId,
          anuladaAt: null,
          resultado: RESULTADO_ENTREGADA,
          cierre: { is: { estado: { in: ESTADOS_ABIERTOS }, ...alcanceGuard } },
        },
        data: { pagosEditadosAt: new Date(), pagosEditadosPor: editadoPor },
      });
      if (sello.count !== 1) {
        // No se distingue «se cerro entre medias» de «no es tuyo»: la lectura previa ya
        // decidio eso con informacion fresca, y aqui cualquiera de los dos es lo mismo.
        const existe = await tx.gestionOrden.count({ where: { id: gestionId } });
        return { status: existe > 0 ? ("conflict" as const) : ("fuera_de_alcance" as const) };
      }

      // (2) El desglose es un CONJUNTO: se sustituye entero. Un `upsert` por metodo dejaria
      // viva la linea del metodo que la correccion quita.
      await tx.gestionOrdenPago.deleteMany({ where: { gestionId } });
      if (lineas.length > 0) {
        await tx.gestionOrdenPago.createMany({
          data: lineas.map((l: ActualizarPagosGestionInput["lineas"][number]) => ({
            gestionId,
            metodo: l.metodo,
            monto: new Prisma.Decimal(l.monto),
          })),
        });
      }

      // (3) Los totales del cierre, recalculados con la MISMA funcion que los congelo al
      // solicitarlo, sobre las gestiones de ESE cierre. Recalcular (y no sumar un delta) es lo
      // que garantiza que snapshot y lineas no puedan divergir.
      //
      // El conjunto es el mismo que vio `computeTotales` al crear el cierre: las gestiones
      // vinculadas y no anuladas. (Anular exige `cierre_id IS NULL`, feature 67, asi que dentro
      // de un cierre no hay anuladas; el filtro se escribe igual, por si esa regla cambia.)
      const deLaGestion = await tx.gestionOrden.findUnique({
        where: { id: gestionId },
        select: { cierreId: true },
      });
      const cierreId = deLaGestion?.cierreId ?? null;
      if (cierreId === null) throw new Error("gestion sin cierre tras el sello");

      const gestiones = await tx.gestionOrden.findMany({
        where: { cierreId, anuladaAt: null },
        select: { resultado: true, pagos: { select: { metodo: true, monto: true } } },
      });
      const totales = computeTotales(
        gestiones.map((g) => ({ resultado: g.resultado, pagos: toLineasPago(g.pagos) })),
      );

      // (4) El snapshot, con la MISMA guardia de estado y alcance. `total_general` va tambien:
      // no puede cambiar —solo cambia de balde—, y escribirlo es lo que hace que un descuadre
      // se vea como un fallo aqui en vez de como un numero raro tres pantallas mas alla.
      const actualizados = await tx.cierreDia.updateMany({
        where: { id: cierreId, estado: { in: ESTADOS_ABIERTOS }, ...alcanceGuard },
        data: {
          totalEfectivo: new Prisma.Decimal(totales.efectivo),
          totalSimpe: new Prisma.Decimal(totales.simpe),
          totalTransferencia: new Prisma.Decimal(totales.transferencia),
          totalGeneral: new Prisma.Decimal(totales.general),
        },
      });
      if (actualizados.count !== 1) throw new Error("cierre no actualizado");

      return { status: "updated" as const, totales };
    });
  }

  async resolverCierre(input: ResolverCierreInput): Promise<ResolverCierreResult> {
    const {
      cierreId,
      alcance,
      nuevoEstado,
      resueltoPor,
      motivoRechazo,
      liberacionSinGestionar,
      devolucionRechazadas,
      indemnizaciones,
    } = input;
    // Feature 239 (T2.1/T2.2): presente SOLO en la rama `aprobado` de la union discriminada.
    // Se lee aqui, fuera de la tx, para que el bloque de abajo no vuelva a estrechar el tipo.
    const anclajeDevolucion =
      input.nuevoEstado === "aprobado" ? input.anclajeDevolucion : undefined;
    // Feature 238 (T3.2/T3.3): igual que el anclaje, solo existe en la rama `aprobado`. Al
    // rechazar queda `[]` y el bloque de abajo no corre — que es R24 sostenido por el tipo, no
    // por un `if` que alguien pueda mover.
    const confirmacionFisica =
      input.nuevoEstado === "aprobado" ? input.confirmacionFisica : [];
    const alcanceGuard = alcanceWhere(alcance);

    const count = await this.prisma.$transaction(async (tx) => {
      // R12/R13 + feature 41/E1 (R19): aplica SOLO si sigue en un estado resoluble
      // (`solicitado` o `vencido`) Y casa el alcance (guardia en WHERE).
      const res = await tx.cierreDia.updateMany({
        where: { id: cierreId, estado: { in: ESTADOS_RESOLUBLES }, ...alcanceGuard },
        data: {
          estado: nuevoEstado,
          resueltoPor,
          resueltoAt: new Date(),
          motivoRechazo,
        },
      });

      // R5/R7: solo al APROBAR y si se aplico, construir e insertar los movimientos de
      // ingreso EN LA MISMA TX (todo-o-nada). `rechazado` no toca la wallet.
      if (res.count === 1 && nuevoEstado === "aprobado") {
        // Feature 239 (T2.3) — RETIRADO el `updateMany` que encendia `orden.gestion_aprobada`
        // sobre las devoluciones de este cierre (pedido humano del 2026-08-18). Era la mitad
        // implementada del fallo: quitaba la visibilidad sin mover el reloj, y ademas NO acotaba
        // el estatus actual, asi que podia encender la marca sobre una orden que ya estaba en
        // bodega. Lo SUSTITUYE el bloque de ANCLAJE del final de esta rama, que es una
        // transicion de estado de verdad —guardada por el pre-estado y registrada en el
        // historial—, no una bandera que alguien tiene que acordarse de apagar en siete sitios.
        //
        // Feature 158 (T1.14, R19-R22/R26): PRIMERO se persiste cada monto capturado, con
        // `cierreId` y `resultado` como GUARDIA del WHERE (no como filtro cosmetico): una
        // gestion de OTRO cierre, o que no sea `incidente`, no se puede tarifar. Si algun
        // `count` es 0, se LANZA -> rollback de TODO (la aprobacion incluida, R22).
        //
        // Va ANTES de los feeds a proposito: el feed de indemnizacion LEE de la base lo que
        // este bloque acaba de escribir (design §9.3), asi que el orden no es estetico.
        if (indemnizaciones && indemnizaciones.length > 0) {
          for (const { gestionId, monto } of indemnizaciones) {
            const aplicado = await tx.gestionOrden.updateMany({
              where: { id: gestionId, cierreId, resultado: "incidente" },
              data: { indemnizacion: new Prisma.Decimal(monto) }, // money-safe: STRING -> Decimal
            });
            if (aplicado.count !== 1) {
              throw new IndemnizacionNoAplicableError(cierreId);
            }
          }
        }

        const movs = await this.walletFeedService.construirMovimientosDeIngreso(cierreId, tx);
        await this.walletMovimientoRepo.crearMovimientos(tx, movs); // R6/R13: idempotente
        // Feature 43/T10 (R5/R7/R12/R13): TRAS alimentar la 42, alimenta el LEDGER por tienda
        // en la MISMA tx (todo-o-nada: si falla, rollback de la aprobacion Y de la 42).
        const movsTienda = await this.walletTiendaFeedService.construirMovimientosPorTienda(
          cierreId,
          tx,
        );
        await this.walletTiendaMovimientoRepo.crearMovimientos(tx, movsTienda); // R6/R13: idempotente

        // Feature 173/T B.2 (design §3.1, R11/R12/R15): TRAS acreditar el ledger por tienda, el
        // CONTRA-ENTREGA entra en la CAJA PRINCIPAL, en la MISMA tx (todo-o-nada: si el insert
        // falla, la aprobacion entera revierte y no queda un cierre aprobado sin su COD).
        //
        // El orden respecto a la linea de arriba NO es estetico y no se sostiene en este
        // comentario: el feed LEE del ledger los creditos que `crearMovimientos` acaba de
        // escribir (R12), asi que invertirlo dejaria la caja sin el ingreso.
        // `cierres-admin-caja-cod.test.ts` lo afirma midiendo el orden real de las llamadas.
        //
        // La guardia es la transcripcion literal del antecedente de R13 —«si un cierre no
        // acredita contra-entrega alguno»—: la acreditacion es exactamente el credito
        // `cod_recaudado` que el feed de la 43 acaba de construir. Si no lo hay, no hay nada
        // que leer ni que emitir. NO decide el MONTO (eso sale del ledger y solo del ledger):
        // decide si hay algo que preguntar.
        const acreditoCod = movsTienda.some(
          (m) => m.tipo === "credito" && m.categoria === "cod_recaudado",
        );
        if (acreditoCod) {
          const ingresoCod = await CAJA_COD_FEED.construirIngresoCod(cierreId, tx);
          if (ingresoCod.length > 0) {
            // R14/R48: idempotente por el indice unico parcial (origen_tipo, origen_id,
            // categoria) de la 42. Re-aprobar NO emite un segundo ingreso, y la barrera es la
            // base, no un `if` de aqui.
            await this.walletMovimientoRepo.crearMovimientos(tx, ingresoCod);
          }
        }

        // Feature 44/T10 (R5/R7/R11/R12/R17): TRAS 42 y 43, alimenta el LIBRO del pago por
        // mensajero EN LA MISMA tx (todo-o-nada). El feed lee el cierre una vez y devuelve el
        // libro (devengo + pago) Y el egreso egreso_pago_mensajero=P para la caja 42 (Qa=SI).
        const movsMensajero = await this.walletMensajeroFeedService.construirMovimientosDePago(
          cierreId,
          tx,
        );
        await this.pagoMensajeroMovimientoRepo.crearMovimientos(tx, movsMensajero.libro); // R6/R12: idempotente
        // Qa (R17): el egreso del costo total P se inserta con el repo de la 42, idempotente por
        // el constraint existente (origen_tipo, origen_id, categoria) -> un egreso por cierre. Se
        // toca la caja 42 SOLO si hay egreso (P>0); si P=0 el feed no lo emite y no se re-inserta.
        if (movsMensajero.egresoCaja.length > 0) {
          await this.walletMovimientoRepo.crearMovimientos(tx, movsMensajero.egresoCaja);
        }

        // Feature 158 (T1.14, R26/R27/R28): TRAS 42/43/44, el EGRESO de indemnizacion, en la
        // MISMA tx. El feed lee de la base la suma de `gestion_orden.indemnizacion` de las
        // gestiones `incidente` de ESTE cierre —lo que el bloque de arriba acaba de escribir—
        // y devuelve 0 o 1 movimiento. Cierre sin incidentes -> lista vacia -> ni una fila en
        // 0.00 (R27). Se inserta con el repo de la 42, idempotente por el indice unico parcial
        // `(origen_tipo, origen_id, categoria)`: reintentar la aprobacion NO duplica (R28).
        const egresoIndemnizacion =
          await this.walletIndemnizacionFeedService.construirEgresoIndemnizacion(cierreId, tx);
        if (egresoIndemnizacion.length > 0) {
          await this.walletMovimientoRepo.crearMovimientos(tx, egresoIndemnizacion);
        }

        // Feature 109 (T3.1, R16-R19/R22/R27): LIBERA a bodega las ordenes `sin_gestionar` del
        // mensajero del cierre, EXCLUSIVAMENTE en esta rama `aprobado` (un RECHAZO no libera, R27) y
        // en la MISMA tx (atomico con la transicion del cierre y los wallets). Money-neutral: solo
        // toca `orden.*` (NO recalcula snapshots, R23). Un cierre NORMAL (sin `sin_gestionar`) o una
        // 2.ª corrida encuentran 0 filas -> no-op sin tocar `prioridad` (R19/R20).
        if (liberacionSinGestionar) {
          const cierre = await tx.cierreDia.findUnique({
            where: { id: cierreId },
            // FEATURE 271 (T5.2): + la bandera de la 264. Decide si este cierre SABE que ordenes
            // barrio o si su lista es irrecuperable (ver mas abajo).
            select: { mensajeroId: true, sinGestionRegistrado: true },
          });
          if (cierre !== null) {
            const {
              sinGestionarEstatusId,
              enBodegaEstatusId,
              enBodegaSateliteEstatusId,
              centralZonaId,
              // FEATURE 273 (T9, R7/R21): el destino del rechazo y el umbral, los dos INYECTADOS.
              rechazadaEstatusId,
              umbralIntentos,
            } = liberacionSinGestionar;
            // ─── FEATURE 271 (T5.1, R35/R37) — LA LIBERACION SE ACOTA A **ESTE** CIERRE ──────────
            //
            // ⚠️ AQUI VIVIA EL FALLO MUDO **M7**. El `where` era `{ mensajeroAsignadoId, estatusId:
            // sin_gestionar }` — por MENSAJERO, no por CIERRE—. Con el invariante 109/R30 vivo (un
            // solo cierre abierto) daba lo mismo: todas las `sin_gestionar` del mensajero eran de
            // ese cierre. La ficha 271 DEROGA ese invariante (R9), y desde entonces aprobar el 1.º
            // VACIA TAMBIEN LA MANO DEL 2.º: sus ordenes vuelven a bodega, pierden mensajero y se
            // marcan prioritarias, mientras su cierre sigue abierto y ya no tiene nada que liberar.
            // Nada se pone rojo: el `updateMany` reporta filas movidas y todas sus guardas se
            // cumplen.
            //
            // LA FUENTE CORRECTA YA EXISTE: `cierre_sin_gestion` (feature 264) guarda, POR CIERRE,
            // que ordenes barrio. Se AÑADE `id: { in: ... }` y se CONSERVAN todas las guardas
            // actuales (`estatusId = sin_gestionar`, `deletedAt: null`, el `updateMany` guardado y
            // el choke point del historial). `mensajeroAsignadoId` se CONSERVA tambien: ahi deja de
            // ser el criterio de SELECCION y pasa a ser una guarda de PROPIEDAD.
            //
            // ⚠️ EL CASO DE LOS CIERRES VIEJOS, QUE ES EL QUE SE OLVIDA. `sin_gestion_registrado`
            // marca con `false` los cierres ANTERIORES al registro de la 264, cuya lista es
            // IRRECUPERABLE (la aprobacion ya borro el unico rastro). La migracion de la 264 puso
            // `false` exactamente a los que NO estaban en los tres estados abiertos, asi que todo
            // cierre aprobable hoy lo tiene en `true`. Aun asi la bandera se comprueba: con `false`
            // se CONSERVA el comportamiento de siempre (por mensajero) en vez de liberar CERO
            // ordenes en silencio. Un `[]` implicito ahi seria un fallo mudo NUEVO, y esta ficha
            // existe para cerrar tres, no para abrir el cuarto.
            const barridasDeEsteCierre = cierre.sinGestionRegistrado
              ? (
                  await tx.cierreSinGestion.findMany({
                    where: { cierreId },
                    select: { ordenId: true },
                  })
                ).map((f) => f.ordenId)
              : null; // `null` = lista irrecuperable -> se libera por mensajero, como antes
            // R16/R19: ordenes `sin_gestionar` de ESTE cierre (guarda por estatus + propiedad).
            const ordenes = await tx.orden.findMany({
              where: {
                // R35: el acotado. `undefined` cuando la lista es irrecuperable, y entonces Prisma
                // omite la condicion — que es EXACTAMENTE el comportamiento anterior.
                ...(barridasDeEsteCierre === null ? {} : { id: { in: barridasDeEsteCierre } }),
                mensajeroAsignadoId: cierre.mensajeroId, // se CONSERVA: propiedad, no seleccion
                estatusId: sinGestionarEstatusId,
                deletedAt: null,
              },
              select: { id: true, zonaId: true },
            });
            // ─── 💰 FEATURE 273 (T9, R21-R27) — EL CORTE SE PARTE EN DOS DESTINOS ────────────
            //
            // Absorbe la ficha 218. Una orden barrida a `sin_gestionar` que YA AGOTO sus intentos
            // de entrega NO vuelve a bodega: se termina en `rechazada`, dentro de ESTA MISMA
            // transaccion (R21).
            //
            // EL CONTEO SE HACE **DENTRO DE LA TRANSACCION**, y no antes de abrirla: entre la
            // lectura y la escritura otra aprobacion puede subir el contador, y el numero que
            // decide tiene que ser el que ve la propia transaccion.
            //
            // El predicado se IMPORTA (`whereIntentosVigentes`), no se reescribe: es el punto UNICO
            // del criterio (215/R4/R6) y R33 prohibe tocarlo desde esta ficha. `groupBy` por el par
            // `(ordenId, cierreId)` porque el GRANO es el cierre, no la gestion (215/R29): dos
            // gestiones contables de la misma orden en el mismo cierre aprobado suman UNA.
            //
            // *Nota que se COMPRUEBA, no se confia* (design §5.5): el `updateMany` del propio
            // cierre ya corrio, asi que dentro de esta tx ESTE cierre ya esta `aprobado`. Una orden
            // barrida a `sin_gestionar` no puede tener una gestion vigente en el cierre que la
            // barrio —para ser barrida tuvo que estar en `en_reparto`/`ayuda_tienda`, es decir sin
            // desenlace registrado, y una gestion deshecha lleva `anulada_at` y no cuenta—. El caso
            // 3 de `cierre-sin-gestion-tope-sql-real.test.ts` lo MIDE contra Postgres.
            const idsBarridas = ordenes.map((o) => o.id);
            const gruposIntentos =
              idsBarridas.length > 0
                ? await tx.gestionOrden.groupBy({
                    by: ["ordenId", "cierreId"],
                    where: whereIntentosVigentes({ in: idsBarridas }),
                  })
                : [];
            const intentosPorOrden = new Map<string, number>();
            for (const g of gruposIntentos) {
              intentosPorOrden.set(g.ordenId, (intentosPorOrden.get(g.ordenId) ?? 0) + 1);
            }
            const enElTope = ordenes.filter(
              (o) => (intentosPorOrden.get(o.id) ?? 0) >= umbralIntentos,
            );
            // R25: por debajo del umbral, la rama de siempre, INTACTA.
            const aBodega = ordenes.filter(
              (o) => (intentosPorOrden.get(o.id) ?? 0) < umbralIntentos,
            );

            if (enElTope.length > 0) {
              const ids = enElTope.map((o) => o.id);
              // R21 — `updateMany` GUARDADO por `estatusId = sin_gestionar`, y `data` con UNA SOLA
              // CLAVE. Diferencia DELIBERADA con la liberacion de al lado, que si limpia mensajero,
              // `asignado_at` y `fecha_reparto` y enciende `prioridad`: aquella orden va a
              // RE-REPARTO y esta no vuelve a repartirse nunca.
              //
              // ⚠️ Y CONSERVAR EL MENSAJERO NO ES UN OLVIDO: es lo que hace que el bloque de la
              // feature 139, que corre inmediatamente despues en esta misma transaccion y
              // selecciona por `{ mensajeroAsignadoId = cierre.mensajeroId, estatusId = rechazada }`,
              // recoja estas ordenes y las lleve a `por_devolver` / `por_devolver_a_tienda`. Si se
              // limpiara el mensajero, la orden se quedaria en `rechazada` sin nadie que la moviera
              // de ahi y el paquete no volveria nunca a la tienda.
              const movidas = await tx.orden.updateMany({
                where: { id: { in: ids }, estatusId: sinGestionarEstatusId, deletedAt: null },
                data: { estatusId: rechazadaEstatusId },
              });
              if (movidas.count > 0) {
                for (const ordenId of ids) {
                  // 💰 R23 (Q1, FIRMADA el 2026-08-24: SI COBRA) — LA GESTION SINTETICA.
                  //
                  // `resultado = rechazada`, `cierre_id NULL` y `mensajero_id` del cierre: es la
                  // via de siempre (Option A de la 99, ratificada por la 240/D1). Con `cierre_id`
                  // nulo, `CierreDiaRepository.crearCierre` la vincula al SIGUIENTE cierre de ese
                  // mensajero, y al aprobarse ese cierre el `cobroRechazado` (56) entra como
                  // ingreso de bodega.
                  //
                  // La razon que se firmo es la de la 240: *sin la gestion, rechazar saldria gratis
                  // y esperar al plazo costaria, sobre el mismo paquete*. Un rechazo por
                  // agotamiento que no cobrara haria que NO GESTIONAR SALGA MAS BARATO QUE
                  // GESTIONAR.
                  //
                  // ⚠️ NO se le pone `cierreId: cierreId`. Meterla en ESTE cierre cambiaria sus
                  // totales DESPUES de que el snapshot se congelara al solicitar, y eso mueve
                  // dinero de un cierre que ya se esta aprobando (R24).
                  //
                  // El `motivo` es un texto FIJO y sin PII (R38): ni guia, ni destinatario, ni ids.
                  const gestion = await tx.gestionOrden.create({
                    data: {
                      ordenId,
                      mensajeroId: cierre.mensajeroId,
                      resultado: "rechazada",
                      cierreId: null,
                      motivo: MOTIVO_RECHAZO_TOPE_INTENTOS,
                    },
                    select: { id: true },
                  });
                  // R22 — por el punto UNICO de escritura del historial, con el ADMIN que aprobo
                  // como actor y con la familia PROPIA `rechazo_tope_intentos`. Enlaza la gestion:
                  // es lo que permite auditar QUE cobro nacio de QUE aprobacion sin re-derivarlo.
                  await appendCambioEstado(tx, [
                    {
                      ordenId,
                      estatusOrigenId: sinGestionarEstatusId,
                      estatusDestinoId: rechazadaEstatusId,
                      actorUsuarioId: resueltoPor,
                      origenTipo: "rechazo_tope_intentos",
                      gestionOrdenId: gestion.id,
                    },
                  ]);
                }
              }
            }

            if (aBodega.length > 0) {
              // R16: destino por ZONA de la ORDEN (resolverDestinoCierre, misma regla 99/100).
              const idsByDestino = new Map<string, string[]>();
              for (const o of aBodega) {
                const { destinoTipo } = resolverDestinoCierre(o.zonaId, centralZonaId);
                const destinoEstatusId =
                  destinoTipo === "bodega_central" ? enBodegaEstatusId : enBodegaSateliteEstatusId;
                const arr = idsByDestino.get(destinoEstatusId);
                if (arr) arr.push(o.id);
                else idsByDestino.set(destinoEstatusId, [o.id]);
              }
              for (const [destinoEstatusId, ids] of idsByDestino) {
                // R16/R17/R19: molde de `recuperarABodega` — updateMany GUARDADO por
                // `estatus_id = sin_gestionar`, limpia mensajero/asignado_at + `prioridad = true`.
                const movidas = await tx.orden.updateMany({
                  where: { id: { in: ids }, estatusId: sinGestionarEstatusId, deletedAt: null },
                  data: {
                    estatusId: destinoEstatusId,
                    mensajeroAsignadoId: null, // R16: handoff limpio a la bodega
                    asignadoAt: null, // R16
                    fechaReparto: null, // feature 246/R9/R10: acompana SIEMPRE a `asignado_at`
                    prioridad: true, // R17: reasignacion prioritaria (101/110)
                  },
                });
                // R18/R22: choke point SOLO de las que transicionaron; actor = admin, origen dedicado.
                if (movidas.count > 0) {
                  await appendCambioEstado(
                    tx,
                    ids.map((ordenId) => ({
                      ordenId,
                      estatusOrigenId: sinGestionarEstatusId,
                      estatusDestinoId: destinoEstatusId,
                      actorUsuarioId: resueltoPor, // R18: el admin que aprobo
                      origenTipo: "liberacion_sin_gestionar", // R18
                    })),
                  );
                }
              }
            }
          }
        }

        // Feature 139 (T1.3, R5/R6/R7/R8/R11): DISPARA la devolucion de las `rechazada` del
        // mensajero del cierre, DESPUES de la liberacion `sin_gestionar` y EN LA MISMA tx
        // `aprobado` (atomico con la transicion del cierre + wallets + liberacion, R6). Un RECHAZO
        // no dispara (vive dentro del `if (nuevoEstado === 'aprobado')`, R10). Money-neutral (R8):
        // SOLO cambia `estatus_id` — a diferencia de la liberacion 109, NO limpia
        // mensajero/asignado_at ni marca `prioridad` (aqui la orden va a DEVOLUCION, no se reasigna).
        // Idempotente (R7): la guarda `estatus_id = rechazada` del updateMany + el hecho de que un
        // cierre ya `aprobado` no vuelve a entrar por la guarda del updateMany del propio cierre
        // (count=0) garantizan que una 2.a corrida encuentra 0 filas. `findUnique` propio (no reusa
        // el de la liberacion): ambas ramas son independientes y cada una puede venir sola.
        if (devolucionRechazadas) {
          const cierreDev = await tx.cierreDia.findUnique({
            where: { id: cierreId },
            select: { mensajeroId: true },
          });
          if (cierreDev !== null) {
            const { rechazadaId, porDevolverId, porDevolverATiendaId, centralZonaId } =
              devolucionRechazadas;
            // R5: `rechazada` del mensajero del cierre (guarda por estatus + propiedad).
            const rechazadas = await tx.orden.findMany({
              where: {
                mensajeroAsignadoId: cierreDev.mensajeroId,
                estatusId: rechazadaId,
                deletedAt: null,
              },
              select: { id: true, zonaId: true },
            });
            if (rechazadas.length > 0) {
              // R5: destino por ZONA de la ORDEN (misma regla 99/100): central ->
              // por_devolver_a_tienda; satelite -> por_devolver.
              const idsByDestino = new Map<string, string[]>();
              for (const o of rechazadas) {
                const { destinoTipo } = resolverDestinoCierre(o.zonaId, centralZonaId);
                const destinoEstatusId =
                  destinoTipo === "bodega_central" ? porDevolverATiendaId : porDevolverId;
                const arr = idsByDestino.get(destinoEstatusId);
                if (arr) arr.push(o.id);
                else idsByDestino.set(destinoEstatusId, [o.id]);
              }
              for (const [destinoEstatusId, ids] of idsByDestino) {
                // R7/R8/R22: updateMany GUARDADO por `estatus_id = rechazada`. NO toca
                // mensajero/asignado_at ni prioridad (money-neutral; diferencia deliberada con la
                // liberacion `sin_gestionar`, que SI limpia mensajero + prioridad por ir a RE-reparto).
                const movidas = await tx.orden.updateMany({
                  where: { id: { in: ids }, estatusId: rechazadaId, deletedAt: null },
                  data: { estatusId: destinoEstatusId },
                });
                // R11/R22: choke point SOLO de las que transicionaron; actor = admin, origen dedicado.
                if (movidas.count > 0) {
                  await appendCambioEstado(
                    tx,
                    ids.map((ordenId) => ({
                      ordenId,
                      estatusOrigenId: rechazadaId,
                      estatusDestinoId: destinoEstatusId,
                      actorUsuarioId: resueltoPor, // R11: el admin que aprobo
                      origenTipo: "devolucion_rechazada", // R11
                    })),
                  );
                }
              }
            }
          }
        }

        // ------------------------------------------------------------------------------------
        // Feature 238 (T3.3, design §4, R17-R23) — LA MARCA DE CONFIRMACION FISICA.
        //
        // BODEGA DECLARO TENER ESTOS PAQUETES DELANTE. La cobertura EXACTA —que lo confirmado sea
        // igual al conjunto que vuelve, ni falta ni sobra— ya la verifico el SERVICIO antes de
        // abrir esta transaccion (R14); aqui solo se persiste el hecho, en la MISMA tx que aprueba
        // (R17), de modo que no pueda existir un cierre aprobado sin sus marcas ni marcas de un
        // cierre que no se aprobo.
        //
        // VA AQUI, entre la devolucion de las `rechazada` (139) y el ANCLAJE (239), y no es
        // estetico: se lee en el orden operativo —se confirma que el paquete esta, y a
        // continuacion la devolucion se ancla y se vuelve visible para la tienda—. Ademas es
        // MONEY-NEUTRAL (`data` con una sola clave) y los cinco feeds de dinero estan TODOS por
        // delante, asi que no mueve ninguna asercion de orden de
        // `cierres-admin-caja-cod.test.ts`. Un rojo alli significa que este bloque aterrizo mal:
        // es regresion, no asercion a actualizar.
        //
        // UNA consulta, no N. A diferencia del bucle de indemnizaciones —que escribe un valor
        // distinto por fila— aqui el valor es el MISMO para todas, asi que un solo `updateMany`
        // hace el trabajo. El techo real medido es de 14 gestiones por cierre.
        if (confirmacionFisica.length > 0) {
          const ids = confirmacionFisica.map((c) => c.gestionId);
          const aplicado = await tx.gestionOrden.updateMany({
            where: {
              id: { in: ids },
              // `cierreId` y `resultado` son GUARDIA del WHERE, no filtro cosmetico: sin el
              // primero, aprobar un cierre podria marcar gestiones de OTRO; sin el segundo,
              // podria marcar un `incidente` —cuyo paquete no vuelve y por tanto nadie tuvo
              // delante—. Las dos tienen su caso testigo.
              cierreId,
              resultado: { in: [...RESULTADOS_QUE_VUELVEN] },
            },
            // R19 — MONEY-NEUTRAL: el `data` lleva EXACTAMENTE esta clave y ninguna mas. Ningun
            // feed lee esta columna (nace sin lectores) y ninguno lee `orden.estatus_id`, asi que
            // no hay ruta por la que esto toque un importe.
            data: { confirmadaFisicaAt: new Date() },
          });
          // R18 — FALLO CERRADO. Si alguna no caso la guardia, se lanza y la `$transaction`
          // revierte TODO. Es el equivalente del `count !== 1` del bucle de indemnizaciones.
          if (aplicado.count !== ids.length) {
            throw new ConfirmacionFisicaNoAplicableError(cierreId);
          }
        }
        // R22 — IDEMPOTENCIA POR CONSTRUCCION, sin una linea de codigo de idempotencia: este
        // bloque vive dentro del `res.count === 1 && aprobado`, y el `updateMany` del cierre esta
        // guardado por `estado IN ESTADOS_RESOLUBLES = ["solicitado"]`. Un cierre ya aprobado
        // devuelve `count = 0` y la rama entera no se ejecuta. NO se anade `confirmadaFisicaAt:
        // null` al WHERE: haria que un reintento legitimo tras un rollback lanzara por
        // `count !== ids.length`.
        // ------------------------------------------------------------------------------------

        // ------------------------------------------------------------------------------------
        // Feature 239 (T2.2, design §3, R4-R10) — EL ANCLAJE DE LA DEVOLUCION.
        //
        // LA APROBACION DEL CIERRE **ES** LA TRANSICION `devolucion_por_confirmar -> devuelta`.
        // No enciende una marca ni deja una fecha: mueve el estado. Con ese movimiento la
        // devolucion (a) se vuelve visible para la tienda en `/novedades` y (b) arranca su
        // ventana de SLA. Las dos mitades pasan a mirar el MISMO hecho, que es lo que el fallo
        // de `progress/auditoria_ayuda_tienda.md` §1 no tenia: alli la visibilidad dependia de
        // una columna y el reloj de la fecha de la gestion, y por eso se cobraban rechazos de
        // ordenes que la tienda no habia podido ver nunca.
        //
        // VA AL FINAL de la rama `aprobado`, DESPUES de `devolucionRechazadas`, y eso no es
        // estetico: `cierres-admin-caja-cod.test.ts` MIDE EL ORDEN de las llamadas dentro de la
        // transaccion, porque los feeds de dinero se leen unos a otros (la caja lee lo que el
        // ledger acaba de escribir). Este bloque es money-neutral —su `data` lleva SOLO
        // `estatusId`— y ningun feed lee `orden.estatus_id`, asi que colocarlo aqui no mueve
        // ninguna asercion de orden. Insertarlo entre medias tampoco romperia el dinero, pero
        // moveria esas aserciones sin ninguna ganancia.
        //
        // `cierre_dia.resuelto_at` NO se usa, NUNCA: se escribe IGUAL al rechazar (unas lineas
        // mas arriba, fuera de esta rama) y `forzarSolicitudVencido` reabre un cierre sin
        // limpiarla. Cualquier derivacion que la use lleva `estado = 'aprobado'` pegado o
        // miente. El anclaje no lee fechas del cierre: ES una transicion con su propia fila de
        // historial, y esa fila es la que el cron lee.
        if (anclajeDevolucion) {
          const { preEstadoId, devueltaId } = anclajeDevolucion;

          // (1) Las gestiones `devuelta` VIGENTES de ESTE cierre. `cierreId` es la GUARDIA (sin
          // el, aprobar un cierre anclaria devoluciones de otro) y `anuladaAt: null` descarta
          // las deshechas. Sin ninguna, el bloque es un no-op y no cuesta ni una consulta mas.
          const gestionesDelCierre = await tx.gestionOrden.findMany({
            where: { cierreId, resultado: "devuelta", anuladaAt: null },
            select: { id: true, ordenId: true },
          });

          if (gestionesDelCierre.length > 0) {
            const ordenIds = [...new Set(gestionesDelCierre.map((g) => g.ordenId))];

            // (2) LA CARRERA QUE CUESTA DINERO (design §4, carrera 1). Secuencia real: el
            // mensajero devuelve (gestion g1, cierre C1 sin aprobar) -> un admin recupera la
            // orden a bodega -> se reasigna -> otro mensajero la vuelve a devolver (gestion g2,
            // cierre C2) -> la orden esta en el pre-estado POR g2. Si ahora se aprueba C1 y se
            // anclara sin mirar, la devolucion NUEVA quedaria anclada con una aprobacion
            // ANTERIOR al hecho: el reloj arrancaria antes, el escalado ocurriria antes y se
            // cobraria el rechazo ANTES DE TIEMPO.
            //
            // Por eso se comprueba, DENTRO de la transaccion, que la gestion de este cierre sea
            // la gestion `devuelta` vigente MAS RECIENTE de su orden (R4c/R5). Una sola
            // consulta ordenada y el recorte en memoria: un `findFirst` por orden seria un N+1
            // dentro de la transaccion mas caliente y mas cara del sistema.
            const vigentes = await tx.gestionOrden.findMany({
              where: { ordenId: { in: ordenIds }, resultado: "devuelta", anuladaAt: null },
              orderBy: [{ ordenId: "asc" }, { createdAt: "desc" }],
              select: { id: true, ordenId: true },
            });
            const masRecientePorOrden = new Map<string, string>();
            for (const g of vigentes) {
              // La primera fila de cada `ordenId` es la mas reciente (orden del `orderBy`).
              if (!masRecientePorOrden.has(g.ordenId)) masRecientePorOrden.set(g.ordenId, g.id);
            }

            // (3) Solo las ordenes cuya gestion vigente MAS RECIENTE es la de ESTE cierre. El
            // resto no se ancla y no deja rastro de anclaje (R5).
            const anclables = gestionesDelCierre.filter(
              (g) => masRecientePorOrden.get(g.ordenId) === g.id,
            );

            if (anclables.length > 0) {
              const idsAnclables = anclables.map((g) => g.ordenId);
              // (4) UPDATE GUARDADO por el pre-estado (R4a) — y esa guarda ES la idempotencia
              // (R8): una segunda aprobacion encuentra las ordenes ya en `devuelta`, devuelve
              // `count = 0` y no appendea nada. No hay codigo de idempotencia porque no hace
              // falta; la hay por construccion, igual que en los otros dos bloques.
              //
              // MONEY-NEUTRAL (R10): el `data` lleva EXACTAMENTE `estatusId` y nada mas. No
              // toca montos, ni mensajero, ni `prioridad` — a diferencia de la liberacion 109,
              // que si limpia mensajero porque su orden va a re-reparto. Aqui la devolucion se
              // queda donde esta; lo unico que cambia es que ya esta confirmada.
              const movidas = await tx.orden.updateMany({
                where: { id: { in: idsAnclables }, estatusId: preEstadoId, deletedAt: null },
                data: { estatusId: devueltaId },
              });

              // (5) Historial por el MISMO punto unico de escritura que el resto de
              // transiciones (R7), y SOLO si algo se movio. `gestionOrdenId` enlaza la gestion
              // que ancla: no es decorativo, es lo que permite auditar QUE devolucion se
              // confirmo con QUE aprobacion sin volver a derivarlo.
              if (movidas.count > 0) {
                await appendCambioEstado(
                  tx,
                  anclables.map((g) => ({
                    ordenId: g.ordenId,
                    estatusOrigenId: preEstadoId,
                    estatusDestinoId: devueltaId,
                    actorUsuarioId: resueltoPor, // R7: el admin que aprobo
                    origenTipo: "anclaje_devolucion", // R7: familia propia (P8)
                    gestionOrdenId: g.id, // la gestion ancla
                  })),
                );
              }
            }
          }
        }
      }
      return res.count;
    });

    if (count === 1) return "updated";

    // count 0: distinguir "ya resuelto" (existe en alcance) de "fuera de alcance".
    const enAlcance = await this.prisma.cierreDia.count({
      where: { id: cierreId, ...alcanceGuard },
    });
    return enAlcance > 0 ? "conflict" : "fuera_de_alcance"; // R12 vs R13
  }

  /**
   * Feature 111/R16 — VALVULA DE ESCAPE. `updateMany` guardado por estado (`vencido`) + alcance;
   * SOLO cambia `estado` (money-safe, R16/R21: no toca snapshot ni `resuelto_por`/`resuelto_at`).
   * `count === 0` -> `conflict` (existe en alcance pero ya no es `vencido`) o `fuera_de_alcance`.
   * NO alimenta wallets ni corre en $transaction: no es una resolucion (no mueve dinero), solo
   * reencamina el `vencido` al flujo normal de aprobacion.
   *
   * ⚠️ FEATURE 241 (2026-08-20): decia «el desbloqueo ocurre al APROBAR (R18)» y hoy es al reves —
   * esta valvula DESBLOQUEA EN EL ACTO, porque deja el cierre en `solicitado` y ese estado ya no
   * bloquea la gestion. Va en la direccion de por que existe (111/R16: «evitar el bloqueo
   * permanente del mensajero y su bodega»): el mensajero vuelve a trabajar y el dinero sigue
   * esperando aprobacion, que es de quien depende.
   */
  async forzarSolicitudVencido(cierreId: string, alcance: Alcance): Promise<ResolverCierreResult> {
    const alcanceGuard = alcanceWhere(alcance);

    // R16 + feature 109/R28: guardia por estado ABIERTO ('vencido'|'rechazado') + alcance en el
    // WHERE (anti-TOCTOU). SOLO `estado` (money-safe).
    const res = await this.prisma.cierreDia.updateMany({
      where: { id: cierreId, estado: { in: ESTADOS_REABRIBLES }, ...alcanceGuard },
      data: { estado: ESTADO_SOLICITADO },
    });
    if (res.count === 1) return "updated";

    // count 0: distinguir "existe en alcance pero ya no es vencido" (conflict) de "fuera de
    // alcance / inexistente" (fuera_de_alcance) — mismo patron que `resolverCierre`.
    const enAlcance = await this.prisma.cierreDia.count({
      where: { id: cierreId, ...alcanceGuard },
    });
    return enAlcance > 0 ? "conflict" : "fuera_de_alcance";
  }
}
