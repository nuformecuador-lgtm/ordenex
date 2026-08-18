import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  Alcance,
  CierreAdminResumenRow,
  GestionIncidenteDelCierre,
  ICierresAdminRepository,
  ResolverCierreInput,
  ResolverCierreResult,
} from "@/lib/interfaces/repositories/ICierresAdminRepository";
import type { CierreGestionPendienteRow } from "@/lib/interfaces/repositories/ICierreDiaRepository";
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
import type { FiltrosDescargaGestiones } from "@/lib/types/filtros-cierres";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import { ESTADOS_COLA_CIERRE_DIA } from "@/lib/utils/colas-cierre";
import { inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";
import { CierreDetalleFaltanteError, tarifaDe } from "@/lib/utils/cierre-detalle";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { esRechazoSla, ORIGEN_TIPO_RECHAZO_SLA } from "@/lib/utils/rechazo-sla-flag";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import { resolverDestinoCierre } from "@/lib/utils/bodega-responsable";
import { toLineasPago } from "@/lib/utils/lineas-pago";

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
type CierresAdminPrismaClient = Pick<
  PrismaClient,
  "cierreDia" | "gestionOrden" | "cierreDetail" | "$transaction"
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
  tarifaComisionCod: true,
  tarifaIvaFlete: true,
  tarifaIvaComisionCod: true,
} as const;

// Feature 69/T18 — lo que aporta la GESTION (que NO se congela: es suyo, no de la orden).
// Feature 102/T2 (R1/R3): + la relacion `historialEstados` ACOTADA al origen SLA (feature 99),
// para DERIVAR `esRechazoSla` por gestion sin columna/migracion nueva. `where` + `take: 1` la
// dejan barata (a lo sumo una fila por gestion); el util `esRechazoSla` es el predicado.
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
  historialEstados: {
    where: { origenTipo: ORIGEN_TIPO_RECHAZO_SLA }, // feature 102/R1: solo la fila del cron SLA
    take: 1,
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
    // (`historialEstados` ya viene acotado a ese origen por `GESTION_ADMIN_SELECT`).
    esRechazoSla: esRechazoSla(g.historialEstados),
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

// WHERE del alcance: siempre por destino_tipo; por destino_zona_id SOLO si el alcance
// lo acota (adminSatelite). El maestro (destinoZonaId null) ve todos los central.
function alcanceWhere(alcance: Alcance): { destinoTipo: Alcance["destinoTipo"]; destinoZonaId?: string } {
  return {
    destinoTipo: alcance.destinoTipo,
    ...(alcance.destinoZonaId !== null ? { destinoZonaId: alcance.destinoZonaId } : {}),
  };
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
function historicoWhere(alcance: Alcance): Prisma.CierreDiaWhereInput {
  return {
    ...alcanceWhere(alcance), // R2/R13: el alcance, en el WHERE y nunca en memoria
    estado: { notIn: [...ESTADOS_COLA_CIERRE_DIA] },
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
function colaWhere(alcance: Alcance): Prisma.CierreDiaWhereInput {
  return {
    ...alcanceWhere(alcance),
    estado: { in: [...ESTADOS_COLA_CIERRE_DIA] },
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
 * Feature 230 (T2.1/T7.1, R31/R33/R37) — los RECORTES que el dialogo elige, traducidos al WHERE
 * del CIERRE al que cuelga la gestion.
 *
 * Se declara UNA vez para los dos caminos (design §10, riesgo 4) y devuelve un fragmento que el
 * llamador COMPONE con su propio criterio de seleccion —el alcance por rol en el camino de
 * cierres del dia, `cierreBodegaId != null` en el de bodega—. La composicion es una CONJUNCION
 * de claves del mismo objeto: por construccion, esto solo puede QUITAR filas del conjunto que
 * aquel ya acoto, jamas anadirlas (R15/R37).
 *
 * Las fechas son dias CALENDARIO en horario de Costa Rica, resueltos a instantes UTC con
 * `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` (convencion del repo): `hasta` es
 * INCLUSIVO como dia, y por eso su borde es `lt` del dia SIGUIENTE y no `lte` del suyo — con
 * `lte` se perderian los cierres solicitados despues de la medianoche del ultimo dia.
 */
export function recortesDescargaGestionesWhere(
  filtros: FiltrosDescargaGestiones,
): Prisma.CierreDiaWhereInput {
  const { mensajeroIds, desde, hasta } = filtros;
  return {
    mensajeroId: { in: [...mensajeroIds] },
    ...(desde !== undefined || hasta !== undefined
      ? {
          solicitadoAt: {
            ...(desde !== undefined ? { gte: inicioDelDiaCREnUtc(desde) } : {}),
            ...(hasta !== undefined ? { lt: inicioDelDiaSiguienteCREnUtc(hasta) } : {}),
          },
        }
      : {}),
  };
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
  async findHistoricoCompleto(alcance: Alcance): Promise<CierreAdminResumenRow[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: historicoWhere(alcance),
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
  async findColaCompleta(alcance: Alcance): Promise<CierreAdminResumenRow[]> {
    const rows = await this.prisma.cierreDia.findMany({
      where: colaWhere(alcance),
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
  ): Promise<PaginaRepositorio<CierreAdminResumenRow>> {
    // Feature 184/R16: el criterio sale de `historicoWhere`, la MISMA declaracion que usa el
    // conjunto completo del que sale el archivo. Estaba escrito aqui y habria que haberlo
    // escrito otra vez alli.
    const where = historicoWhere(alcance);
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
  ): Promise<PaginaRepositorio<CierreAdminResumenRow>> {
    // Feature 184/R16: mismo criterio compartido que el conjunto completo de esta cola.
    const where = colaWhere(alcance);
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
   * R6/R7/R9/R13: cierre (solo si casa el alcance) + sus gestiones. Feature 69/T18 (R15/R19):
   * el detalle se compone del SNAPSHOT + la gestion, en el MISMO DTO.
   */
  async findCierreByIdEnAlcance(
    cierreId: string,
    alcance: Alcance,
  ): Promise<{ cierre: CierreAdminResumenRow; gestiones: CierreGestionPendienteRow[] } | null> {
    const cierre = await this.prisma.cierreDia.findFirst({
      where: { id: cierreId, ...alcanceWhere(alcance) }, // R13: guardia de alcance en el WHERE
      select: CIERRE_RESUMEN_SELECT,
    });
    if (cierre === null) return null; // R13: no existe o de otra bodega/zona (no se distingue)

    // Feature 69/T18 (R15): el detalle de un cierre YA CREADO sale del SNAPSHOT, no de la
    // orden VIVA. Antes esto reusaba `WITH_DETALLE`, que navegaba `gestion_orden.orden.*`: el
    // admin veia los valores de HOY, no los del cierre que esta revisando.
    // R19 sale de aqui gratis: una orden con `deleted_at` sigue mostrandose, y ahora por
    // diseño y no por el accidente de que `WITH_DETALLE` no filtraba `deletedAt`.
    const [gestiones, detalle] = await Promise.all([
      this.prisma.gestionOrden.findMany({
        where: { cierreId }, // R6: gestiones vinculadas a ESTE cierre
        orderBy: { createdAt: "desc" },
        select: GESTION_ADMIN_SELECT,
      }),
      this.prisma.cierreDetail.findMany({
        where: { cierreId },
        select: DETALLE_ADMIN_SELECT,
      }),
    ]);
    const byOrden = new Map(detalle.map((d) => [d.ordenId, d]));
    return {
      cierre: toResumenRow(cierre),
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
        cierre: { ...alcanceWhere(alcance), ...recortesDescargaGestionesWhere(filtros) },
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
            select: { mensajeroId: true },
          });
          if (cierre !== null) {
            const {
              sinGestionarEstatusId,
              enBodegaEstatusId,
              enBodegaSateliteEstatusId,
              centralZonaId,
            } = liberacionSinGestionar;
            // R16/R19: ordenes `sin_gestionar` del mensajero (guarda por estatus + propiedad).
            const ordenes = await tx.orden.findMany({
              where: {
                mensajeroAsignadoId: cierre.mensajeroId,
                estatusId: sinGestionarEstatusId,
                deletedAt: null,
              },
              select: { id: true, zonaId: true },
            });
            if (ordenes.length > 0) {
              // R16: destino por ZONA de la ORDEN (resolverDestinoCierre, misma regla 99/100).
              const idsByDestino = new Map<string, string[]>();
              for (const o of ordenes) {
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
   * reencamina el `vencido` al flujo normal de aprobacion. El desbloqueo ocurre al APROBAR (R18).
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
