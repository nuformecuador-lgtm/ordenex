import { Prisma, type PrismaClient } from "@prisma/client";
import type { CierreEstado } from "@/lib/types/cierre";
import type { OrdenDTO, OrdenListItemDTO, OrdenListItemRelaciones } from "@/lib/types/orden";
import type { TarifaDTO } from "@/lib/types/tarifa";
import type { ResumenCargaOrdenDTO } from "@/lib/types/carga-masiva-resumen";
import type {
  CambioEstadoEntrada,
  HistorialContexto,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import type { IJobRepository, JobTxClient } from "@/lib/interfaces/repositories/IJobRepository";
import { JobRepository } from "@/lib/repositories/JobRepository";
import { encolarGeocodificacion } from "@/lib/services/jobs/geocodificacion-encolado";
import {
  DeshacerAsignacionConflictoError,
  type DeshacerAsignacionItem,
  type CantonRow,
  type CreateOrdenData,
  type CreateOrdenConGuiaResultRow,
  type CreateOrdenOpciones,
  type DistritoRow,
  type EtiquetaRow,
  type GenerarGuiaDecisionData,
  type GenerarGuiaResultRow,
  type BodegaBloqueoResult,
  type IOrdenRepository,
  type ListOrdenesParams,
  type ListOrdenesResult,
  type CausaDevueltaVigente,
  type ManifiestoOrdenRow,
  type MensajeroLiteRow,
  type NovedadOrdenRow,
  type OrdenTransicionRow,
  type OrderStatusLiteRow,
  type ProvinciaRow,
  type RecepcionSateliteFiltro,
  type RecepcionSateliteRow,
  type RechazoSlaTiendaRow,
  type UpdateOrdenData,
  type ApiOrdenListResult,
  type ApiOrdenDetalleRow,
  type ApiOrdenRow,
  type CancelarViaApiResult,
  type LoteContexto,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import { ensureCargaEnTx } from "@/lib/repositories/carga-lote";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import { costosListadoOrden } from "@/lib/utils/ingreso-ordenex";
import { ORIGEN_TIPO_RECHAZO_SLA } from "@/lib/utils/rechazo-sla-flag";
// Feature 236 (T2.1, R3/R5): la DECLARACION UNICA de los grupos de `/novedades`. El predicado de
// cada superficie sale de aqui y de ningun otro sitio; ver `novedadWhere`.
import { ESTATUS_POR_GRUPO, type GrupoNovedad } from "@/lib/types/novedad-grupo";
import { ESTADOS_BODEGA_SATELITE } from "@/lib/utils/estados-bodega-satelite";
import { fechaRepartoComoTexto } from "@/lib/utils/dia-reparto";
// Feature 246 (T3.5, R8): la convencion `@db.Date` para las vias que reasignan SIN eleccion de
// dia. `inicioDelDiaCREnUtc` (06:00Z) es la de las columnas `timestamp` y aqui desplazaria el dia.
import { startOfDayCR } from "@/lib/utils/fecha-cr";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";
import type { OrdenAsignabilidadRow } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type {
  ParadaRutaRow,
  TransicionAyudaInput,
} from "@/lib/interfaces/repositories/IOrdenRepository";
// Feature 260 (B3): el recorte de alcance del tablero del dia, como TIPO. La union de dos
// variantes viaja hasta el `WHERE` sin pasar por un `string | undefined` que convertiria
// «no se» en «sin recorte».
import type { FiltroAlcanceTablero } from "@/lib/types/alcance-tablero";

/**
 * Feature 141 (R28/R35) — ¿queda alguna fila del batch por insertar? Se compara contra el
 * snapshot `before` (leido DENTRO de la tx): si TODAS las `num_remision` del batch ya existen,
 * el `createMany` con `skipDuplicates` no insertaria nada y asegurar el lote dejaria una fila
 * de `carga` sin ninguna orden que la referencie.
 */
function hayFilasPorInsertar(
  chunk: { numRemision: string }[],
  before: { numRemision: string }[],
): boolean {
  const existentes = new Set(before.map((r) => r.numRemision));
  return chunk.some((d) => !existentes.has(d.numRemision));
}

/**
 * Feature 92: unico estatus cuyas ordenes son paradas de la ruta de un mensajero.
 *
 * FEATURE 235 (R14): que siga siendo UNO —y no un `in` con `ayuda_tienda`— es lo que saca del
 * optimizador de ruta y del mapa a la orden sobre la que se pidio ayuda, sin escribir un filtro
 * nuevo en ningun sitio. Ese es el argumento entero de la ficha: con la bandera habia que
 * acordarse; con el estatus, la orden deja de casar sola.
 */
const ESTATUS_EN_REPARTO = "en_reparto";

// ⚰️ FEATURE 236 (T2.1) — AQUI VIVIA `ESTATUS_AYUDA = "ayuda_tienda"`, la segunda rama del `OR` de
// `novedadWhere`. No se ha perdido: se MUDO a `ESTATUS_POR_GRUPO.ayuda` (`lib/types/novedad-grupo.ts`),
// que es el mismo valor en el sitio donde tambien lo lee la pantalla. Tenerlo aqui como `const`
// privado significaba que la interfaz no podia leerlo y tenia que reescribirlo — dos literales, dos
// verdades. Ver la cabecera de `novedadWhere`.

// Feature 106 (design §4, R19/R20): unicos estados desde los que la tienda puede cancelar
// una orden via API; cualquier otro (incl. una orden ya en `devolviendo_a_tienda`) es 409.
const ESTADOS_CANCELABLES_API: readonly string[] = ["en_bodega_central", "en_ruta_bodega_central"];

// Feature 106 — `select` de los campos PUBLICOS de una orden para el canal integrador, y su
// mapeo a `ApiOrdenRow` (Decimal -> number, estatus.value plano). Un solo lugar para que el
// listado y el detalle no diverjan en las columnas que exponen.
const API_ORDEN_SELECT = {
  numGuia: true,
  numRemision: true,
  destinatario: true,
  telefonoDest: true,
  producto: true,
  direccion: true,
  montoCobrar: true,
  createdAt: true,
  estatus: { select: { value: true } },
} as const;

// Feature 106 + 177 — `select` del DETALLE (campos publicos + evidencias de entrega/rechazo con
// `evidencia_storage_path` no nulo). Se extrae a una constante para que la variante por
// `num_guia` (106) y la variante por `id` (177) NO puedan divergir en su proyeccion (R16/R17):
// `findDetalleByNumGuiaForOwner` sigue devolviendo exactamente lo mismo que antes.
//
// FEATURE 268 (T6c, 2026-08-22) — LAS EVIDENCIAS DEL `incidente`, POR SUS **DOS** PROCEDENCIAS.
// Hasta aqui un incidente no aparecia por NINGUN endpoint del canal, y son 6 las aristas de
// entrada a `incidente` que se quedaban sin fotos. Hay dos caminos y hacen falta los dos:
//
//   1. MENSAJERO (arista #44, familia `gestion`) -> fila en `gestion_orden` con
//      `resultado = incidente` y la portada denormalizada en `evidencia_storage_path` (119/R12).
//      Basta con anadir `incidente` al `in` de abajo.
//   2. ADMIN (aristas #48-#52, familia `incidente`) -> **no crea gestion ninguna**: crea
//      `orden_incidente` (relacion `incidentesAdmin`) con sus evidencias 1..N en
//      `orden_incidente_evidencia`. Por eso se suma esa segunda relacion a ESTE MISMO select.
//
// Cubrir solo (1) fallaria EN SILENCIO en 5 de las 6 aristas —justo las del paquete danado en
// bodega—; es la opcion (a) que `design.md` §7.3 descarta por su nombre.
//
// REGLA DE CONTENIDO (design §7.3, pregunta abierta 4): se expone **LA PORTADA (indice 0)** de
// cada registro, no las 1..N, igual que hoy se expone UNA foto por gestion. Es deliberado: la
// deuda 1..N de la 119 no se reabre dentro de esta ficha.
//
// DOS DECISIONES que el spec dejaba abiertas y que se cierran AQUI (2026-08-22, feature 268):
//
//   a. NO se filtra `orden_incidente.estado` (`solicitado`/`aprobado`/`rechazado`). Ese estado es
//      el del tramite de INDEMNIZACION, no el de si el incidente OCURRIO: la orden esta en estado
//      `incidente` sea cual sea, y el integrador pregunta por las fotos del incidente, no por el
//      desenlace economico. Filtrar por `aprobado` esconderia las fotos justo MIENTRAS el tramite
//      se decide, que es cuando se miran.
//   b. El `where` de `gestiones` CONSERVA su forma actual, incluido que hoy NO filtra `anuladaAt`.
//      Anadir `incidente` sigue exactamente la misma regla que ya rige a `entregada`/`rechazada`;
//      "arreglar" lo de `anuladaAt` aqui seria un cambio de comportamiento fuera de alcance que
//      ademas moveria lo que ven las evidencias de entrega/rechazo, que hoy ya funcionan.
//
// Alcance de lectura: `OrdenIncidente` NO tiene owner propio —cuelga de `orden` por FK—, asi que
// el scope sigue siendo el mismo `where` de la orden (`tienda_id = ownerId AND deleted_at IS
// NULL`) de los dos `findDetalleBy*ForOwner`. No hay regla de alcance nueva que escribir, y por
// eso la valvula declarada en design §7.3 no se dispara.
const API_ORDEN_DETALLE_SELECT = {
  ...API_ORDEN_SELECT,
  gestiones: {
    where: {
      // R15 + 268/R27: entrega/rechazo y ademas el incidente del MENSAJERO.
      resultado: { in: ["entregada", "rechazada", "incidente"] },
      evidenciaStoragePath: { not: null }, // R15: con evidencia adjunta
    },
    select: {
      resultado: true,
      evidenciaStoragePath: true,
      evidenciaContentType: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  // 268/R27: el incidente del ADMIN. Solo la PORTADA de cada registro (`indice: 0`, a lo sumo una
  // fila por `@@unique([incidenteId, indice])`), y ni un campo mas: ni `causa`, ni `motivo`, ni
  // `indemnizacion`, ni quien lo reporto. El detalle publico no crece con datos internos.
  incidentesAdmin: {
    select: {
      evidencias: {
        where: { indice: 0 },
        select: { storagePath: true, contentType: true },
      },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.OrdenSelect;

type ApiOrdenSelectRow = {
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  producto: string;
  direccion: string | null;
  montoCobrar: Prisma.Decimal | null;
  createdAt: Date;
  estatus: { value: string };
};

type ApiOrdenDetalleSelectRow = ApiOrdenSelectRow & {
  gestiones: {
    resultado: string;
    evidenciaStoragePath: string | null;
    evidenciaContentType: string | null;
    createdAt: Date;
  }[];
  // 268/R27: el camino del ADMIN. `evidencias` viene acotado a la portada por el `where` del
  // select, asi que es `[]` o un unico elemento.
  incidentesAdmin: {
    evidencias: { storagePath: string; contentType: string }[];
  }[];
};

function toApiOrdenRow(r: ApiOrdenSelectRow): ApiOrdenRow {
  return {
    numGuia: r.numGuia,
    numRemision: r.numRemision,
    estatusValue: r.estatus.value,
    destinatario: r.destinatario,
    telefonoDest: r.telefonoDest,
    producto: r.producto,
    direccion: r.direccion,
    montoCobrar: r.montoCobrar !== null ? r.montoCobrar.toNumber() : null,
    createdAt: r.createdAt,
  };
}

/**
 * Feature 106/R15/R18 + 177/R16: fila -> DTO de detalle. Compartido por ambas variantes.
 *
 * FEATURE 268/R27 (2026-08-22): las DOS procedencias del incidente caen en el MISMO array
 * `evidencias[]`, con la misma forma que las de entrega/rechazo. El consumidor no distingue —ni
 * debe— si la foto la subio el mensajero o el admin: para el es "la evidencia del incidente".
 * Primero las gestiones (por `createdAt`), luego los incidentes del admin (por `createdAt`).
 */
function toApiOrdenDetalleRow(row: ApiOrdenDetalleSelectRow): ApiOrdenDetalleRow {
  const deGestiones = row.gestiones.map((g) => ({
    // `resultado` esta acotado por el WHERE a estos tres valores.
    resultado: g.resultado as "entregada" | "rechazada" | "incidente",
    // El WHERE exige `evidencia_storage_path` no nulo; el `!` es seguro.
    storagePath: g.evidenciaStoragePath!,
    contentType: g.evidenciaContentType,
  }));

  // 268/R27: un incidente del admin SIN evidencias se OMITE. Emitir una entrada con
  // `storagePath` vacio o `undefined` mandaria al service a firmar un path que no existe y el
  // integrador recibiria un item con `url: undefined`: peor que la ausencia, porque parece un
  // fallo del canal. Sin foto no hay evidencia que exponer.
  const deIncidentesAdmin = row.incidentesAdmin.flatMap((i) => {
    const portada = i.evidencias[0]; // `where: { indice: 0 }` -> 0 o 1 elementos
    if (!portada) return [];
    return [
      {
        resultado: "incidente" as const,
        storagePath: portada.storagePath,
        contentType: portada.contentType,
      },
    ];
  });

  return {
    ...toApiOrdenRow(row),
    evidencias: [...deGestiones, ...deIncidentesAdmin],
  };
}

type OrdenPrismaClient = Pick<
  PrismaClient,
  | "orden"
  | "orderStatus"
  | "zona"
  | "provincia"
  | "canton"
  | "distrito"
  | "usuario"
  | "cierreDia" // feature 41: bloqueo derivado del mensajero / bodega (R12/R17)
  | "cierreBodega" // feature 41: causa (ii) del bloqueo de bodega (R17)
  | "gestionOrden" // feature 87: causa de devolucion vigente de la lista de novedades (R6/R8)
  | "ordenHistorialEstado" // feature 236: fecha de la solicitud de ayuda, que ordena su pestaña (D7/R17)
  | "carga" // feature 141: lote de carga masiva asegurado en la tx de la insercion batch
  | "$transaction" // feature 17: generarGuiaLote necesita transaccion (R25)
  | "$executeRaw" // feature 41/R23: anti-TOCTOU (NOT EXISTS cierre bloqueante en el lote)
  | "$queryRaw" // feature 91: lo exige `JobRepository` (encolado outbox de geocodificacion)
>;

// Feature 41 (R12/R16/R17) + feature 109 (R29, modelo GLOBAL): un cierre esta ABIERTO mientras no
// sea `aprobado`, que es el unico TERMINAL (dinero conciliado). `rechazado` dejo de ser terminal
// por LOGICA (109): sigue abierto y es RE-SOLICITABLE (`rechazado -> solicitado`), igual que
// `vencido`. Fuente de verdad en lib/types/cierre.ts.
//
// ⚠️ FEATURE 241 (2026-08-20) — «ABIERTO» YA NO ES «BLOQUEANTE». Esta lista quedo siendo lo que
// siempre dijo su nombre: un dato INFORMATIVO (cuantos cierres arrastra una bodega). NO decide
// ningun bloqueo; para eso esta `ESTADOS_CIERRE_BLOQUEAN_GESTION`, que es un subconjunto.
const ESTADOS_CIERRE_ABIERTO: CierreEstado[] = ["solicitado", "vencido", "rechazado"];

/**
 * FEATURE 241 — LA REGLA, firmada por el humano el 2026-08-20. Lo unico que bloquea a un
 * mensajero, y solo para GESTIONAR Y COBRAR.
 *
 * Son TRES cosas distintas y solo dos se tocan aqui:
 *
 *  1. SOLICITAR CIERRE — nunca dos pendientes. Vive en `CierreDiaService.solicitarCierre` (R12) y
 *     NO pasa por este predicado. Sin relacion con esta lista.
 *  2. RECIBIR ASIGNACIONES — NUNCA se bloquea, sea cual sea el estado del cierre (pedido humano
 *     2026-08-18). Por eso ninguna superficie de asignacion consulta este predicado: no es que
 *     devuelva vacio, es que no se llama. Ver `GuiaAsignacionService`, `AsignacionSateliteService`
 *     y `lib/actions/ordenes-guia.ts`.
 *  3. GESTIONAR Y COBRAR (entregar, recoger, escoger, `deshacerGestion`, recoleccion en tienda) —
 *     SE BLOQUEA, y solo con estos dos estados.
 *
 * POR QUE `solicitado` NO ESTA, que es la mitad que se «arregla» sola por simetria: `solicitado`
 * es ESPERA DEL ADMIN. El mensajero ya hizo lo suyo —pidio el cierre— y la pelota esta en el otro
 * tejado. Medido contra produccion el 2026-08-18, el retraso gestion->aprobacion tiene MEDIANA
 * 8,2 h y P90 22,1 h: bloquearlo ahi lo castiga por una demora ajena y le impide trabajar hasta
 * media manana siguiente. `vencido` y `rechazado`, en cambio, son la pelota en SU tejado: hay algo
 * que solo el puede hacer (solicitar el vencido, re-solicitar el rechazado) y hasta que no lo haga
 * el dinero que cobre no tiene cierre al que ir.
 *
 * ASI QUE LA ASIMETRIA ES DELIBERADA: recibir si, gestionar no, y `solicitado` nunca. Quien lea
 * esto y sienta la tentacion de «completar» la lista con `solicitado` esta deshaciendo la decision
 * firmada, no arreglando un olvido.
 */
const ESTADOS_CIERRE_BLOQUEAN_GESTION: CierreEstado[] = ["vencido", "rechazado"];
const ESTADO_CIERRE_BODEGA_PENDIENTE: CierreEstado = "solicitado";

// Feature 17/R3: nombre CONSTANTE del generador (nunca interpolar entrada de
// usuario en el SQL crudo).
//
// Ya NO es `nextval('orden_num_guia_seq')` directo: la guia se imprime en la
// etiqueta y viaja en el QR, y un contador visible filtra volumen de operacion
// (restar dos guias da las ordenes emitidas en el medio). `siguiente_num_guia()`
// —migracion 20260720160000— aplica una permutacion multiplicativa BIYECTIVA
// sobre esa misma secuencia: sigue sin colisionar, pero no es ascendente.
// La formula vive en la funcion, no aqui, para que los tres call sites de abajo
// (y cualquiera nuevo) no puedan divergir.
const NUM_GUIA_GENERATOR = "siguiente_num_guia()";

// Feature 33/R11/R18: estado de ORIGEN de la recepcion en satelite. La escritura
// guardada (`recibirEnSatelite`) solo transiciona una orden que sigue en este
// estado (guardia por estado de origen en el propio UPDATE, patron feature 17/36).
const ORIGEN_RECEPCION_SATELITE = "en_ruta_bodega_satelite";
// Estado de ORIGEN de la recepcion en la tienda: la orden viaja de vuelta a la
// tienda ("En ruta a origen") y esta la recibe fisicamente.
const ORIGEN_RECEPCION_ORIGEN = "devolviendo_a_tienda";
// Feature 138 + 139: la recepcion en la BODEGA CENTRAL es STATE-AWARE: el estado de ORIGEN
// (`en_ruta_bodega_central` para el caso 138, `devolviendo_a_bodega_central` para el 139) lo
// resuelve el SERVICE y lo pasa como `origenValue` a `recibirEnBodegaCentral`, que guarda el UPDATE
// por ese estado. La guarda NO se acota por zona ni por tienda (R11): la bodega central es global.

// Mapa columna de negocio -> columna Prisma para el orden (lista blanca R31).
const SORT_COLUMN: Record<string, "createdAt" | "numGuia" | "numRemision"> = {
  created_at: "createdAt",
  num_guia: "numGuia",
  num_remision: "numRemision",
};

// Fila de orden con el `value` del estatus incluido (para OrdenDTO.estatusValue).
type OrdenRow = Prisma.OrdenGetPayload<{
  include: { estatus: { select: { value: true } } };
}>;

const WITH_ESTATUS = {
  include: { estatus: { select: { value: true } } },
} as const;

// El LISTADO trae, en el MISMO query (via joins de Prisma `include`), los datos
// de TODAS las relaciones DIRECTAS (FK) de la orden: estatus, tienda, zona,
// provincia, canton, distrito y mensajeroAsignado. La relacion
// `tienda` (Orden.tienda -> Usuario) trae ademas su tarifa ACTIVA (Usuario.
// tarifasTienda, 1:N por-tienda; se acota a `status: 'activo'`, no borrada,
// `take: 1`). NO requiere migracion: son includes sobre relaciones ya existentes.
// Seleccion explicita de campos: NUNCA se traen columnas sensibles del usuario
// (passwordHash, etc.) ni `deletedAt` de las tarifas.
const TARIFA_SELECT = {
  id: true,
  tiendaId: true,
  status: true,
  valorFlete: true,
  valorFleteDevuelto: true,
  valorFleteGam: true,
  valorFleteDevueltoGam: true,
  fulfillment: true,
  comisionCod: true,
  ivaFlete: true,
  ivaComisionCod: true,
  createdAt: true,
  updatedAt: true,
} as const;

// `gestion_orden.resultado` de una reprogramacion (espejo de
// `LiberacionReprogramadaRepository`, el cron que consume la misma fecha).
const RESULTADO_REPROGRAMADA = "reprogramada";

// Origen UNICO de las dos decisiones de despacho del maestro —asignar mensajero y rutear a
// una bodega satelite—, y por tanto el estado del filtro REASIGNABLES.
const ESTATUS_EN_BODEGA_CENTRAL = "en_bodega_central";

// Feature 87 (T2/R6): `gestion_orden.resultado` de una DEVOLUCION. Mismo valor del enum
// `GestionResultado` que ya usa el historial; la vigencia se filtra por `anuladaAt: null`
// (mismo criterio que `contarPorDestinoVigentes`, feature 67).
const RESULTADO_DEVUELTA = "devuelta";

// ⚰️ FEATURE 236 (T2.1) — y aqui, `ESTATUS_DEVUELTA = "devuelta"`, la primera rama de aquel `OR`.
// Mismo destino y mismo motivo que su hermana de arriba: hoy es `ESTATUS_POR_GRUPO.devolucion`.

// Feature 102 (T7): `order_status.value` de una orden rechazada. La superficie de rechazos por
// SLA de la tienda se ancla a este estado real (mientras la orden REPOSE en `rechazada`, R15).
const ESTATUS_RECHAZADA = "rechazada";

// Feature 236 (T2.5, D7): familia de origen de LA IDA de la ayuda (`en_reparto -> ayuda_tienda`,
// feature 235/P2). Es de donde sale la fecha con la que se ordena la pestaña de ayuda: la que lleva
// mas esperando, primero. La VUELTA (`rescate_ayuda_tienda`) no se lee aqui — describe el final de
// una espera, no su comienzo.
const ORIGEN_TIPO_SOLICITUD_AYUDA = "solicitud_ayuda_tienda";

/**
 * Serializa una fecha `@db.Date` (guardada a medianoche UTC) a `YYYY-MM-DD`.
 * `null`/`undefined` -> `null`. Convencion del repo (ver CierreDiaRepository).
 */
function toFechaISO(fecha: Date | null | undefined): string | null {
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

// Feature 102: money-safe Decimal -> STRING escala 2 fija (nunca number/parseFloat). `null` ->
// `null` (monto aun sin snapshot). Patron `decimalToString` de los repos de cierre.
function decimalOrNullToString(d: Prisma.Decimal | null): string | null {
  return d === null ? null : d.toFixed(2);
}

const WITH_ESTATUS_Y_TIENDA = {
  include: {
    estatus: { select: { id: true, value: true } },
    tienda: {
      select: {
        id: true,
        nombre: true,
        email: true,
        telefono: true,
        // Tarifa ACTIVA de la tienda (a lo sumo una, `take: 1`), excluyendo
        // borradas e inactivas.
        tarifasTienda: {
          where: { status: "activo", deletedAt: null },
          select: TARIFA_SELECT,
          take: 1,
        },
      },
    },
    zona: { select: { id: true, nombre: true, esCentral: true } },
    provincia: { select: { id: true, nombre: true } },
    canton: { select: { id: true, nombre: true } },
    distrito: { select: { id: true, nombre: true } },
    mensajeroAsignado: { select: { id: true, nombre: true } },
    // Gestion de reprogramacion VIGENTE (a lo sumo una, `take: 1`): alimenta la
    // columna "Liberada el" de la tab `reprogramada`. `orden -> gestiones` es 1:N
    // (una orden acumula gestiones entre reintentos), asi que la vigente es la mas
    // reciente NO anulada. Mismo shape que `LiberacionReprogramadaRepository`
    // (el cron que libera), para que la fecha mostrada sea EXACTAMENTE la que
    // decide la liberacion y no puedan divergir.
    gestiones: {
      where: { resultado: RESULTADO_REPROGRAMADA, anuladaAt: null },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { fechaReprogramacion: true },
    },
  },
} as const;

// Fila de orden del listado con todas las relaciones directas resueltas.
type OrdenListRow = Prisma.OrdenGetPayload<typeof WITH_ESTATUS_Y_TIENDA>;

// Serializa la fila de Prisma a OrdenDTO: peso Decimal -> number (o null,
// feature 15/R4), nunca expone deletedAt (R42/N3).
function toDTO(row: OrdenRow): OrdenDTO {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusId: row.estatusId,
    estatusValue: row.estatus?.value,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    tiendaId: row.tiendaId,
    zonaId: row.zonaId,
    provinciaId: row.provinciaId,
    cantonId: row.cantonId,
    distritoId: row.distritoId,
    producto: row.producto,
    peso: row.peso ? row.peso.toNumber() : null,
    notas: row.notas,
    mensajeroAsignadoId: row.mensajeroAsignadoId, // feature 49/R27: autoriza al mensajero asignado
    prioridad: row.prioridad, // feature 101/R9: expone el flag de reasignacion prioritaria (sort R6 + resalte R8)
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Serializa una tarifa anidada de la tienda: Decimal -> number en las 8 columnas
// numericas (patron TarifaRepository). No expone `deletedAt` (ya filtrado en el
// include).
function toTarifaDTO(t: OrdenListRow["tienda"]["tarifasTienda"][number]): TarifaDTO {
  return {
    id: t.id,
    tiendaId: t.tiendaId,
    status: t.status,
    valorFlete: t.valorFlete.toNumber(),
    valorFleteDevuelto: t.valorFleteDevuelto.toNumber(),
    valorFleteGam: t.valorFleteGam.toNumber(),
    valorFleteDevueltoGam: t.valorFleteDevueltoGam.toNumber(),
    fulfillment: t.fulfillment.toNumber(),
    comisionCod: t.comisionCod.toNumber(),
    ivaFlete: t.ivaFlete.toNumber(),
    ivaComisionCod: t.ivaComisionCod.toNumber(),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/**
 * Feature 204 — la MISMA tarifa, en la forma que consume la aritmetica de dinero: los 7
 * campos como STRING escala 2 (`TarifaVigente`), no como `number`.
 *
 * Convive con `toTarifaDTO` a proposito y no lo sustituye: aquel serializa la tarifa para
 * MOSTRARLA (`TarifaDTO`, Decimal -> number, contrato de la feature 18) y este la prepara
 * para OPERAR con ella en `Prisma.Decimal`. Son dos usos distintos del mismo dato y el
 * segundo no admite `number`: ahi es donde se pierde el centimo.
 */
function toTarifaVigente(t: OrdenListRow["tienda"]["tarifasTienda"][number]): TarifaVigente {
  return {
    valorFlete: t.valorFlete.toFixed(2),
    valorFleteGam: t.valorFleteGam.toFixed(2),
    valorFleteDevuelto: t.valorFleteDevuelto.toFixed(2),
    valorFleteDevueltoGam: t.valorFleteDevueltoGam.toFixed(2),
    comisionCod: t.comisionCod.toFixed(2),
    ivaFlete: t.ivaFlete.toFixed(2),
    ivaComisionCod: t.ivaComisionCod.toFixed(2),
  };
}

// Arma el bloque `relaciones` con los datos de las relaciones directas (FK) de la
// orden, resueltas por el include del listado. `tienda` incluye su tarifa activa.
function toRelaciones(row: OrdenListRow): OrdenListItemRelaciones {
  return {
    estatus: row.estatus ? { id: row.estatus.id, value: row.estatus.value } : null,
    tienda: row.tienda
      ? {
          id: row.tienda.id,
          nombre: row.tienda.nombre,
          email: row.tienda.email,
          telefono: row.tienda.telefono,
          // A lo sumo una tarifa activa por tienda (o null).
          tarifa: row.tienda.tarifasTienda[0] ? toTarifaDTO(row.tienda.tarifasTienda[0]) : null,
        }
      : null,
    zona: row.zona
      ? { id: row.zona.id, nombre: row.zona.nombre, esCentral: row.zona.esCentral }
      : null,
    provincia: row.provincia ? { id: row.provincia.id, nombre: row.provincia.nombre } : null,
    canton: row.canton ? { id: row.canton.id, nombre: row.canton.nombre } : null,
    distrito: row.distrito ? { id: row.distrito.id, nombre: row.distrito.nombre } : null,
    mensajeroAsignado: row.mensajeroAsignado
      ? { id: row.mensajeroAsignado.id, nombre: row.mensajeroAsignado.nombre }
      : null,
  };
}

// R25/R26: serializa una fila del listado a OrdenListItemDTO, agregando el nombre
// legible de la tienda. Solo el listado usa este mapeo; el resto del CRUD usa toDTO.
// Feature 17/R20: agrega mensajeroAsignadoId (ya viene en el row via
// WITH_ESTATUS_Y_TIENDA: `include` no restringe los escalares del modelo).
// Ademas expone en `relaciones` los datos de TODAS las relaciones directas (FK),
// con la tarifa activa anidada dentro de `tienda` (resueltas via joins en el listado).
function toListItemDTO(row: OrdenListRow): OrdenListItemDTO {
  // Feature 204: las dos columnas de dinero DERIVADO ("Flete + IVA" y "Comisión + IVA") se
  // resuelven AQUI, con Decimal, y viajan como STRING ya derivado. Antes las calculaba el
  // navegador multiplicando los `number` de la tarifa, y no daba lo mismo: sobre las órdenes
  // reales de la base, 14 de 66 se veían un céntimo desviadas de lo que factura el cierre.
  const tarifaActiva = row.tienda.tarifasTienda[0];
  const costos = costosListadoOrden(tarifaActiva ? toTarifaVigente(tarifaActiva) : null, {
    esCentral: row.zona.esCentral,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toFixed(2) : null,
    cobraComision: row.cobraComision,
  });
  return {
    ...toDTO(row),
    tiendaNombre: row.tienda.nombre,
    mensajeroAsignadoId: row.mensajeroAsignadoId,
    // Feature 30/R14/R19: nombre de zona (columna del listado) + flag GAM (la UI
    // decide por fila si muestra select de mensajero o "-> bodega satelite").
    zonaNombre: row.zona.nombre,
    zonaEsGam: row.zona.esCentral,
    // Escalares para las columnas de detalle/dinero del listado (dirección, valor
    // de cobro COD, flag de comisión). Decimal montoCobrar -> number|null.
    direccion: row.direccion,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    cobraComision: row.cobraComision,
    // Feature 204: los dos importes DERIVADOS, ya calculados arriba en Decimal. El cliente
    // los pinta; no vuelve a operar con ellos.
    fleteConIva: costos.fleteConIva,
    comisionConIva: costos.comisionConIva,
    // Fecha de la gestion de reprogramacion vigente -> `YYYY-MM-DD` (patron
    // CierreDiaRepository). `fecha_reprogramacion` es `@db.Date` guardada a
    // medianoche UTC, asi que `toISOString().slice(0, 10)` da el dia calendario
    // correcto (aqui NO aplica el off-by-one de `fecha-cr`, que solo afecta a
    // derivar "hoy" desde un instante real). Sin gestion vigente -> null.
    fechaReprogramacion: toFechaISO(row.gestiones[0]?.fechaReprogramacion),
    relaciones: toRelaciones(row),
  };
}

// Feature 16 — resumen del lote recien cargado: los datos de la orden + el
// `estatus.value` y el nombre de su zona. Feature 159: la proyeccion perdio los
// dos campos de mensajero sugerido; el resumen es SOLO LECTURA (design §5.1).
const WITH_RESUMEN = {
  select: {
    id: true,
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    producto: true,
    montoCobrar: true,
    direccion: true,
    zonaId: true,
    estatus: { select: { value: true } },
    zona: { select: { nombre: true } },
  },
} as const;

type OrdenResumenRow = Prisma.OrdenGetPayload<typeof WITH_RESUMEN>;

// R6/R9: mapea Decimal montoCobrar -> number|null; NO expone deletedAt/internos.
function toResumenDTO(row: OrdenResumenRow): ResumenCargaOrdenDTO {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    producto: row.producto,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    direccion: row.direccion,
    estatusValue: row.estatus?.value,
    zonaId: row.zonaId,
    zonaNombre: row.zona.nombre,
  };
}

// Feature 32/R1 — proyeccion para la etiqueta: los datos de la orden + los
// NOMBRES (no IDs) de tienda/geografia via relaciones ya existentes (patron
// WITH_ESTATUS_Y_TIENDA). `distrito` es la unica relacion opcional (R4). No
// selecciona `deletedAt` ni internos (R6); el filtro `deletedAt: null` va en el
// `where` del findMany (R3).
const WITH_ETIQUETA = {
  select: {
    id: true,
    tiendaId: true, // Feature 136: dueño, para el filtro por propietario del service
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    direccion: true,
    producto: true,
    montoCobrar: true,
    tienda: { select: { nombre: true } },
    zona: { select: { nombre: true } },
    provincia: { select: { nombre: true } },
    canton: { select: { nombre: true } },
    distrito: { select: { nombre: true } },
  },
} as const;

type OrdenEtiquetaRow = Prisma.OrdenGetPayload<typeof WITH_ETIQUETA>;

// R1/R4/R5/R6: serializa la fila de etiqueta a EtiquetaRow. Resuelve los nombres
// legibles, mapea Decimal montoCobrar -> number|null (R5, sin moneda) y deja
// distritoNombre null si la orden no tiene distrito (R4). NO expone deletedAt (R6).
function toEtiquetaRow(row: OrdenEtiquetaRow): EtiquetaRow {
  return {
    id: row.id,
    tiendaId: row.tiendaId,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    tiendaNombre: row.tienda.nombre,
    zonaNombre: row.zona.nombre,
    provinciaNombre: row.provincia.nombre,
    cantonNombre: row.canton.nombre,
    distritoNombre: row.distrito?.nombre ?? null,
  };
}

// Feature 148/R4/R6/R7/R11 — proyeccion del MANIFIESTO (patron WITH_ETIQUETA). Solo
// las columnas que consumen las 11 celdas de R2 + `tiendaId` (dueño, para el filtro
// por API key de R29). Suma dos datos que la etiqueta no tiene: el NOMBRE del
// mensajero ASIGNADO (columna `responsable`, R9) y `zona.esCentral` (decide
// GAM/no-GAM en `origen`/`destino`, design.md §4). Suma tambien `producto`, que paso a
// ser columna del manifiesto por la regla 160/R28. NO selecciona
// provincia/canton/distrito, notas ni `deletedAt` (R11); el filtro `deletedAt: null`
// va en el `where` (R12).
const WITH_MANIFIESTO = {
  select: {
    id: true,
    tiendaId: true, // R29: dueño, para el filtro por propietario del service
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    direccion: true,
    producto: true,
    montoCobrar: true,
    tienda: { select: { nombre: true } },
    zona: { select: { nombre: true, esCentral: true } },
    mensajeroAsignado: { select: { nombre: true } },
  },
} as const;

type OrdenManifiestoRow = Prisma.OrdenGetPayload<typeof WITH_MANIFIESTO>;

// R4/R6/R7/R11: serializa la fila a ManifiestoOrdenRow. Resuelve los nombres
// legibles (zona por NOMBRE, R6), mapea Decimal montoCobrar -> number|null (R7) y
// deja `mensajeroAsignadoNombre` null si la orden no tiene mensajero asignado (el
// service cae entonces al actor, design.md §9.8). NO expone deletedAt (R11).
function toManifiestoOrdenRow(row: OrdenManifiestoRow): ManifiestoOrdenRow {
  return {
    id: row.id,
    tiendaId: row.tiendaId,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    tiendaNombre: row.tienda.nombre,
    zonaNombre: row.zona.nombre,
    zonaEsCentral: row.zona.esCentral,
    mensajeroAsignadoNombre: row.mensajeroAsignado?.nombre ?? null,
  };
}

// Feature 33/R6/R8/R9 — proyeccion del modulo de la bodega satelite: los datos de
// la orden + `estatus.value` (para partir "Por recibir"/"Recibidas") + los NOMBRES
// (no IDs) de tienda/geografia via relaciones ya existentes (patron WITH_ETIQUETA).
// `distrito` es la unica relacion opcional. No selecciona `deletedAt` ni internos;
// el filtro `deletedAt: null` va en el `where` del findMany.
const WITH_RECEPCION_SATELITE = {
  select: {
    id: true,
    numGuia: true,
    numRemision: true,
    destinatario: true,
    telefonoDest: true,
    direccion: true,
    producto: true,
    montoCobrar: true,
    prioridad: true, // feature 101/R9: se pide explicito (es un `select`) para el sort R7 + resalte R8
    estatus: { select: { value: true } },
    tienda: { select: { nombre: true } },
    zona: { select: { nombre: true } },
    provincia: { select: { nombre: true } },
    canton: { select: { nombre: true } },
    distrito: { select: { nombre: true } },
  },
} as const;

type OrdenRecepcionSateliteRow = Prisma.OrdenGetPayload<typeof WITH_RECEPCION_SATELITE>;

/**
 * Feature 170 — FASE 2 (T K.1): lo unico que devuelve la consulta que ORDENA y recorta. El
 * `total` es el mismo numero en las N filas de la pagina (`COUNT(*) OVER ()`), no una columna
 * por fila: se lee de la primera.
 */
interface PaginaSateliteIdRow {
  id: string;
  total: number;
}

/**
 * Feature 184 — Tanda A (T A.1, R16) — el CRITERIO del listado de la bodega satelite, declarado
 * UNA sola vez.
 *
 * Lo consumen las TRES consultas del dominio —la pagina, el conjunto completo de la descarga y
 * la comprobacion de vigencia de la seleccion— y por eso vive fuera de las tres. Escribirlo dos
 * veces es lo que R16 prohibe, y no por estilo: si el `WHERE` de la pagina y el del conjunto se
 * despegaran, la pantalla y el archivo mostrarian filas distintas para el mismo filtro y no
 * fallaria nada.
 *
 * Cada condicion va HERMANA de las demas (AND), igual que el filtro de cliente que sustituyo.
 * Las tres primeras son el ACOTAMIENTO y no dependen de ningun filtro: se emiten SIEMPRE.
 */
function condicionesSatelite(filtro: RecepcionSateliteFiltro): Prisma.Sql[] {
  const condiciones: Prisma.Sql[] = [
    Prisma.sql`o."zona_id" = ${filtro.zonaId}`,
    Prisma.sql`o."deleted_at" IS NULL`,
    Prisma.sql`os."value" IN (${Prisma.join([...filtro.estatusValues])})`,
  ];
  // Pedido humano (2026-08-19): la geografia se compara por ID —las columnas de `orden`, sin
  // pasar por los JOIN de nombre— porque las opciones ya vienen de la geografia de la ZONA del
  // actor, que es lo que ofrece el catalogo de `/ordenes`. Antes eran nombres derivados de las
  // ordenes cargadas, y «Central» existe en cuatro provincias.
  const provinciaIds = [...(filtro.provinciaIds ?? [])];
  if (provinciaIds.length > 0) {
    condiciones.push(Prisma.sql`o."provincia_id" IN (${Prisma.join(provinciaIds)})`);
  }
  const cantonIds = [...(filtro.cantonIds ?? [])];
  if (cantonIds.length > 0) {
    condiciones.push(Prisma.sql`o."canton_id" IN (${Prisma.join(cantonIds)})`);
  }
  const distritoIds = [...(filtro.distritoIds ?? [])];
  if (distritoIds.length > 0) {
    // `distrito_id` es NULLABLE y `NULL IN (...)` no es cierto: una orden SIN distrito queda
    // fuera bajo un filtro de distrito. Mismo trato que en `/ordenes`.
    condiciones.push(Prisma.sql`o."distrito_id" IN (${Prisma.join(distritoIds)})`);
  }
  // Pedido humano (2026-08-19) — rango de creacion: bordes ya resueltos a instantes UTC por el
  // servicio. `>= desde` y `< hasta` (superior ABIERTO), la misma semantica que el `gte`/`lt`
  // del listado de `/ordenes`.
  if (filtro.creadaDesde) {
    condiciones.push(Prisma.sql`o."created_at" >= ${filtro.creadaDesde}`);
  }
  if (filtro.creadaHasta) {
    condiciones.push(Prisma.sql`o."created_at" < ${filtro.creadaHasta}`);
  }
  // BUSCADOR: `LIKE` parcial sobre la columna GENERADA (guia, remision, telefono en sus dos
  // formas, destinatario y producto), acelerada por el indice GIN de trigramas. El termino
  // llega YA normalizado por el servicio; aqui solo se escapan los comodines de `LIKE`.
  //
  // Sin `ILIKE` a proposito, igual que en `/ordenes`: la columna ya esta en minusculas y sin
  // acentos, y el termino tambien. El `OR` de las dos formas del telefono compara LA MISMA
  // columna y va entre parentesis, asi que sigue siendo una condicion hermana de la zona: el
  // acotamiento por zona queda FUERA del `OR` y sigue mandando.
  if (filtro.busqueda) {
    condiciones.push(condicionBusquedaSatelite(filtro.busqueda, filtro.busquedaDigitos));
  }
  return condiciones;
}

/**
 * Feature 169 (design §4.3, R7) — escapa lo que `LIKE` interpreta como comodin.
 *
 * Sin esto, buscar `"100%"` devolveria todo lo que empieza por `100` y `"_"` casaria con
 * cualquier caracter. No es solo precision: `"%"` devolveria el listado entero. Se escapa con
 * `\` porque es el caracter de escape POR DEFECTO de `LIKE` en Postgres; el `\` va primero en
 * la clase para que el propio backslash se duplique en la misma pasada.
 *
 * Vive en el MODULO —y no dentro de la clase— porque lo necesitan las dos vias: el `contains`
 * de Prisma (`/ordenes`) y el SQL crudo de la bodega satelite. Una declaracion, no dos.
 */
function escaparComodinesLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (caracter) => `\\${caracter}`);
}

/**
 * El termino sobre la columna generada, en UNA o en DOS formas. Espejo exacto de
 * `OrdenRepository.criterioBusqueda`, que hace lo mismo en el dialecto de Prisma: el patron
 * `%termino%` se construye aqui porque el SQL crudo no lo pone por su cuenta.
 */
function condicionBusquedaSatelite(termino: string, digitos?: string): Prisma.Sql {
  const casa = (t: string): Prisma.Sql =>
    Prisma.sql`o."busqueda_texto" LIKE ${`%${escaparComodinesLike(t)}%`}`;
  if (!digitos || digitos === termino) return casa(termino);
  return Prisma.sql`(${casa(termino)} OR ${casa(digitos)})`;
}

/**
 * Feature 184 (T A.1) — el `FROM ... WHERE` del listado, con los JOINs que las condiciones
 * necesitan. UN solo fragmento: la pagina, su conteo, el conjunto de la descarga y la vigencia
 * no tienen forma de mirar conjuntos distintos.
 *
 * Pedido humano (2026-08-19): aqui habia ademas tres JOIN de geografia (`provincia`, `canton`,
 * `distrito`), que existian SOLO para comparar nombres. Con la geografia por ID el criterio se
 * resuelve contra las columnas de `orden` y los tres JOIN se retiran: quedarse con ellos seria
 * pagar tres uniones por consulta para no leer ni una columna suya. `order_status` se queda:
 * lo necesitan el filtro de estado y el rango de grupo del `ORDER BY`.
 */
function desdeSatelite(condiciones: Prisma.Sql[]): Prisma.Sql {
  return Prisma.sql`
      FROM "orden" o
      JOIN "order_status" os ON os."id" = o."estatus_id"
      WHERE ${Prisma.join(condiciones, " AND ")}
    `;
}

/**
 * Feature 184 (T A.1, R16/R51) — el ORDEN del listado: rango de GRUPO primero
 * (`ESTADOS_BODEGA_SATELITE`, la secuencia canonica COMPLETA aunque el filtro deje un solo
 * estado), luego prioridad, recencia y el `id` como desempate estable.
 *
 * Lo comparten la pagina y el conjunto de la descarga: si divergieran, la fila N del archivo
 * dejaria de ser la fila N de la pantalla sin que nada fallara.
 */
function ordenBodegaSatelite(): Prisma.Sql {
  return Prisma.sql`
      ORDER BY
        array_position(ARRAY[${Prisma.join([...ESTADOS_BODEGA_SATELITE])}]::text[], os."value") ASC,
        o."prioridad" DESC,
        o."created_at" DESC,
        o."id" ASC
    `;
}

// R6/R8/R9: serializa la fila a RecepcionSateliteRow. Resuelve los nombres
// legibles, mapea Decimal montoCobrar -> number|null y deja distritoNombre null si
// la orden no tiene distrito. NO expone deletedAt.
function toRecepcionSateliteRow(row: OrdenRecepcionSateliteRow): RecepcionSateliteRow {
  return {
    id: row.id,
    numGuia: row.numGuia,
    numRemision: row.numRemision,
    estatusValue: row.estatus.value,
    destinatario: row.destinatario,
    telefonoDest: row.telefonoDest,
    direccion: row.direccion,
    producto: row.producto,
    montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
    tiendaNombre: row.tienda.nombre,
    zonaNombre: row.zona.nombre,
    provinciaNombre: row.provincia.nombre,
    cantonNombre: row.canton.nombre,
    distritoNombre: row.distrito?.nombre ?? null,
    prioridad: row.prioridad, // feature 101/R9: propaga el flag para el sort R7 + resalte R8
  };
}

export class OrdenRepository implements IOrdenRepository {
  /**
   * Feature 91: `jobRepo` se inyecta para el encolado TRANSACTIONAL OUTBOX de la
   * geocodificacion (design §6). Por defecto es el `JobRepository` real; `enqueue` recibe
   * SIEMPRE el `tx` del writer, asi que el cliente propio del repo de jobs no se usa.
   */
  constructor(
    private readonly prisma: OrdenPrismaClient,
    private readonly jobRepo: IJobRepository = new JobRepository(prisma),
  ) {}

  // BORRADO 2026-08-07 (tanda 2 del chore de deuda de superficie): aqui vivia `create`, el
  // insert de UNA orden. Se quedo sin llamador al retirarse `OrdenService.crear`. Las ordenes
  // se crean EN LOTE: `createManyOrdenes` (rama sin guia) y `createManyOrdenesConGuia`, que
  // siguen vivas y son las que usa `BulkOrdenService`. `CreateOrdenData` y
  // `CreateOrdenOpciones` NO mueren: son de ellas tambien.

  async findById(id: string): Promise<OrdenDTO | null> {
    const row = await this.prisma.orden.findFirst({
      where: { id, deletedAt: null }, // R34: excluye borradas
      ...WITH_ESTATUS,
    });
    return row ? toDTO(row) : null;
  }

  /**
   * Feature 63 + 144 — traduce UN valor del `where` (ya resuelto por el service) al
   * criterio Prisma de su columna: LISTA -> `IN (...)` (OR dentro del mismo filtro,
   * R34); ESCALAR -> igualdad; AUSENTE -> clave omitida (sin filtro). Las claves
   * resultantes son hermanas del mismo objeto `where` => AND entre filtros distintos
   * (R33).
   *
   * `listaVaciaSinFiltro` existe SOLO por retrocompatibilidad de `estatusId` (feature
   * 63: una lista vacia equivalia a "sin filtro"). Los filtros de la 144 fallan
   * CERRADO: lista vacia -> `IN ()` -> cero filas. Un filtro presente jamas puede
   * degradar a "sin filtro" y devolver de mas (R35). El schema `.nonempty()` ya hace
   * la lista vacia inalcanzable desde el borde; esto es defensa en profundidad.
   */
  /**
   * Feature 169 (design §4.3, R7) — escapa lo que `LIKE` interpreta como comodin.
   *
   * Prisma interpola el valor de `contains` DENTRO del patron `%valor%` sin escaparlo: sin
   * esto, buscar `"100%"` devolveria todo lo que empieza por `100`, y `"_"` casaria con
   * cualquier caracter. No es solo una molestia de precision — es una fuga de alcance del
   * filtro: `"%"` devolveria el listado entero.
   *
   * Se escapa con `\` porque es el caracter de escape POR DEFECTO de `LIKE` en Postgres, y
   * Prisma no emite clausula `ESCAPE`. El `\` va primero en la clase para que el propio
   * backslash se duplique en la misma pasada.
   */
  private static escaparLike(valor: string): string {
    return escaparComodinesLike(valor);
  }

  /**
   * Feature 169 (M1 del review) — el termino sobre la columna generada, en UNA o en DOS
   * formas.
   *
   * Con una sola forma (el caso normal: cualquier termino sin separadores) emite la clave
   * escalar de siempre, y el plan de ejecucion es el ya medido en T4.1. Con dos —un termino
   * de digitos con separadores, que hay que buscar tal cual Y reducido— emite un `OR` de dos
   * `contains` SOBRE LA MISMA COLUMNA.
   *
   * Ese `OR` no abre ninguna fuga y la diferencia importa: las dos ramas comparan LA MISMA
   * columna generada y nada mas, y el `OR` entero es una clave HERMANA del resto del
   * `where`, asi que Postgres recibe `... AND (<columna> LIKE a OR <columna> LIKE b)`. El
   * acotamiento por rol sigue fuera y sigue mandando. Lo prohibido —y sigue prohibido— es
   * meter el termino en un `OR` con OTRA cosa: ahi el rol dejaria de acotar (design §7).
   *
   * Coste: un segundo recorrido del mismo indice trigram, y solo para terminos con
   * separadores. Medido en `scripts/bench-busqueda-ordenes.ts` (E6/E7): el plan sigue siendo
   * por indice — un `BitmapOr` de dos `Bitmap Index Scan` sobre ese mismo indice.
   */
  private static criterioBusqueda(
    termino: string | undefined,
    digitos: string | undefined,
  ): Prisma.OrdenWhereInput {
    if (!termino) return {};
    const casa = (t: string): Prisma.OrdenWhereInput => ({
      busquedaTexto: { contains: OrdenRepository.escaparLike(t) },
    });
    if (!digitos || digitos === termino) return casa(termino);
    return { OR: [casa(termino), casa(digitos)] };
  }

  private static criterio(
    columna: string,
    valor: string | string[] | undefined,
    listaVaciaSinFiltro = false,
  ): Record<string, unknown> {
    if (valor === undefined) return {};
    if (Array.isArray(valor)) {
      if (valor.length === 0 && listaVaciaSinFiltro) return {};
      return { [columna]: { in: valor } };
    }
    return valor ? { [columna]: valor } : {};
  }

  async list(params: ListOrdenesParams): Promise<ListOrdenesResult> {
    const criterioColumna = OrdenRepository.criterio;
    const where: Prisma.OrdenWhereInput = {
      deletedAt: null, // R34
      ...criterioColumna("tiendaId", params.where.tiendaId),
      // Un id -> igualdad; una lista de ids -> `IN (...)` (filtro multi-estado).
      // `true`: retrocompatibilidad de la feature 63 — una lista vacia de estados
      // equivalia a "sin filtro". Los filtros de la 144 NO heredan esa concesion.
      ...criterioColumna("estatusId", params.where.estatusId, true),
      // Acotamiento por dueño para el rol mensajero: solo sus asignadas (evita fuga
      // del listado completo en /ordenes). El service lo setea; aqui se traduce al WHERE.
      ...(params.where.mensajeroAsignadoId
        ? { mensajeroAsignadoId: params.where.mensajeroAsignadoId }
        : {}),
      // Feature 144 (R33/R34/R35): filtros de catalogo de la orden. Mismo patron:
      // lista -> `IN (...)` (OR interno), escalar -> igualdad, ausente -> sin clave.
      // Claves hermanas del mismo objeto = AND entre filtros distintos.
      ...criterioColumna("zonaId", params.where.zonaId),
      ...criterioColumna("provinciaId", params.where.provinciaId),
      ...criterioColumna("cantonId", params.where.cantonId),
      // `distrito_id` es NULLABLE: `IN (...)` deja fuera las ordenes sin distrito.
      ...criterioColumna("distritoId", params.where.distritoId),
      // Feature 144 (R41/R42): rango temporal ya resuelto a instantes UTC por el service.
      ...(params.where.createdAt ? { createdAt: params.where.createdAt } : {}),
      // Filtro REASIGNABLES: las ordenes que ESPERAN que alguien decida su siguiente paso
      // — darles mensajero, o rutearlas a una bodega satelite—. Ambas decisiones parten del
      // MISMO origen (`en_bodega_central`), asi que el filtro es "esta en la central y no
      // tiene mensajero". Las claves van hermanas => AND entre ellas y con el resto.
      //
      // NO exige `prioridad`. Esa columna solo se enciende al DESHACER una asignacion
      // (feature 101), asi que exigirla dejaba fuera a toda orden que llego a la central y
      // nunca tuvo mensajero — que son la mayoria, y las mas obvias de asignar. La prioridad
      // sigue cumpliendo su funcion real: ordenar primero (`prioridad DESC`, abajo) y
      // resaltar la fila en la UI. Filtrar por ella convertia "reasignables" en "las que
      // alguien ya libero", que es un subconjunto muy estrecho y no lo que el nombre promete.
      //
      // Tampoco hace falta excluir `reprogramada`: acotar al estado de la central ya la deja
      // fuera. `mensajeroAsignadoId: null` no colisiona con el acotamiento del rol mensajero,
      // que fija un id concreto (un mensajero pidiendo reasignables obtiene cero filas, que
      // es lo correcto). Las de `en_bodega_satelite` quedan fuera A PROPOSITO: esas las
      // asigna el adminSatelite desde su propia pantalla, no esta vista.
      ...(params.where.reasignables
        ? {
            mensajeroAsignadoId: null,
            estatus: { value: ESTATUS_EN_BODEGA_CENTRAL },
          }
        : {}),
      // Feature 169 (design §4.3/§5) — BUSCADOR. Dos claves excluyentes que el service ya
      // resolvio; las dos van HERMANAS del resto (AND), nunca dentro de un `OR`.
      //
      // `numGuia`: ruta rapida por el indice unico `orden_num_guia_key`.
      ...(params.where.numGuia !== undefined ? { numGuia: params.where.numGuia } : {}),
      // `busquedaTexto`: coincidencia parcial sobre la columna GENERADA, acelerada por el
      // indice GIN de trigramas. SIN `mode: "insensitive"` a proposito: la columna ya esta
      // en minusculas y sin acentos, y el termino tambien, asi que `LIKE` a secas es lo
      // que el trigram acelera mejor; `ILIKE` obligaria a plegar caja en cada recheck para
      // nada. El termino llega YA normalizado y aqui solo se le escapan los comodines.
      // Si el service mando ademas su forma solo-digitos, se buscan las dos (ver
      // `criterioBusqueda`: `OR` de dos `contains` sobre LA MISMA columna).
      ...OrdenRepository.criterioBusqueda(
        params.where.busqueda,
        params.where.busquedaDigitos,
      ),
    };
    // Feature 101/R6: `prioridad DESC` PRIMERO y LUEGO el orden vigente (lista blanca R31:
    // created_at/num_guia/num_remision). El sort va en la QUERY para respetar la paginacion
    // (una orden prioritaria flota a la primera pagina, no queda atrapada en la 2). Es GLOBAL
    // al listado pero INOCUO fuera de `en_bodega_central`: solo ahi (y en bodega satelite) hay
    // `prioridad = true`; en el resto el desempate booleano cae al criterio vigente sin
    // alterar el orden observable (R10, sin reordenar superficies ajenas).
    const orderBy: Prisma.OrdenOrderByWithRelationInput[] = [
      { prioridad: "desc" },
      { [SORT_COLUMN[params.sortBy]]: params.sortDir },
    ];

    const [items, total] = await Promise.all([
      this.prisma.orden.findMany({
        where,
        orderBy,
        skip: params.skip,
        take: params.take,
        ...WITH_ESTATUS_Y_TIENDA, // R25: incluye estatus.value + tienda.nombre
      }),
      this.prisma.orden.count({ where }),
    ]);

    return { items: items.map(toListItemDTO), total };
  }

  /**
   * FEATURE 260 (B3, R2/R11/R19/R40) — los elementos de listado de una lista ACOTADA de ids.
   *
   * Patron identico a `findEtiquetasByIds` / `findManifiestoByIds` y, sobre todo, a
   * `findRecepcionSateliteByIds`, que ya combina ids + zona + `deletedAt: null`. Lo que este
   * metodo NO hace es tan importante como lo que hace: no filtra por fecha, no ordena, no
   * pagina y **no proyecta a mano**. Recibe una lista de ids —como mucho el tamaño de pagina
   * del detalle— y devuelve el DTO con el MISMO `include` y el MISMO mapeo que `list()`.
   *
   * ⚠️ EL `findMany` DE AQUI QUEDA FUERA DEL CENSO DE `frontera.guardia`, y se dice claro en
   * vez de rodearse: ese guardia prohibe `findMany` sobre el arbol de la feature del tablero, y
   * este archivo no esta en ese arbol (tiene medio centenar de `findMany` legitimos, asi que
   * meterlo no es opcion). Esta verde porque el guardia NO LLEGA, no porque la regla se cumpla
   * sola. Lo que si se cumple es el FONDO de la regla —«no traer el dia a memoria»—: la
   * consulta va por `id IN (<= pageSize)`, y lo cubren dos tests, uno de servicio (que la lista
   * de ids es EXACTAMENTE la de la pagina) y uno de integracion contra Postgres (que el `WHERE`
   * recorta de verdad la borrada y la de otra zona).
   */
  async findListItemsByIds(
    ids: readonly string[],
    filtro: FiltroAlcanceTablero,
  ): Promise<OrdenListItemDTO[]> {
    if (ids.length === 0) return []; // R5: cero ids, cero consultas
    const rows = await this.prisma.orden.findMany({
      where: {
        id: { in: [...ids] },
        deletedAt: null, // R19: una orden borrada no vuelve nunca
        // R11 — el recorte multi-tenant, otra vez. No se fia de que los ids llegaran ya
        // recortados por la consulta anterior: dos puertas a las mismas filas son dos sitios
        // donde hay que aplicar la frontera.
        ...(filtro.tipo === "zona" ? { zonaId: filtro.zonaId } : {}),
      },
      ...WITH_ESTATUS_Y_TIENDA, // R2: el MISMO include que `list()`
    });
    return rows.map(toListItemDTO); // R2: el MISMO mapeo que `list()`
  }

  async update(
    id: string,
    data: UpdateOrdenData,
    historial: HistorialContexto,
  ): Promise<OrdenDTO | null> {
    // Feature 49/#11 (R7/R19): update + append (si cambia estatus) en la MISMA tx.
    return this.prisma.$transaction(async (tx) => {
      // R20: estatus de ORIGEN pre-leido dentro de la tx, SOLO si el update podria cambiarlo.
      let origenEstatusId: string | null = null;
      if (data.estatusId !== undefined) {
        const actual = await tx.orden.findFirst({
          where: { id, deletedAt: null },
          select: { estatusId: true },
        });
        origenEstatusId = actual?.estatusId ?? null;
      }
      // ── Feature 91 (R10/R11, decision Q1): GUARD LATENTE de re-geocodificacion ──────
      //
      // ESTE CODIGO NO ES ALCANZABLE HOY, Y NO ES CODIGO MUERTO A ELIMINAR.
      //
      // Hoy la condicion `data.direccion !== undefined` NUNCA se cumple: la ruta de
      // edicion es estructuralmente incapaz de cambiar una direccion — `actualizarOrdenSchema`
      // (lib/types/orden.ts) es `.strict()` y no incluye `direccion`, y `toUpdateData()`
      // tampoco la proyecta. Ampliar el CRUD para permitir editarla es OTRA feature y
      // esta explicitamente FUERA de alcance de la 91 (design §0/C1).
      //
      // Se implementa igualmente porque el dia que el CRUD gane el campo, sin este guard
      // la orden quedaria con direccion NUEVA y coordenadas VIEJAS, en silencio, sin
      // ninguna senal de inconsistencia — y nadie relacionaria ese bug con esta feature.
      // Cuesta ~6 lineas y deja el sistema correcto por construccion.
      //
      // La pre-lectura es CONDICIONAL (patron del `estatusId` de arriba) para no anadir
      // una query a cada actualizacion de orden.
      let direccionPrevia: string | null = null;
      if (data.direccion !== undefined) {
        const actual = await tx.orden.findFirst({
          where: { id, deletedAt: null },
          select: { direccion: true },
        });
        direccionPrevia = actual?.direccion ?? null;
      }
      // Solo aplica si existe y no esta borrada (R36); updateMany no lanza si 0 filas.
      const result = await tx.orden.updateMany({
        where: { id, deletedAt: null },
        data: this.toUpdateData(data),
      });
      if (result.count === 0) return null;
      // R19/R20: registra SOLO cuando el update EFECTIVAMENTE cambia el `estatus_id`
      // (nuevo != previo). Si el update no toca estatus, o lo deja igual, no deja rastro.
      if (
        data.estatusId !== undefined &&
        origenEstatusId !== null &&
        data.estatusId !== origenEstatusId
      ) {
        await appendCambioEstado(tx, [
          {
            ordenId: id,
            estatusOrigenId: origenEstatusId,
            estatusDestinoId: data.estatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // ajuste_estado
          },
        ]);
      }
      // R10/R11 (guard latente, ver el bloque de arriba): encola SOLO si la actualizacion
      // cambia EFECTIVAMENTE la direccion (viene informada Y difiere de la almacenada).
      // Si no viene el campo, o la deja igual, no se encola nada.
      if (data.direccion !== undefined && data.direccion !== direccionPrevia) {
        await encolarGeocodificacion(this.jobRepo, tx as unknown as JobTxClient, {
          id,
          direccion: data.direccion,
        });
      }
      const row = await tx.orden.findFirst({
        where: { id, deletedAt: null },
        ...WITH_ESTATUS,
      });
      return row ? toDTO(row) : null;
    });
  }

  // BORRADO 2026-08-07 (tanda 2): aqui vivian `softDelete` (el borrado logico de UNA orden,
  // de `OrdenService.borrar`) y `existsEstatus` (la guarda de catalogo de
  // `OrdenService.actualizar`). Ninguna pantalla ofrece borrar una orden. OJO: el
  // `deleted_at IS NULL` sigue vivo y aplicandose en TODAS las lecturas; lo que se va es el
  // unico WRITER que lo fijaba. Para comprobar que un estatus existe, lo vivo es
  // `findEstatusIdByValue`, que es lo que usan los servicios de dominio.

  async findEstatusIdByValue(value: string): Promise<string | null> {
    const found = await this.prisma.orderStatus.findUnique({ where: { value } });
    return found?.id ?? null;
  }

  /** Feature 27/R15/R16/R17: `usuario.fulfillment` de la tienda; `false` si no resuelve. */
  async findUsuarioFulfillment(usuarioId: string): Promise<boolean> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { fulfillment: true },
    });
    return row?.fulfillment ?? false;
  }

  // BORRADO 2026-08-07 (tanda 2): aqui vivia `existsGeo`, la comprobacion fila-a-fila de que
  // zona/provincia/canton/distrito existen antes de un alta MANUAL. Se fue con
  // `OrdenService.crear`. La carga masiva NO la usaba: resuelve la geografia por NOMBRE con
  // `findAllProvincias`/`findCantonesByProvinciaIds`/`findDistritosByCantonIds`, que siguen
  // vivas. Las FK NOT NULL de la tabla siguen siendo la garantia dura.

  private toUpdateData(data: UpdateOrdenData): Prisma.OrdenUncheckedUpdateManyInput {
    const out: Prisma.OrdenUncheckedUpdateManyInput = {};
    if (data.estatusId !== undefined) out.estatusId = data.estatusId;
    if (data.destinatario !== undefined) out.destinatario = data.destinatario;
    if (data.telefonoDest !== undefined) out.telefonoDest = data.telefonoDest;
    if (data.tiendaId !== undefined) out.tiendaId = data.tiendaId;
    if (data.zonaId !== undefined) out.zonaId = data.zonaId;
    if (data.provinciaId !== undefined) out.provinciaId = data.provinciaId;
    if (data.cantonId !== undefined) out.cantonId = data.cantonId;
    if (data.distritoId !== undefined) out.distritoId = data.distritoId;
    if (data.producto !== undefined) out.producto = data.producto;
    if (data.peso !== undefined) {
      out.peso = data.peso !== null ? new Prisma.Decimal(data.peso) : null;
    }
    if (data.notas !== undefined) out.notas = data.notas;
    return out;
  }

  // --- Feature 15: carga masiva (metodos batch) ---

  /** R25: remision -> estatus.value de la orden existente (no borrada). */
  async findExistingRemisiones(nums: string[]): Promise<Map<string, string>> {
    if (nums.length === 0) return new Map();
    const rows = await this.prisma.orden.findMany({
      where: { numRemision: { in: nums }, deletedAt: null },
      select: { numRemision: true, estatus: { select: { value: true } } },
    });
    return new Map(rows.map((r) => [r.numRemision, r.estatus.value]));
  }

  /**
   * R19/R21: TODAS las provincias (catálogo pequeño). NO se filtra por nombre en la
   * query: el service resuelve el match normalizando en AMBOS lados (`normalizeName`
   * -> minúsculas + sin acentos), que es insensible a tildes/mayúsculas. Un
   * `where { nombre: { in, mode: "insensitive" } }` solo cubre mayúsculas, no
   * acentos, y descartaría "Bogotá" cuando el archivo trae "Bogota".
   */
  async findAllProvincias(): Promise<ProvinciaRow[]> {
    return this.prisma.provincia.findMany({
      select: { id: true, nombre: true },
    });
  }

  /** R19: cantones de las provincias resueltas (todo el universo, el service filtra por jerarquia). */
  async findCantonesByProvinciaIds(provinciaIds: string[]): Promise<CantonRow[]> {
    if (provinciaIds.length === 0) return [];
    const rows = await this.prisma.canton.findMany({
      where: { provinciaId: { in: provinciaIds } },
      select: { id: true, nombre: true, provinciaId: true },
    });
    return rows;
  }

  /** R19: distritos de los cantones resueltos. */
  async findDistritosByCantonIds(cantonIds: string[]): Promise<DistritoRow[]> {
    if (cantonIds.length === 0) return [];
    const rows = await this.prisma.distrito.findMany({
      where: { cantonId: { in: cantonIds } },
      // La zona del distrito vive en la N:M `zona_distrito` (feature 24): es ahi donde
      // la UI/ZonaForm asigna distritos a zonas, NO en la columna escalar distrito.zona_id
      // (que quedo sin poblar). La carga masiva deriva orden.zona_id de esta relacion.
      // Feature 98/R2: junto al `zonaId` de la N:M se proyecta `zona.esCentral` (flag que elige
      // la columna del flete al tarifar la carga por API), sin una consulta extra.
      select: {
        id: true,
        nombre: true,
        cantonId: true,
        zonas: { select: { zonaId: true, zona: { select: { esCentral: true } } } },
      },
    });
    // Un distrito con EXACTAMENTE una zona resuelve orden.zona_id; con 0 zonas -> sin zona
    // asignada (error de fila); con >1 -> ambiguo/no derivable -> null (mismo trato seguro:
    // no se inventa una zona). El caso normal de negocio es 1 zona por distrito.
    return rows.map((d) => ({
      id: d.id,
      nombre: d.nombre,
      cantonId: d.cantonId,
      zonaId: d.zonas.length === 1 ? d.zonas[0].zonaId : null,
      // Feature 98/R2: `esCentral` de la unica zona; `false` si el distrito no resuelve UNA
      // zona (0 o >1 -> `zonaId` null -> la fila no llega a tarifarse).
      esCentral: d.zonas.length === 1 ? d.zonas[0].zona.esCentral : false,
    }));
  }

  /** R27: insercion masiva en lotes de `batchSize`, tolerando carreras de num_remision. */
  async createManyOrdenes(
    data: CreateOrdenData[],
    batchSize: number,
    historial: HistorialContexto,
    lote: LoteContexto,
  ): Promise<{ inserted: number; cargaId: string | null }> {
    let inserted = 0;
    // Feature 141: el id del lote se resuelve UNA vez y se reutiliza en los batches
    // siguientes de esta misma llamada (via API key entra `null` y lo genera el helper).
    let cargaId: string | null = lote.cargaId;
    for (let i = 0; i < data.length; i += batchSize) {
      const chunk = data.slice(i, i + batchSize);
      const chunkNums = chunk.map((d) => d.numRemision);
      // Feature 49/#1 (R7): cada chunk hace su createMany + append en la MISMA tx.
      const chunkResult = await this.prisma.$transaction(async (tx) => {
        // R8/R9: para registrar SOLO las EFECTIVAMENTE insertadas (skipDuplicates puede
        // saltar duplicadas), se comparan las filas con esos num_remision antes/despues:
        // las nuevas son las que no existian antes del insert.
        const before = await tx.orden.findMany({
          where: { numRemision: { in: chunkNums } },
          // Feature 141: `numRemision` se anade al select (aditivo sobre una query que YA se
          // ejecutaba) para saber si queda algo por insertar ANTES de asegurar el lote (R24).
          select: { id: true, numRemision: true },
        });
        const beforeIds = new Set(before.map((r) => r.id));
        // Feature 141 (R28/R35): si TODAS las filas del batch ya existen, no hay nada que
        // insertar -> no se toca `carga` (ningun lote huerfano por un chunk 100% duplicado).
        if (!hayFilasPorInsertar(chunk, before)) {
          return { count: 0, cargaId };
        }
        // Feature 141 (R34): el lote se resuelve DENTRO de esta tx, antes del insert (la FK
        // `orden.carga_id` exige que la fila de `carga` exista al insertar las ordenes).
        // Con `cargaId === null` lo CREA con id server-side (R15/R16); con un token previo
        // solo lo LEE y verifica propiedad (R17/R19).
        const loteId = await ensureCargaEnTx(tx, {
          id: cargaId,
          usuarioCargaId: lote.usuarioCargaId,
          totalFiles: lote.totalFiles,
          name: lote.name ?? null, // R21/R23: solo lo usa la creacion
        });
        const result = await tx.orden.createMany({
          // R36: `carga_id` viaja en el INSERT, asi que solo las ordenes EFECTIVAMENTE
          // creadas quedan asociadas al lote; las duplicadas saltadas no se modifican.
          data: chunk.map((d) => this.toCreateManyInput(d, loteId)),
          skipDuplicates: true,
        });
        const after = await tx.orden.findMany({
          where: { numRemision: { in: chunkNums } },
          // Feature 91 (design §0/C3): `direccion` se anade al select para decidir POR
          // FILA si encolar geocodificacion (R8/R9). Es aditivo sobre una query que YA se
          // ejecutaba: no anade round-trip.
          select: { id: true, estatusId: true, direccion: true },
        });
        const nuevas = after.filter((r) => !beforeIds.has(r.id));
        // R9/R20: por cada orden creada, origen null (creacion) -> destino estado inicial.
        await appendCambioEstado(
          tx,
          nuevas.map((r) => ({
            ordenId: r.id,
            estatusOrigenId: null,
            estatusDestinoId: r.estatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // carga_masiva
          })),
        );
        // Feature 91 (R8, decision Q2): UN job por orden EFECTIVAMENTE insertada — las
        // duplicadas saltadas por `skipDuplicates` no estan en `nuevas`, asi que no
        // encolan. Se eligio N jobs individuales y no 1 job por lote porque el coste con
        // el proveedor es IDENTICO (no hay endpoint batch) y el reintento granular evita
        // que una direccion irresoluble haga reintentar 199 geocodificaciones ya pagadas.
        for (const nueva of nuevas) {
          await encolarGeocodificacion(this.jobRepo, tx as unknown as JobTxClient, {
            id: nueva.id,
            direccion: nueva.direccion,
          });
        }
        return { count: result.count, cargaId: loteId };
      });
      inserted += chunkResult.count;
      cargaId = chunkResult.cargaId;
    }
    return { inserted, cargaId };
  }

  /**
   * Feature 88/R8/R9/R10/R11: inserta el lote (patron `createManyOrdenes`: diff
   * before/after + `skipDuplicates` para registrar SOLO las EFECTIVAMENTE nuevas) y, en la
   * MISMA tx del chunk, asigna a cada nueva `num_guia = siguiente_num_guia()` con
   * la guarda idempotente `num_guia IS NULL` (patron `generarGuiaLote`) — misma secuencia
   * atomica que la feature 17/30, asi ninguna guia colisiona. Luego `appendCambioEstado`
   * (origen null -> estado inicial, `origenTipo` = `carga_api`). Las filas duplicadas no
   * aparecen en `nuevas`, no consumen `num_guia` ni dejan historial (R11).
   */
  async createManyOrdenesConGuia(
    data: CreateOrdenData[],
    batchSize: number,
    historial: HistorialContexto,
    lote: LoteContexto,
    opciones: CreateOrdenOpciones = {},
  ): Promise<{ creadas: CreateOrdenConGuiaResultRow[]; cargaId: string | null }> {
    const conGuia = opciones.conGuia ?? true; // default historico: esta ruta numera
    const creadas: CreateOrdenConGuiaResultRow[] = [];
    // Feature 141 (R19): una peticion = UN lote. El id se resuelve en el primer batch que
    // inserta y se reutiliza en los siguientes de esta misma llamada.
    let cargaId: string | null = lote.cargaId;
    for (let i = 0; i < data.length; i += batchSize) {
      const chunk = data.slice(i, i + batchSize);
      const chunkNums = chunk.map((d) => d.numRemision);
      const chunkResult = await this.prisma.$transaction(async (tx) => {
        // Diff before/after: las nuevas son las que no existian antes del insert (respeta
        // duplicados por carrera, igual que createManyOrdenes).
        const before = await tx.orden.findMany({
          where: { numRemision: { in: chunkNums } },
          // Feature 141: `numRemision` para decidir si queda algo por insertar (R24).
          select: { id: true, numRemision: true },
        });
        const beforeIds = new Set(before.map((r) => r.id));
        // Feature 141 (R33/R35): batch 100% duplicado -> no se resuelve ningun lote.
        if (!hayFilasPorInsertar(chunk, before)) {
          return { creadas: [] as CreateOrdenConGuiaResultRow[], cargaId };
        }
        // Feature 141 (R34): lote resuelto DENTRO de la tx, antes del insert (creado con id
        // server-side en el primer batch con ordenes, reutilizado en los siguientes, R30).
        const loteId = await ensureCargaEnTx(tx, {
          id: cargaId,
          usuarioCargaId: lote.usuarioCargaId,
          totalFiles: lote.totalFiles,
          name: lote.name ?? null, // R21: nombre del lote de la via API key
        });
        await tx.orden.createMany({
          data: chunk.map((d) => this.toCreateManyInput(d, loteId)),
          skipDuplicates: true,
        });
        const after = await tx.orden.findMany({
          where: { numRemision: { in: chunkNums } },
          // Feature 155/R11: `direccion` se anade al select para decidir POR FILA si encolar
          // geocodificacion, exactamente como ya hacia `createManyOrdenes`. Es aditivo sobre
          // una query que YA se ejecutaba: no anade round-trip.
          select: {
            id: true,
            numRemision: true,
            estatusId: true,
            direccion: true,
            estatus: { select: { value: true } },
          },
        });
        const nuevas = after.filter((r) => !beforeIds.has(r.id));

        const resultado: CreateOrdenConGuiaResultRow[] = [];
        const entradas: CambioEstadoEntrada[] = [];
        for (const nueva of nuevas) {
          // Feature 155/R21: `conGuia: false` (rama defensiva) NO toca la secuencia y devuelve
          // `numGuia: null`. Ninguna orden consume un numero que no le corresponde.
          let numGuia: number | null = null;
          if (conGuia) {
            // R9: idempotente — solo consume nextval() si num_guia es NULL. Secuencia por la
            // constante del modulo (jamas se interpola entrada de usuario en el SQL).
            await tx.$executeRawUnsafe(
              `UPDATE "orden" SET num_guia = ${NUM_GUIA_GENERATOR} WHERE id = $1 AND num_guia IS NULL`,
              nueva.id,
            );
            const numerada = await tx.orden.findUniqueOrThrow({
              where: { id: nueva.id },
              select: { numGuia: true },
            });
            if (numerada.numGuia === null) {
              // Guarda defensiva (patron generarGuiaLote): el UPDATE previo siempre deja
              // num_guia asignado; se documenta en vez de mentir con `as number`.
              throw new Error(`num_guia no asignado para la orden ${nueva.id}`);
            }
            numGuia = numerada.numGuia;
          }
          resultado.push({
            ordenId: nueva.id,
            numRemision: nueva.numRemision,
            numGuia,
            estatusValue: nueva.estatus.value,
          });
          // R8/R20: origen null (creacion) -> destino estado inicial; origenTipo carga_api (D7).
          entradas.push({
            ordenId: nueva.id,
            estatusOrigenId: null,
            estatusDestinoId: nueva.estatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // carga_api
          });
        }
        await appendCambioEstado(tx, entradas);
        // Feature 155/R11 — HUECO CERRADO. Esta ruta NO encolaba geocodificacion (comparar con
        // `createManyOrdenes`), asi que sus ordenes nacian sin coordenadas y el gate de
        // asignabilidad de la feature 92 las bloqueaba mas tarde sin explicacion. Mismo
        // criterio que la otra ruta de lote: UN job por orden EFECTIVAMENTE insertada (las
        // duplicadas saltadas por `skipDuplicates` no estan en `nuevas`), dentro de la MISMA
        // tx del chunk, y no-op si la direccion no es geocodificable.
        for (const nueva of nuevas) {
          await encolarGeocodificacion(this.jobRepo, tx as unknown as JobTxClient, {
            id: nueva.id,
            direccion: nueva.direccion,
          });
        }
        return { creadas: resultado, cargaId: loteId };
      });
      creadas.push(...chunkResult.creadas);
      cargaId = chunkResult.cargaId;
    }
    return { creadas, cargaId };
  }

  // Feature 141: `cargaId` se inyecta en el INSERT (R36). `downloadUrl` NO se envia aqui:
  // nace NULL y solo la escribe, POST-COMMIT, el modo `individual` de la via API key (R48).
  private toCreateManyInput(
    data: CreateOrdenData,
    cargaId: string,
  ): Prisma.OrdenCreateManyInput {
    return {
      cargaId,
      numRemision: data.numRemision,
      estatusId: data.estatusId,
      destinatario: data.destinatario,
      telefonoDest: data.telefonoDest,
      tiendaId: data.tiendaId,
      zonaId: data.zonaId,
      provinciaId: data.provinciaId,
      cantonId: data.cantonId,
      distritoId: data.distritoId ?? null,
      producto: data.producto,
      peso: data.peso !== null ? new Prisma.Decimal(data.peso) : null,
      notas: data.notas ?? null,
      direccion: data.direccion ?? null,
      montoCobrar: data.montoCobrar != null ? new Prisma.Decimal(data.montoCobrar) : null,
    };
  }

  // --- Feature 141: URLs de descarga de etiquetas (R47/R48) ---

  /**
   * R47: URL del PDF CONSOLIDADO del lote. Escritura POST-COMMIT de la carga: un solo UPDATE
   * de `download_url`, sin tocar ninguna otra columna de `carga`.
   */
  async setCargaDownloadUrl(cargaId: string, url: string): Promise<void> {
    await this.prisma.carga.update({ where: { id: cargaId }, data: { downloadUrl: url } });
  }

  /**
   * R48: URL del PDF individual de cada orden. Un `update` por orden dentro de UNA transaccion
   * (el volumen esta acotado por el tope de etiquetas por peticion). Solo escribe
   * `download_url`: no toca `carga_id`, `num_guia`, `estatus_id` ni el historial.
   */
  async setOrdenesDownloadUrl(items: { ordenId: string; url: string }[]): Promise<void> {
    if (items.length === 0) return; // no-op
    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.orden.update({ where: { id: item.ordenId }, data: { downloadUrl: item.url } });
      }
    });
  }

  // --- Feature 16: resumen del lote recien cargado (solo lectura) ---

  /** R6/R8/R9/R10: filas del resumen, acotadas a tienda del actor y no borradas. */
  async findResumenByNumRemisiones(
    nums: string[],
    tiendaId: string,
  ): Promise<ResumenCargaOrdenDTO[]> {
    if (nums.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { numRemision: { in: nums }, tiendaId, deletedAt: null },
      ...WITH_RESUMEN,
    });
    return rows.map(toResumenDTO);
  }

  // --- Feature 17: "Generar guia" / asignacion de mensajero (R5/R18-R29) ---

  /** R27/R29: INCLUYE borradas (el service distingue "no existe" de "borrada"). */
  async findByIdsForTransicion(ids: string[]): Promise<OrdenTransicionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        numGuia: true,
        deletedAt: true,
        estatus: { select: { value: true } },
        // Feature 30/R8/R9/R11/R12: zona de la orden + flag GAM de esa zona.
        zonaId: true,
        zona: { select: { esCentral: true } },
        // Tienda dueña: acota por tienda sin consulta extra (recepcion en origen).
        tiendaId: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      estatusValue: r.estatus.value,
      numGuia: r.numGuia,
      deletedAt: r.deletedAt,
      zonaId: r.zonaId,
      zonaEsGam: r.zona.esCentral,
      tiendaId: r.tiendaId,
    }));
  }

  /**
   * Feature 92 (design §7, R8): proyeccion minima para el gate de asignabilidad.
   * `latitud`/`longitud` son `Decimal` en Prisma y se serializan a `number` aqui, que es
   * el tipo que consume el gate (misma conversion que `peso`/`montoCobrar`). Solo lectura,
   * sin logica: la clasificacion vive en `AsignabilidadCoordenadasService`.
   */
  async findParaAsignabilidad(ids: string[]): Promise<OrdenAsignabilidadRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        direccion: true,
        latitud: true,
        longitud: true,
        geocodeStatus: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      direccion: r.direccion,
      latitud: r.latitud !== null ? r.latitud.toNumber() : null,
      longitud: r.longitud !== null ? r.longitud.toNumber() : null,
      geocodeStatus: r.geocodeStatus,
    }));
  }

  /**
   * Feature 92 (design §5, R35/R37/R38): paradas candidatas del mensajero. El filtro va
   * ENTERO en el WHERE (mensajero + estatus + no borrada) y se apoya en el indice
   * `orden_mensajero_asignado_id_idx` YA existente; las coordenadas se leen de las filas
   * ya seleccionadas, por eso esta feature NO anade indice sobre `(latitud, longitud)`
   * (design §1.3: seria coste de escritura sin lector).
   *
   * `createdAt asc` NO es cosmetico: es el criterio con el que R38 recorta al tope de
   * paradas, y hacerlo en la DB evita reordenar en memoria.
   */
  async findParadasEnReparto(mensajeroId: string): Promise<ParadaRutaRow[]> {
    const rows = await this.prisma.orden.findMany({
      where: {
        mensajeroAsignadoId: mensajeroId,
        deletedAt: null,
        estatus: { value: ESTATUS_EN_REPARTO },
      },
      select: { id: true, latitud: true, longitud: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      ordenId: r.id,
      latitud: r.latitud !== null ? r.latitud.toNumber() : null,
      longitud: r.longitud !== null ? r.longitud.toNumber() : null,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Feature 33 (QR por guia): fila de transicion por `num_guia` (UNIQUE). INCLUYE
   * borradas (el service distingue "no existe" de "borrada"); `null` si no hay orden
   * con ese `num_guia`.
   */
  async findByNumGuiaForTransicion(numGuia: number): Promise<OrdenTransicionRow | null> {
    const r = await this.prisma.orden.findUnique({
      where: { numGuia },
      select: {
        id: true,
        numGuia: true,
        deletedAt: true,
        estatus: { select: { value: true } },
        zonaId: true,
        zona: { select: { esCentral: true } },
        tiendaId: true,
        // Feature 157 (R30): dueño de la recoleccion, para la guardia de propiedad.
        mensajeroAsignadoId: true,
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      estatusValue: r.estatus.value,
      numGuia: r.numGuia,
      deletedAt: r.deletedAt,
      zonaId: r.zonaId,
      zonaEsGam: r.zona.esCentral,
      tiendaId: r.tiendaId,
      mensajeroAsignadoId: r.mensajeroAsignadoId,
    };
  }

  // --- Feature 106: canal integrador de lectura/cancelacion por API key ---

  /**
   * Feature 106/R6/R7/R11: pagina de ordenes del owner. El scope va FORZADO en el WHERE
   * (`tienda_id = ownerId` no opcional) + `deleted_at IS NULL`; ningun parametro externo
   * puede ampliarlo. `estatusId` opcional acota por estado. `total` con el MISMO where para
   * paginar de forma determinista.
   *
   * Feature 257 (R18/R20/R23/R25): los filtros nuevos llegan como ESCALARES TIPADOS (`Date`,
   * `number`, `string`), jamas como un fragmento de `WhereInput`; si se aceptara un fragmento,
   * un integrador podria inyectar su propio `tiendaId`. La ventana de `createdAt` es
   * SEMIABIERTA (`gte` / `lt`, NUNCA `lte`): el service ya movio la cota superior al comienzo
   * del dia siguiente en CR para que `hasta` sea inclusivo.
   */
  async listByOwner(params: {
    ownerId: string;
    estatusId?: string;
    createdAtDesde?: Date;
    createdAtHasta?: Date;
    numGuia?: number;
    numRemision?: string;
    skip: number;
    take: number;
  }): Promise<ApiOrdenListResult> {
    // R20/R23: `tiendaId` y `deletedAt` se escriben PRIMERO y de forma INCONDICIONAL. No es
    // estilo: en un object literal, un spread POSTERIOR que repitiera `tiendaId` lo pisaria (gana
    // el ultimo valor escrito) y el listado devolveria ordenes ajenas sin fallar ruidosamente.
    const where: Prisma.OrdenWhereInput = {
      tiendaId: params.ownerId, // R6/R7 (106) + R20 (257): owner FORZADO
      deletedAt: null, // R11 (106) + R23 (257)
      ...(params.estatusId ? { estatusId: params.estatusId } : {}),
      // R15: igualdad estricta sobre columna nullable -> `num_guia = $1` no casa con NULL en SQL.
      ...(params.numGuia !== undefined ? { numGuia: params.numGuia } : {}),
      ...(params.numRemision !== undefined ? { numRemision: params.numRemision } : {}),
      ...(params.createdAtDesde || params.createdAtHasta
        ? {
            createdAt: {
              ...(params.createdAtDesde ? { gte: params.createdAtDesde } : {}),
              ...(params.createdAtHasta ? { lt: params.createdAtHasta } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.orden.findMany({
        where,
        orderBy: { createdAt: "desc" }, // orden estable entre paginas (R10)
        skip: params.skip,
        take: params.take,
        select: API_ORDEN_SELECT,
      }),
      this.prisma.orden.count({ where }),
    ]);
    return { items: rows.map(toApiOrdenRow), total };
  }

  /**
   * Feature 106/R12/R13/R14/R15/R18: detalle de una orden del owner por `num_guia`. El scope
   * va en el WHERE (`tienda_id = ownerId` + `deleted_at IS NULL`): una orden inexistente,
   * borrada o de OTRO owner devuelve `null` (el service -> 404 uniforme, no filtra existencia).
   * Incluye (join, sin N+1) las gestiones con evidencia de entrega/rechazo; `[]` si no hay. LEE
   * `gestion_orden`, nunca escribe.
   */
  async findDetalleByNumGuiaForOwner(
    numGuia: number,
    ownerId: string,
  ): Promise<ApiOrdenDetalleRow | null> {
    const row = await this.prisma.orden.findFirst({
      where: { numGuia, tiendaId: ownerId, deletedAt: null }, // R12/R14/R24: scope forzado
      select: API_ORDEN_DETALLE_SELECT,
    });
    if (!row) return null;
    return toApiOrdenDetalleRow(row);
  }

  // --- Feature 177: consulta por identificador libre + PDF de etiquetas por API key ---

  /**
   * Feature 177/R6-R12 (design §4.2): hasta DOS filas que casan por IGUALDAD EXACTA con el
   * identificador dentro del scope del owner. `take: 2` no es una optimizacion caprichosa:
   * `num_guia` y `num_remision` son `@unique` GLOBALES por separado (schema.prisma:480-481),
   * asi que el maximo teorico es una fila por columna. Con `numGuia = null` (el `{id}` no era
   * entero positivo) la condicion sobre `num_guia` NO se emite: el `OR` queda con una sola
   * rama y la guia nunca casa (R8). Comparacion de igualdad, jamas `contains`/`mode` (R10).
   * NO desempata: la precedencia de R14 vive en el service.
   */
  async findByGuiaORemisionForOwner(
    identificador: { numGuia: number | null; numRemision: string },
    ownerId: string,
  ): Promise<Array<{ id: string; numGuia: number | null; numRemision: string }>> {
    const or: Prisma.OrdenWhereInput[] = [{ numRemision: identificador.numRemision }];
    if (identificador.numGuia !== null) or.unshift({ numGuia: identificador.numGuia });
    return this.prisma.orden.findMany({
      where: {
        tiendaId: ownerId, // R7: owner FORZADO
        deletedAt: null, // R12
        OR: or,
      },
      select: { id: true, numGuia: true, numRemision: true },
      take: 2,
    });
  }

  /**
   * Feature 177/R16/R17: mismo detalle que la 106 pero por `orden.id` (la resolucion de la 177
   * devuelve el id porque `num_guia` puede ser NULL). Comparte `API_ORDEN_DETALLE_SELECT` con
   * `findDetalleByNumGuiaForOwner`, que NO cambia. Scope forzado -> `null` para ajena/borrada.
   */
  async findDetalleByOrdenIdForOwner(
    ordenId: string,
    ownerId: string,
  ): Promise<ApiOrdenDetalleRow | null> {
    const row = await this.prisma.orden.findFirst({
      where: { id: ordenId, tiendaId: ownerId, deletedAt: null },
      select: API_ORDEN_DETALLE_SELECT,
    });
    if (!row) return null;
    return toApiOrdenDetalleRow(row);
  }

  /**
   * Feature 177/R20/R21/R38: referencia persistida del PDF individual. Solo lee
   * `download_storage_path`; `download_url` no entra en la proyeccion, de modo que una fila
   * heredada de la 136/141 (URL caducada, path NULL) devuelve `null` = "no hay PDF".
   */
  async findDownloadStoragePathByOrdenForOwner(
    ordenId: string,
    ownerId: string,
  ): Promise<string | null> {
    const row = await this.prisma.orden.findFirst({
      where: { id: ordenId, tiendaId: ownerId, deletedAt: null },
      select: { downloadStoragePath: true },
    });
    return row?.downloadStoragePath ?? null;
  }

  /**
   * Feature 177/R20/R26: UPDATE de UNA sola columna. El `data` lleva exactamente una clave;
   * `download_url` queda intacta (ni se lee ni se escribe en esta feature).
   */
  async setOrdenDownloadStoragePath(ordenId: string, path: string): Promise<void> {
    await this.prisma.orden.update({
      where: { id: ordenId },
      data: { downloadStoragePath: path },
    });
  }

  /**
   * Feature 177/R29/R32: carga propia + ids de sus ordenes vivas del owner. La propiedad se
   * exige en el WHERE (`usuario_carga = ownerId`), no despues de leer: una carga ajena o
   * inexistente devuelve `null` por el mismo camino, sin filtrar existencia. Las ordenes del
   * lote se acotan ademas por `tienda_id = ownerId` y `deleted_at IS NULL` (R32).
   */
  async findCargaConOrdenesForOwner(
    cargaId: string,
    ownerId: string,
  ): Promise<{ downloadStoragePath: string | null; ordenIds: string[] } | null> {
    const row = await this.prisma.carga.findFirst({
      where: { id: cargaId, usuarioCarga: ownerId }, // R29: propiedad FORZADA
      select: {
        downloadStoragePath: true,
        ordenes: {
          where: { tiendaId: ownerId, deletedAt: null }, // R32
          select: { id: true },
        },
      },
    });
    if (!row) return null;
    return {
      downloadStoragePath: row.downloadStoragePath,
      ordenIds: row.ordenes.map((o) => o.id),
    };
  }

  /**
   * Feature 177/R30/R35: UPDATE de UNA sola columna de `carga`. `download_url` (feature 141)
   * queda intacta.
   */
  async setCargaDownloadStoragePath(cargaId: string, path: string): Promise<void> {
    await this.prisma.carga.update({
      where: { id: cargaId },
      data: { downloadStoragePath: path },
    });
  }

  /**
   * Feature 106/R19-R26: cancela una orden del owner en UNA transaccion (R25). Pre-lee la
   * orden por `num_guia` DENTRO de la tx exigiendo `tienda_id = ownerId` + `deleted_at IS NULL`
   * (R23/R24 -> `not_found`). Si su estado no es cancelable -> `conflict` sin escribir (R20).
   * En estado cancelable: `UPDATE orden.estatus_id = devueltaOrigenEstatusId` + `appendCambioEstado`
   * (`origenTipo:'cancelacion_api'`, `motivo:'cancelada por tienda'`, actor = ownerId) en la MISMA
   * tx (R21/R22/R26). NO escribe en `gestion_orden`. El outbox de webhooks (feature 104) viaja
   * dentro de `appendCambioEstado`.
   */
  async cancelarViaApi(params: {
    numGuia: number;
    ownerId: string;
    devueltaOrigenEstatusId: string;
  }): Promise<CancelarViaApiResult> {
    return this.prisma.$transaction(async (tx) => {
      const orden = await tx.orden.findFirst({
        where: { numGuia: params.numGuia, tiendaId: params.ownerId, deletedAt: null },
        select: { id: true, estatusId: true, estatus: { select: { value: true } } },
      });
      if (!orden) return { status: "not_found" }; // R23/R24
      const estadoActual = orden.estatus.value;
      if (!ESTADOS_CANCELABLES_API.includes(estadoActual)) {
        return { status: "conflict", estadoActual }; // R20 (incl. ya devolviendo_a_tienda)
      }
      // R19/R25: transiciona y registra en la MISMA tx.
      await tx.orden.update({
        where: { id: orden.id },
        data: { estatusId: params.devueltaOrigenEstatusId },
      });
      await appendCambioEstado(tx, [
        {
          ordenId: orden.id,
          estatusOrigenId: orden.estatusId, // R22: estado previo real
          estatusDestinoId: params.devueltaOrigenEstatusId, // devolviendo_a_tienda
          actorUsuarioId: params.ownerId, // R22: actor = actor.usuarioId (= owner)
          origenTipo: "cancelacion_api", // R22
          motivo: "cancelada por tienda", // R26: marcador semantico en la bitacora
        },
      ]);
      return { status: "ok", estadoAnterior: estadoActual };
    });
  }

  /** R28: subconjunto de `ids` con rol `mensajero`, SIN filtro de zona. */
  async findMensajeroIdsValidos(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.usuario.findMany({
      where: { id: { in: ids }, rol: { value: "mensajero" } },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /** R28/T15: TODOS los usuarios con rol `mensajero`, SIN filtro de zona. */
  async findAllMensajeros(): Promise<MensajeroLiteRow[]> {
    return this.prisma.usuario.findMany({
      where: { rol: { value: "mensajero" } },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  /** Feature 30/R5 + 34/R5: usuarios rol `mensajero` cuyo `zonaId` sea la zona pasada. */
  async findMensajerosByZona(zonaId: string): Promise<MensajeroLiteRow[]> {
    return this.prisma.usuario.findMany({
      where: { rol: { value: "mensajero" }, zonaId },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    });
  }

  /** Feature 30/R6 + 34/R9: subconjunto de `ids` con rol `mensajero` Y `zonaId` = zona pasada. */
  async findMensajeroIdsValidosByZona(ids: string[], zonaId: string): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.usuario.findMany({
      where: { id: { in: ids }, rol: { value: "mensajero" }, zonaId },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  /**
   * R15/R16 + feature 63/R5: catalogo completo `order_status` (id, value), solo
   * lectura. `orderBy: { value: "asc" }` garantiza un orden determinista y estable
   * entre renders (tabs de la feature 63); `value` es UNIQUE, asi que el orden es
   * total (sin empates que rompan la estabilidad).
   */
  async listOrderStatus(): Promise<OrderStatusLiteRow[]> {
    return this.prisma.orderStatus.findMany({
      select: { id: true, value: true },
      orderBy: { value: "asc" },
    });
  }

  /**
   * R5/R19/R25: transaccional (todo-o-nada, Prisma revierte automaticamente si
   * el callback lanza). Por cada decision: asigna `num_guia = nextval(...)` SOLO
   * si es NULL (idempotente, no consume la secuencia para filas ya numeradas) y
   * fija `estatusId`/`mensajeroAsignadoId`. El nombre de la secuencia es la
   * constante del modulo (nunca se interpola entrada de usuario en el SQL).
   */
  async generarGuiaLote(
    decisiones: GenerarGuiaDecisionData[],
    historial: HistorialContexto,
  ): Promise<GenerarGuiaResultRow[]> {
    if (decisiones.length === 0) return [];
    return this.prisma.$transaction(async (tx) => {
      // Feature 49/#3 (R20): estatus de ORIGEN por orden, leido dentro de la tx antes de
      // escribir (tras la 156 el origen admitido es uno solo, pero el historial se resuelve
      // por lo que la fila DICE, no por lo que el service supone).
      const origenRows = await tx.orden.findMany({
        where: { id: { in: decisiones.map((d) => d.ordenId) } },
        select: { id: true, estatusId: true },
      });
      const origenById = new Map(origenRows.map((r) => [r.id, r.estatusId]));

      const resultados: GenerarGuiaResultRow[] = [];
      const entradas: CambioEstadoEntrada[] = [];
      for (const d of decisiones) {
        // R5: idempotente — solo consume nextval() si num_guia es NULL.
        await tx.$executeRawUnsafe(
          `UPDATE "orden" SET num_guia = ${NUM_GUIA_GENERATOR} WHERE id = $1 AND num_guia IS NULL`,
          d.ordenId,
        );
        const updated = await tx.orden.update({
          where: { id: d.ordenId },
          data: {
            estatusId: d.estatusId,
            mensajeroAsignadoId: d.mensajeroAsignadoId,
            // Feature 76/R23 (W1): estampa `asignado_at = now` SOLO cuando se asigna un
            // mensajero (valor no nulo); si la decision no lleva mensajero no se toca.
            //
            // FEATURE 246 (T3.5, R8/R10) — Y CON EL, EL DIA DE REPARTO. Tras la 156 esta rama esta
            // MUERTA en la practica: «generar guia» ya no decide mensajero (156/R2), asi que
            // `d.mensajeroAsignadoId` es siempre `null` y este spread no se aplica nunca. Aun asi
            // el dia va aqui, dentro del MISMO spread condicional, por dos motivos: (a) la
            // invariante R10 es «las dos columnas se escriben juntas», y una excepcion «porque hoy
            // no pasa» es justo la clase de excepcion que un dia deja de ser cierta; (b) la
            // guardia `fecha-reparto-acompana-asignado-at` censa el arbol entero y ESTE sitio fue
            // el que encontro — el spec listaba cinco limpiezas y este estampado no estaba.
            //
            // El dia es el de Costa Rica EN CURSO porque esta via NO ofrece la eleccion (R8).
            ...(d.mensajeroAsignadoId != null
              ? { asignadoAt: new Date(), fechaReparto: startOfDayCR() }
              : {}),
          },
          select: { numGuia: true },
        });
        if (updated.numGuia === null) {
          // Guarda defensiva: no deberia ocurrir (el UPDATE previo siempre deja
          // num_guia asignado), pero se documenta en vez de mentir con `as number`.
          throw new Error(`num_guia no asignado para la orden ${d.ordenId}`);
        }
        resultados.push({ ordenId: d.ordenId, numGuia: updated.numGuia });
        // R11: destino real por orden (por_recoger/en_bodega_central/en_ruta_bodega_satelite).
        entradas.push({
          ordenId: d.ordenId,
          estatusOrigenId: origenById.get(d.ordenId) ?? null,
          estatusDestinoId: d.estatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // generacion_guia
        });
      }
      // R7: el append comparte la tx del lote; si falla, se revierten guias y estados.
      await appendCambioEstado(tx, entradas);
      return resultados;
    });
  }

  /** R26: fija mensajero/estatus en lote; NUNCA toca num_guia (idempotencia R5). */
  async asignarBodegaLote(
    ordenIds: string[],
    mensajeroId: string,
    estatusId: string,
    historial: HistorialContexto,
    // Feature 246 (T3.3, R7): el dia de reparto YA RESUELTO por el servicio. Aqui no se calcula
    // ninguna fecha: un solo sitio que sabe traducir «hoy/mañana» es un solo sitio donde ese
    // criterio puede equivocarse.
    fechaReparto: Date,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    // Feature 49/#4 (R7/R8/R12): updateMany + append en la MISMA tx. La guarda del
    // updateMany (`id IN`) no depende de estado mutable, asi que el conjunto que
    // transiciona = las filas existentes de `ordenIds`, pre-leidas para su origen.
    return this.prisma.$transaction(async (tx) => {
      const origenRows = await tx.orden.findMany({
        where: { id: { in: ordenIds } },
        select: { id: true, estatusId: true },
      });
      const result = await tx.orden.updateMany({
        where: { id: { in: ordenIds } },
        // Feature 76/R23 (W2): al fijar el mensajero, estampa `asignado_at = now`.
        // Feature 101/R5 (gate F1.4-Q1): al reasignar desde la bodega central apaga
        // `prioridad` en la MISMA escritura (una orden no hereda prioridad a ciclos futuros).
        // Feature 246 (T3.3, R7/R10): `fechaReparto` va en la MISMA escritura que `asignadoAt`.
        // Nunca en una segunda pasada: si la segunda fallara, la orden quedaria con mensajero y
        // sin dia —indistinguible de una anterior a la feature— y el corte de esa misma noche se
        // la llevaria por delante.
        data: {
          mensajeroAsignadoId: mensajeroId,
          estatusId,
          asignadoAt: new Date(),
          fechaReparto,
          prioridad: false,
        },
      });
      // R8: registra SOLO las filas efectivamente afectadas (las existentes).
      await appendCambioEstado(
        tx,
        origenRows.map((r) => ({
          ordenId: r.id,
          estatusOrigenId: r.estatusId,
          estatusDestinoId: estatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // asignacion_bodega
        })),
      );
      return result.count;
    });
  }

  /**
   * Feature 157 (R3/R5/R38, ampliada el 2026-07-31): asigna el mensajero que ira a la tienda
   * y TRANSICIONA el lote a `recolectando`.
   *
   * Antes solo escribia el mensajero, sin mover el estado. Eso dejaba la orden en el monton de
   * "sin asignar": seguia ofreciendose para asignar y se podia reasignar indefinidamente, que
   * es el bug que esta version cierra. Ahora la asignacion es una transicion de verdad, con su
   * rastro (`asignacion_recoleccion`) en la MISMA tx — el choke point de la feature 49.
   *
   * Lo que sigue SIN tocarse:
   * - **`asignadoAt`** (R38): es el denominador del ranking y el numerador solo cuenta
   *   entregas, asi que estamparlo bajaria el porcentaje del mensajero sin poder subirlo. Se
   *   estampa cuando la orden llegue a la central y se asigne para repartir.
   * - **`numGuia`**: lo tiene desde que nacio.
   * - **`prioridad`**: una recoleccion no participa del ciclo de reasignacion prioritaria.
   *
   * La guarda del `WHERE` (estado de origen + no borrada) es la defensa REAL; la validacion
   * del service solo sirve para reportar mejor. Si no alcanza a TODAS las ordenes pedidas,
   * lanza para que la tx revierta: todo-o-nada (R5).
   */
  async asignarRecoleccionLote(
    ordenIds: string[],
    mensajeroId: string,
    origenValue: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      // Origen pre-leido bajo la MISMA guarda, para el `estatusOrigenId` del historial.
      const origenRows = await tx.orden.findMany({
        where: {
          id: { in: ordenIds },
          deletedAt: null,
          estatus: { value: origenValue },
        },
        select: { id: true, estatusId: true },
      });
      const result = await tx.orden.updateMany({
        where: {
          id: { in: ordenIds },
          deletedAt: null,
          estatus: { value: origenValue },
        },
        data: { mensajeroAsignadoId: mensajeroId, estatusId: destinoEstatusId },
      });
      if (result.count !== ordenIds.length) {
        throw new Error(
          `asignarRecoleccionLote: ${result.count} de ${ordenIds.length} ordenes elegibles`,
        );
      }
      await appendCambioEstado(
        tx,
        origenRows.map((r) => ({
          ordenId: r.id,
          estatusOrigenId: r.estatusId,
          estatusDestinoId: destinoEstatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // asignacion_recoleccion
        })),
      );
      return result.count;
    });
  }

  /**
   * Feature 157 (ampliacion 2026-07-31) — REVIERTE la asignacion de una recoleccion:
   * `recolectando -> por_recolectar_en_tienda`, dejando la orden sin mensajero para que
   * vuelva al monton de asignables.
   *
   * Es el camino explicito que sustituye a la reasignacion silenciosa de antes (decision del
   * humano): cambiar de mensajero exige revertir primero, y las dos mitades quedan en el
   * historial. Reusa la familia `deshacer_asignacion` (feature 149), que ya significa
   * exactamente esto: revertir una asignacion ANTES de la recogida.
   *
   * Todo-o-nada, misma guarda que la asignacion. Devuelve el numero de filas afectadas.
   */
  async desasignarRecoleccionLote(
    ordenIds: string[],
    origenValue: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      const origenRows = await tx.orden.findMany({
        where: {
          id: { in: ordenIds },
          deletedAt: null,
          estatus: { value: origenValue },
        },
        select: { id: true, estatusId: true },
      });
      const result = await tx.orden.updateMany({
        where: {
          id: { in: ordenIds },
          deletedAt: null,
          estatus: { value: origenValue },
        },
        // El mensajero se limpia: la orden vuelve a estar disponible para cualquiera.
        data: { mensajeroAsignadoId: null, estatusId: destinoEstatusId },
      });
      if (result.count !== ordenIds.length) {
        throw new Error(
          `desasignarRecoleccionLote: ${result.count} de ${ordenIds.length} ordenes elegibles`,
        );
      }
      await appendCambioEstado(
        tx,
        origenRows.map((r) => ({
          ordenId: r.id,
          estatusOrigenId: r.estatusId,
          estatusDestinoId: destinoEstatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // deshacer_asignacion
        })),
      );
      return result.count;
    });
  }

  /**
   * Feature 30/R10/R13: rutea el lote no-GAM a `en_ruta_bodega_satelite`.
   * Transaccional (todo-o-nada, Prisma revierte si el callback lanza). Por cada
   * orden asigna `num_guia = nextval(...)` SOLO si es NULL (idempotente, R10, no
   * consume la secuencia para filas ya numeradas), fija `estatusId` y deja
   * `mensajeroAsignadoId = NULL` (R9). El nombre de la secuencia es la constante
   * del modulo (nunca se interpola entrada de usuario en el SQL).
   */
  async rutearBodegaSateliteLote(
    ordenIds: string[],
    estatusId: string,
    historial: HistorialContexto,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      // Feature 49/#5 (R20): estatus de ORIGEN por orden, leido dentro de la tx.
      const origenRows = await tx.orden.findMany({
        where: { id: { in: ordenIds } },
        select: { id: true, estatusId: true },
      });
      const origenById = new Map(origenRows.map((r) => [r.id, r.estatusId]));
      for (const id of ordenIds) {
        // R10: idempotente — solo consume nextval() si num_guia es NULL.
        await tx.$executeRawUnsafe(
          `UPDATE "orden" SET num_guia = ${NUM_GUIA_GENERATOR} WHERE id = $1 AND num_guia IS NULL`,
          id,
        );
        await tx.orden.update({
          where: { id },
          // R9. Feature 76/LC1 (C2): al limpiar el mensajero, limpia tambien
          // `asignado_at` (defensivo, mantiene el invariante asignado_at<->mensajero).
          // Feature 246 (T3.5, R9/R10): `fechaReparto: null` acompana a `asignadoAt: null`. La
          // orden vuelve a bodega sin mensajero, asi que no puede conservar un dia de reparto: una
          // reserva sin duenno es un dato que el corte tendria que interpretar.
          data: { estatusId, mensajeroAsignadoId: null, asignadoAt: null, fechaReparto: null },
        });
      }
      // R13: destino en_ruta_bodega_satelite; append en la MISMA tx (R7).
      await appendCambioEstado(
        tx,
        ordenIds.map((id) => ({
          ordenId: id,
          estatusOrigenId: origenById.get(id) ?? null,
          estatusDestinoId: estatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // ruteo_satelite
        })),
      );
      return ordenIds.length;
    });
  }

  // --- Feature 32: etiqueta de guia (READ derivado, R1/R3) ---

  /**
   * Feature 32/R1/R3: filas para la etiqueta por id. `where` filtra
   * `deletedAt: null` (R3: borrada/inexistente -> ausente, el service la reporta
   * como `no_encontrada`). NO filtra por `num_guia`: devuelve filas con `numGuia`
   * posible null y el service decide `sin_guia` (R2). Solo query.
   */
  async findEtiquetasByIds(ids: string[]): Promise<EtiquetaRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { id: { in: ids }, deletedAt: null }, // R3
      ...WITH_ETIQUETA,
    });
    return rows.map(toEtiquetaRow);
  }

  /**
   * Feature 32/R1/R3 (QR por guia): fila para la etiqueta por `num_guia` (UNIQUE).
   * Mismo filtro `deletedAt: null` que `findEtiquetasByIds` (R3: borrada/inexistente
   * -> `null`, el service la reporta como no encontrada). Solo query.
   */
  async findEtiquetaByNumGuia(numGuia: number): Promise<EtiquetaRow | null> {
    const row = await this.prisma.orden.findFirst({
      where: { numGuia, deletedAt: null }, // R3
      ...WITH_ETIQUETA,
    });
    return row ? toEtiquetaRow(row) : null;
  }

  // --- Feature 148: manifiesto Excel por lote (READ derivado, R4/R6/R7/R12/R29) ---

  /**
   * Feature 148/R4/R6/R7/R12: filas del manifiesto por id. `deletedAt: null` (R12):
   * la orden borrada no aparece y el service la reporta como `no_encontrada`. Solo
   * query, sin logica de negocio (el mapeo flujo -> origen/destino/responsable vive
   * en `ManifiestoService`).
   */
  async findManifiestoByIds(ids: string[]): Promise<ManifiestoOrdenRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { id: { in: ids }, deletedAt: null }, // R12
      ...WITH_MANIFIESTO,
    });
    return rows.map(toManifiestoOrdenRow);
  }

  /**
   * Feature 148/R4/R12/R29: filas del manifiesto por `num_remision`, ACOTADAS a
   * `tiendaId` (mismo `where` que `findResumenByNumRemisiones`, R29) y no borradas
   * (R12). Es la via de la carga masiva, cuyo summary no lleva ids (design.md §2).
   */
  async findManifiestoByRemisiones(
    remisiones: string[],
    tiendaId: string,
  ): Promise<ManifiestoOrdenRow[]> {
    if (remisiones.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: { numRemision: { in: remisiones }, tiendaId, deletedAt: null }, // R12/R29
      ...WITH_MANIFIESTO,
    });
    return rows.map(toManifiestoOrdenRow);
  }

  /** Feature 148/R9: `usuario.nombre` del actor; `null` si el usuario no resuelve. */
  async findUsuarioNombre(usuarioId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { nombre: true },
    });
    return row?.nombre ?? null;
  }

  // --- Feature 33: recepcion por QR en la bodega satelite (R4/R5/R6/R8/R11/R18) ---

  /** Feature 33/R4/R5: `usuario.zonaId` del adminSatelite; `null` si no tiene. */
  async findUsuarioZonaId(usuarioId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { zonaId: true },
    });
    return row?.zonaId ?? null;
  }

  /** Feature 39/R1/R4: `usuario.vehiculoId` del mensajero; `null` si no tiene. */
  async findUsuarioVehiculoId(usuarioId: string): Promise<string | null> {
    const row = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { vehiculoId: true },
    });
    return row?.vehiculoId ?? null;
  }

  /**
   * Feature 33/R6/R8/R9: ordenes NO borradas de `zonaId` cuyo `estatus.value`
   * esta en `estatusValues`, con nombres legibles de tienda/geografia. Solo query.
   *
   * Feature 101/R7: ordena `prioridad DESC` PRIMERO y LUEGO `createdAt DESC` (recencia,
   * criterio vigente). El sort va en la QUERY (no en memoria) para respetar la paginacion:
   * una orden prioritaria flota a la primera pagina. Solo el grupo "Recibidas"
   * (`en_bodega_satelite`) tiene prioritarias; los demas grupos que devuelve el mismo query
   * (por recibir / rechazada / devuelta) tienen `prioridad = false`, asi que el desempate es
   * inocuo para ellos (R10, sin reordenar por prioridad superficies ajenas).
   */
  async findRecepcionSateliteByZona(
    zonaId: string,
    estatusValues: string[],
  ): Promise<RecepcionSateliteRow[]> {
    if (estatusValues.length === 0) return [];
    const rows = await this.prisma.orden.findMany({
      where: {
        zonaId,
        deletedAt: null, // R6: excluye borradas
        estatus: { value: { in: estatusValues } },
      },
      orderBy: [{ prioridad: "desc" }, { createdAt: "desc" }], // R7: prioridad-first + recencia
      ...WITH_RECEPCION_SATELITE,
    });
    return rows.map(toRecepcionSateliteRow);
  }

  /**
   * Feature 170 — FASE 2 (T K.1, R40/R41/R44/R45/R51): una PAGINA del listado de la bodega
   * satelite, con sus tres filtros aplicados al CONJUNTO y el total del conjunto.
   *
   * **Por que va en SQL crudo, y solo esta parte.** El orden que la pantalla enseña hoy es
   * «primero el grupo, dentro del grupo prioridad y recencia»: no lo declara ningun `orderBy`,
   * lo produce el modulo al CONCATENAR los cinco arrays en el orden de
   * `ESTADOS_BODEGA_SATELITE`. Para conservarlo bajo paginacion (R51) el rango de grupo tiene
   * que ir en el `ORDER BY` de la consulta que aplica el `LIMIT`, y Prisma no sabe ordenar por
   * una secuencia arbitraria de valores de una relacion —solo asc/desc—. El escape es el mismo
   * que ya usa `ChatConversacionRepository` cuando Prisma no puede normalizar en el WHERE:
   * `Prisma.sql` parametrizado, sin una sola interpolacion de texto.
   *
   * **Se piden solo los `id`.** La proyeccion sigue siendo `WITH_RECEPCION_SATELITE` +
   * `toRecepcionSateliteRow`, la MISMA del listado sin paginar: reescribirla a mano en SQL
   * duplicaria quince columnas y sus conversiones (Decimal, nombres de relacion) para que
   * divergieran a la primera.
   *
   * **El total viaja en la misma consulta** (`COUNT(*) OVER ()`). No es un ahorro: es que asi
   * la pagina y el conteo NO PUEDEN mirar conjuntos distintos, que es la divergencia que R41
   * y R44 prohiben. La unica rama con una consulta de conteo aparte es la pagina VACIA (mas
   * alla del final), donde la ventana no devuelve ninguna fila de la que leer el total; ahi se
   * reusa literalmente el mismo fragmento `FROM ... WHERE`.
   */
  async findRecepcionSatelitePaginada(
    filtro: RecepcionSateliteFiltro,
    rango: RangoPagina,
  ): Promise<PaginaRepositorio<RecepcionSateliteRow>> {
    // Sin estados no hay conjunto: el listado se define por ellos (espejo de la guarda de
    // `findRecepcionSateliteByZona`). Se corta ANTES de consultar.
    if (filtro.estatusValues.length === 0) return { items: [], total: 0 };

    // Feature 184 (T A.1): el criterio y el orden salen de los helpers compartidos; el `LIMIT`
    // y el `COUNT(*) OVER ()` son lo UNICO propio de la pagina.
    const desde = desdeSatelite(condicionesSatelite(filtro));

    const pagina = await this.prisma.$queryRaw<PaginaSateliteIdRow[]>(Prisma.sql`
      SELECT o."id", (COUNT(*) OVER ())::int AS "total"
      ${desde}
      ${ordenBodegaSatelite()}
      LIMIT ${rango.take} OFFSET ${rango.skip}
    `);

    if (pagina.length === 0) {
      const conteo = await this.prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
        SELECT (COUNT(*))::int AS "total"
        ${desde}
      `);
      return { items: [], total: conteo[0]?.total ?? 0 };
    }

    const items = await this.hidratarSatelite(
      pagina.map((fila) => fila.id),
      filtro.zonaId,
    );
    return { items, total: pagina[0]!.total };
  }

  /**
   * Feature 184 — Tanda A (T A.1, R1/R2/R15/R16) — el CONJUNTO FILTRADO ENTERO del listado
   * «Órdenes de la bodega», sin recorte de pagina, para producir el archivo.
   *
   * Es el hermano sin `LIMIT`/`OFFSET` de `findRecepcionSatelitePaginada`, y lo es
   * LITERALMENTE: comparten `condicionesSatelite` y `ordenBodegaSatelite`, asi que la fila N
   * del archivo es la fila N que la pantalla enseñaria al pasar paginas (R5/R16). Lo unico que
   * esta consulta no lleva es el recorte —y el `COUNT(*) OVER ()`, que aqui sobra: el total es
   * el tamaño de lo que devuelve—.
   *
   * Sustituye a `conjuntoFiltrado()`, que releia los CINCO grupos de la zona entera y volvia a
   * cruzar estado ∧ canton ∧ distrito en el navegador: el mismo criterio escrito dos veces, en
   * dos capas y en dos lenguajes (Q-K4).
   *
   * **Dos consultas**, las mismas que la pagina: la que ordena y la que hidrata. La proyeccion
   * sigue siendo `WITH_RECEPCION_SATELITE` por el mismo motivo que alli —reescribir quince
   * columnas en SQL crudo es garantizar que diverjan—. El tope de filas NO se evalua aqui: es
   * una regla de negocio y vive en el servicio (R6).
   */
  async findRecepcionSateliteCompleta(
    filtro: RecepcionSateliteFiltro,
  ): Promise<RecepcionSateliteRow[]> {
    if (filtro.estatusValues.length === 0) return [];

    const conjunto = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT o."id"
      ${desdeSatelite(condicionesSatelite(filtro))}
      ${ordenBodegaSatelite()}
    `);
    if (conjunto.length === 0) return [];

    return this.hidratarSatelite(
      conjunto.map((fila) => fila.id),
      filtro.zonaId,
    );
  }

  /**
   * Feature 184 — Tanda A (T A.2, R19/R21) — cuales de `ids` siguen perteneciendo al conjunto
   * filtrado. Alimenta la PODA de la seleccion de la bodega satelite: una orden marcada que
   * salio del listado (un incidente, un movimiento de otro operador) deja de estar marcada.
   *
   * Devuelve los VIGENTES, nunca los caducados: asi una respuesta vacia por error jamas puede
   * leerse como «desmarca todo».
   *
   * **El `IN` de ids NO es la guarda.** El acotamiento (`zona` ∧ no borrada ∧ estados del
   * listado ∧ los filtros vigentes) se repite entero en el `WHERE` aunque los ids vengan del
   * cliente: sin el, un actor podria preguntar por identificadores de otra zona y la respuesta
   * —el propio hecho de que un id vuelva— le confirmaria que existen (R21).
   *
   * **Una sola consulta y una sola columna** (`SELECT o."id"`): es una pregunta de pertenencia,
   * no una lectura del listado. Sin ids no consulta (R23 tambien en el servidor).
   */
  async findIdsVigentesEnBodega(
    filtro: RecepcionSateliteFiltro,
    ids: readonly string[],
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    if (filtro.estatusValues.length === 0) return [];

    const condiciones = condicionesSatelite(filtro);
    condiciones.push(Prisma.sql`o."id" IN (${Prisma.join([...ids])})`);

    const filas = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT o."id"
      ${desdeSatelite(condiciones)}
    `);
    return filas.map((fila) => fila.id);
  }

  /**
   * Feature 184 (T A.1) — hidrata los ids que la consulta ordenada devolvio, CONSERVANDO ese
   * orden (el `findMany` no lo garantiza) y repitiendo el acotamiento por zona: esta es la
   * consulta que devuelve datos, y una lista de ids nunca debe ser su unica guarda.
   *
   * Lo comparten la pagina y el conjunto de la descarga: dos copias de esto son dos formas de
   * proyectar la misma fila, que es como se producen dos archivos distintos del mismo listado.
   */
  private async hidratarSatelite(
    ids: string[],
    zonaId: string,
  ): Promise<RecepcionSateliteRow[]> {
    const filas = await this.prisma.orden.findMany({
      where: { id: { in: ids }, zonaId, deletedAt: null },
      ...WITH_RECEPCION_SATELITE,
    });
    const porId = new Map(filas.map((fila) => [fila.id, fila]));
    return ids.flatMap((id) => {
      const fila = porId.get(id);
      return fila === undefined ? [] : [toRecepcionSateliteRow(fila)];
    });
  }

  async recibirEnSatelite(
    ordenId: string,
    zonaId: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<boolean> {
    // Feature 49/#6 (R7/R8/R14): updateMany guardado + append en la MISMA tx.
    return this.prisma.$transaction(async (tx) => {
      // R20: origen pre-leido con la MISMA guarda (estado en_ruta_bodega_satelite + zona).
      const actual = await tx.orden.findFirst({
        where: {
          id: ordenId,
          zonaId,
          deletedAt: null,
          estatus: { value: ORIGEN_RECEPCION_SATELITE },
        },
        select: { estatusId: true },
      });
      const result = await tx.orden.updateMany({
        where: {
          id: ordenId,
          zonaId,
          deletedAt: null,
          estatus: { value: ORIGEN_RECEPCION_SATELITE },
        },
        data: { estatusId: destinoEstatusId },
      });
      // R8: SOLO si transiciono (count 1); una orden que perdio la carrera no deja rastro.
      if (result.count === 1 && actual !== null) {
        await appendCambioEstado(tx, [
          {
            ordenId,
            estatusOrigenId: actual.estatusId,
            estatusDestinoId: destinoEstatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // recepcion_satelite
          },
        ]);
      }
      return result.count === 1;
    });
  }

  /**
   * Recepcion en la tienda de ORIGEN (`devolviendo_a_tienda` -> `devuelta_a_tienda`), cierre
   * del flujo de devolucion. Espejo EXACTO de `recibirEnSatelite` cambiando la guarda
   * de zona por la de tienda: updateMany guardado + append del historial en la MISMA
   * tx (choke point de la feature 49), con el origen pre-leido bajo la misma guarda.
   * La guarda por `tiendaId` en el WHERE es la defensa real contra recibir una orden
   * ajena (el service ademas lo comprueba antes, para poder reportarlo distinto).
   */
  async recibirEnOrigen(
    ordenId: string,
    tiendaId: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Origen pre-leido con la MISMA guarda (estado devolviendo_a_tienda + tienda).
      const actual = await tx.orden.findFirst({
        where: {
          id: ordenId,
          tiendaId,
          deletedAt: null,
          estatus: { value: ORIGEN_RECEPCION_ORIGEN },
        },
        select: { estatusId: true },
      });
      const result = await tx.orden.updateMany({
        where: {
          id: ordenId,
          tiendaId,
          deletedAt: null,
          estatus: { value: ORIGEN_RECEPCION_ORIGEN },
        },
        data: { estatusId: destinoEstatusId },
      });
      // SOLO si transiciono (count 1); una orden que perdio la carrera no deja rastro.
      if (result.count === 1 && actual !== null) {
        await appendCambioEstado(tx, [
          {
            ordenId,
            estatusOrigenId: actual.estatusId,
            estatusDestinoId: destinoEstatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // ajuste_estado (como la devolucion)
          },
        ]);
      }
      return result.count === 1;
    });
  }

  /**
   * Feature 138/R2/R3/R9/R18 + feature 139/R17 (STATE-AWARE): recepcion en la BODEGA CENTRAL. El par
   * ORIGEN->DESTINO lo resuelve el SERVICE por el estado de origen de la orden y lo pasa como
   * `origenValue`/`destinoEstatusId`: `en_ruta_bodega_central -> en_bodega_central` (138) o
   * `devolviendo_a_bodega_central -> por_devolver_a_tienda` (139). Espejo de
   * `recibirEnOrigen`/`recibirEnSatelite` pero SIN guarda de tienda ni de zona: la bodega central es
   * global (R11). La UNICA guarda es el estado de ORIGEN (`estatus.value = origenValue`) + no borrada,
   * impuesta en el propio `updateMany` (concurrencia-segura, R9): a lo sumo UNA de dos recepciones
   * concurrentes afecta 1 fila. Origen pre-leido bajo la misma guarda; append del historial
   * (`origenTipo` = el pasado en `historial`, `recepcion_bodega_central`) SOLO si transiciono (count 1),
   * en la MISMA tx (choke point feature 49: historial + outbox de webhook). NO toca
   * `mensajeroAsignadoId` ni `numGuia` (R18).
   */
  async recibirEnBodegaCentral(
    ordenId: string,
    origenValue: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Origen pre-leido con la MISMA guarda (estado `origenValue` + no borrada). SIN zona/tienda:
      // cualquier orden en el origen es elegible (R11).
      const actual = await tx.orden.findFirst({
        where: {
          id: ordenId,
          deletedAt: null,
          estatus: { value: origenValue },
        },
        select: { estatusId: true },
      });
      const result = await tx.orden.updateMany({
        where: {
          id: ordenId,
          deletedAt: null,
          estatus: { value: origenValue },
        },
        data: { estatusId: destinoEstatusId },
      });
      // R3/R9: SOLO si transiciono (count 1); una orden que perdio la carrera no deja rastro.
      if (result.count === 1 && actual !== null) {
        await appendCambioEstado(tx, [
          {
            ordenId,
            estatusOrigenId: actual.estatusId,
            estatusDestinoId: destinoEstatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // recepcion_bodega_central
          },
        ]);
      }
      return result.count === 1;
    });
  }

  /**
   * Feature 157 (R26/R28/R34/R35): el mensajero confirma la recoleccion en la tienda
   * (`por_recolectar_en_tienda -> en_ruta_bodega_central`, arista #43). Espejo de
   * `recibirEnBodegaCentral` con UNA diferencia sustantiva: `mensajeroAsignadoId` entra en
   * AMBOS `where`, de modo que la PROPIEDAD es parte de la guardia atomica y no solo una
   * comprobacion previa del service (R34). Dos mensajeros no pueden recolectar la misma orden,
   * y quien no la tiene asignada no la mueve ni ganando la carrera.
   *
   * NO toca `numGuia` (lo tiene desde que nacio) ni `mensajeroAsignadoId` (R35): el mensajero
   * sigue siendo el mismo, ahora con el paquete encima. `appendCambioEstado` solo si
   * transiciono (count 1), en la MISMA tx (choke point feature 49).
   */
  async recolectarEnTienda(
    ordenId: string,
    origenValue: string,
    destinoEstatusId: string,
    mensajeroId: string,
    historial: HistorialContexto,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const actual = await tx.orden.findFirst({
        where: {
          id: ordenId,
          deletedAt: null,
          estatus: { value: origenValue },
          mensajeroAsignadoId: mensajeroId,
        },
        select: { estatusId: true },
      });
      const result = await tx.orden.updateMany({
        where: {
          id: ordenId,
          deletedAt: null,
          estatus: { value: origenValue },
          mensajeroAsignadoId: mensajeroId,
        },
        data: { estatusId: destinoEstatusId },
      });
      if (result.count === 1 && actual !== null) {
        await appendCambioEstado(tx, [
          {
            ordenId,
            estatusOrigenId: actual.estatusId,
            estatusDestinoId: destinoEstatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // recoleccion_tienda
          },
        ]);
      }
      return result.count === 1;
    });
  }

  /**
   * Feature 63 — recepcion EN LOTE en la bodega satelite (paridad con `recogerLote`
   * del mensajero). UPDATE raw guardado por estado de ORIGEN + zona + no borrada, con
   * `RETURNING "id"` DENTRO de un `$transaction`, y con los ids retornados (EXACTAMENTE
   * las ordenes que ganaron la guarda) hace el append del historial en la MISMA tx. Una
   * orden de otra zona, en otro estado o re-ejecutada no aparece en el RETURNING -> no se
   * toca ni deja rastro (idempotente y concurrencia-segura, patron `asignarSateliteLote`).
   * NO toca `mensajero_asignado_id` ni `num_guia`. `updated_at` se fija a mano (el raw no
   * dispara el @updatedAt de Prisma). Devuelve el count de filas recibidas.
   */
  async recibirLoteEnSatelite(
    ordenIds: string[],
    zonaId: string,
    origenEstatusId: string,
    destinoEstatusId: string,
    historial: HistorialContexto,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "orden"
        SET "estatus_id" = ${destinoEstatusId},
            "updated_at" = NOW()
        WHERE "id" IN (${Prisma.join(ordenIds)})
          AND "zona_id" = ${zonaId}
          AND "estatus_id" = ${origenEstatusId}
          AND "deleted_at" IS NULL
        RETURNING "id"`;
      await appendCambioEstado(
        tx,
        rows.map((r) => ({
          ordenId: r.id,
          estatusOrigenId: origenEstatusId, // la guarda garantiza este origen (en_ruta_bodega_satelite)
          estatusDestinoId: destinoEstatusId, // en_bodega_satelite
          actorUsuarioId: historial.actorUsuarioId, // el adminSatelite que recibe
          origenTipo: historial.origenTipo, // recepcion_satelite
        })),
      );
      return rows.length;
    });
  }

  // --- Feature 34: asignacion satelite a mensajeros de la zona (R7/R14) ---

  /**
   * Feature 34/R7/R14: transiciona el lote a `por_recoger` fijando
   * `mensajeroAsignadoId`, con escritura guardada por estado de ORIGEN + zona (solo
   * las que sigan en `origenEstatusId`, de `zonaId` y no borradas; patron
   * `recibirEnSatelite`, concurrencia-segura). Filtra por `estatusId` (id ya
   * resuelto por el service), NO por `estatus.value`. NUNCA toca `numGuia` (R8).
   * Devuelve el numero de filas efectivamente transicionadas.
   *
   * Feature 101/R5 (gate F1.4-Q1): al reasignar desde la bodega SATELITE apaga
   * `"prioridad" = false` en el MISMO `SET` (paridad con `asignarBodegaLote`), asi una
   * orden liberada por SLA no arrastra prioridad a ciclos futuros.
   */
  async asignarSateliteLote(
    ordenIds: string[],
    mensajeroId: string,
    zonaId: string,
    destinoEstatusId: string,
    origenEstatusId: string,
    historial: HistorialContexto,
    // Feature 246 (T3.3, R7): el dia de reparto YA RESUELTO por el servicio, igual que en la
    // bodega central (D4: la regla no depende de desde que bodega te asignaron). Entra en el `SET`
    // como TEXTO `YYYY-MM-DD` con `::date` explicito, no como `Date`: ver
    // `fechaRepartoComoTexto`, que explica por que pasar el `Date` dejaria el dia a merced del
    // `TimeZone` de la sesion de Postgres.
    fechaReparto: Date,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    // ⚠️ FEATURE 241 (2026-08-20) — AQUI VIVIA EL `NOT EXISTS` SOBRE `cierre_dia`, Y SE FUE.
    //
    // Era la guardia anti-TOCTOU de la 41/R23: repetia dentro del UPDATE el criterio viejo
    // (`estado IN ('solicitado','vencido','rechazado')`) para que un cierre aparecido entre el
    // pre-check del service y la escritura no colara la asignacion. El 2026-08-18 se retiro el
    // pre-check del service y ESTE se quedo, con el criterio de antes: la pantalla dejaba elegir
    // al mensajero y el UPDATE devolvia 0 filas, que el service traducia a un `conflict` con
    // `detalle: []` y la UI a «Actualiza la lista y vuelve a intentarlo» — un mensaje falso dos
    // veces, porque las ordenes estaban perfectas y reintentar no arreglaba nada (investigacion
    // 241 §4.2). Dos comprobaciones de la misma accion afirmando lo contrario, en dos capas.
    //
    // Se va porque bloquea EXACTAMENTE lo que la regla firmada permite: recibir asignaciones no se
    // bloquea nunca, con cierre o sin el. No queda guardia de cierre que sincronizar aqui, asi que
    // tampoco queda TOCTOU que defender: no hay carrera contra una condicion que ya no existe.
    //
    // El RESTO de la guardia (estado de origen + zona + no borrada) se conserva intacto — es lo que
    // hace la escritura concurrencia-segura (patron `recibirEnSatelite`) y no tiene nada que ver
    // con los cierres. NO toca num_guia (R8). `updated_at` se fija a mano (raw no dispara el
    // @updatedAt de Prisma).
    //
    // Feature 49/#7 (R7/R8/R15): el UPDATE crudo pasa a `RETURNING "id"` DENTRO de un
    // `$transaction`, y con los ids retornados (EXACTAMENTE las ordenes que ganaron la
    // guarda anti-TOCTOU) hace el append del historial en la MISMA tx. Una orden que
    // pierde la guarda (bloqueo/estado/zona) NO aparece en el RETURNING -> no deja rastro.
    // El contrato de retorno sigue siendo el count de filas transicionadas (`rows.length`).
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "orden"
        SET "mensajero_asignado_id" = ${mensajeroId},
            "asignado_at" = NOW(),
            "fecha_reparto" = ${fechaRepartoComoTexto(fechaReparto)}::date,
            "estatus_id" = ${destinoEstatusId},
            "prioridad" = false,
            "updated_at" = NOW()
        WHERE "id" IN (${Prisma.join(ordenIds)})
          AND "estatus_id" = ${origenEstatusId}
          AND "zona_id" = ${zonaId}
          AND "deleted_at" IS NULL
        RETURNING "id"`;
      await appendCambioEstado(
        tx,
        rows.map((r) => ({
          ordenId: r.id,
          estatusOrigenId: origenEstatusId, // la guarda garantiza este origen (R20)
          estatusDestinoId: destinoEstatusId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // asignacion_satelite
        })),
      );
      return rows.length;
    });
  }

  // --- Feature 149: deshacer asignacion / ruteo antes de la recogida ---

  /**
   * Feature 149 (design §3.2) — reversion transaccional de un lote de asignaciones/ruteos.
   *
   * Molde de `asignarSateliteLote` (UPDATE crudo guardado + `RETURNING` + append en la misma
   * tx) con TRES diferencias deliberadas:
   *   1. El `SET` LIMPIA la asignacion (`mensajero_asignado_id = NULL`, `asignado_at = NULL`)
   *      en vez de fijarla (R8/R9/R10), y NO menciona `num_guia` (D2/R29) ni `prioridad`
   *      (Q2/R30). Esa AUSENCIA es el mecanismo, y es aserto de test (T4.12).
   *   2. NO hay `NOT EXISTS` sobre `cierre_dia` (Q1 CERRADA, R19): el cierre pendiente del
   *      mensajero NO bloquea el deshacer. Ver design §8-Q1: la orden nunca se recogio, no
   *      entra en ningun cuadre de caja, y el gate de asignacion existe para lo contrario
   *      (que no se le APILEN ordenes a quien esta cuadrando).
   *   3. TODO-O-NADA REAL: si alguna orden no gana su guarda, LANZA y revierte la tx entera,
   *      en vez de dejar pasar a los ganadores (R20/R21).
   *
   * El destino es POR ORDEN (cada una vuelve a la bodega de la que salio), asi que se emite un
   * UPDATE por orden en vez de uno solo con `IN (...)`. Los lotes son de decenas de ordenes,
   * dentro de una unica transaccion.
   */
  async deshacerAsignacionLote(
    items: readonly DeshacerAsignacionItem[],
    origenEstatusIdPorOrden: ReadonlyMap<string, string>,
    historial: HistorialContexto & { motivo: string },
    zonaId: string | null,
  ): Promise<number> {
    if (items.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      const transicionadas: { ordenId: string; origenEstatusId: string; destinoId: string }[] = [];
      const noTransicionadas: string[] = [];
      // Pre-read del lote DENTRO de la tx: captura el `mensajero_asignado_id` PREVIO (el UPDATE
      // lo pone a NULL). Esta feature NO lo consume; existe para el ancla TODO(146) de abajo.
      const previos = await tx.$queryRaw<{ id: string; mensajero_asignado_id: string | null }[]>`
        SELECT "id", "mensajero_asignado_id"
        FROM "orden"
        WHERE "id" IN (${Prisma.join(items.map((i) => i.ordenId))})`;
      const mensajeroPrevioPorOrden = new Map(
        previos.map((p) => [p.id, p.mensajero_asignado_id] as const),
      );
      void mensajeroPrevioPorOrden; // consumido por la feature 146 (ver ancla mas abajo)

      for (const item of items) {
        const origenEstatusId = origenEstatusIdPorOrden.get(item.ordenId);
        if (origenEstatusId === undefined) {
          // El service SIEMPRE provee el origen de cada item; si faltara, la orden no se toca
          // y el lote entero se revierte por el throw de abajo (fallo CERRADO).
          noTransicionadas.push(item.ordenId);
          continue;
        }
        // Feature 246 (T3.5, R9/R10): el `SET` de abajo limpia `fecha_reparto` en la MISMA
        // sentencia que `asignado_at`. Deshacer la asignacion deshace tambien la reserva: una
        // reserva sin mensajero es un dato huerfano que el corte tendria que interpretar.
        //
        // El porque va AQUI ARRIBA y no dentro del `SET`: un comentario `--` dentro de la clausula
        // no es solo estetica — el test de integracion `deshacer-asignacion.trazabilidad-carga`
        // interpreta este SQL con una base en memoria que parsea el `SET` asignacion por
        // asignacion, y un comentario ahi dentro lo revienta. Medido, no supuesto.
        const rows = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "orden"
          SET "estatus_id" = ${item.destinoEstatusId},
              "mensajero_asignado_id" = NULL,
              "asignado_at" = NULL,
              "fecha_reparto" = NULL,
              "updated_at" = NOW()
          WHERE "id" = ${item.ordenId}
            AND "estatus_id" = ${origenEstatusId}
            AND "deleted_at" IS NULL
            ${zonaId === null ? Prisma.empty : Prisma.sql`AND "zona_id" = ${zonaId}`}
          RETURNING "id"`;
        if (rows.length === 1) {
          transicionadas.push({
            ordenId: item.ordenId,
            origenEstatusId,
            destinoId: item.destinoEstatusId,
          });
        } else {
          noTransicionadas.push(item.ordenId);
        }
      }

      // R20/R21: una sola perdedora aborta el lote COMPLETO (el throw revierte la tx).
      if (noTransicionadas.length > 0) {
        throw new DeshacerAsignacionConflictoError(noTransicionadas);
      }

      // R31/R32/R33: historial + webhook en la MISMA tx, solo de las ordenes transicionadas
      // (aqui, por el todo-o-nada, son todas). El choke point valida la transicion (140).
      await appendCambioEstado(
        tx,
        transicionadas.map((t) => ({
          ordenId: t.ordenId,
          estatusOrigenId: t.origenEstatusId, // la guarda del UPDATE garantiza este origen
          estatusDestinoId: t.destinoId,
          actorUsuarioId: historial.actorUsuarioId,
          origenTipo: historial.origenTipo, // deshacer_asignacion
          motivo: historial.motivo, // R23: el motivo del lote, ya recortado por el borde
        })),
      );

      // TODO(146): productor de notificación al mensajero desasignado. Cuando exista la campana
      // de notificaciones (feature 146), encolar AQUI —en esta misma tx, patrón transactional-
      // outbox del webhook de estado— un aviso por cada orden revertida que TENIA mensajero:
      //   destinatario = mensajeroAsignadoId ANTES del UPDATE (capturarlo del RETURNING o del
      //                  pre-read; el UPDATE ya lo puso a NULL)
      //   contenido    = "La orden <num_guia> fue retirada de tus asignaciones"
      // Solo caso (a) (`por_recoger`); el caso (b) no tiene mensajero. Ver specs/149 R41.
      // El pre-read `mensajeroPrevioPorOrden` (arriba) ya deja el destinatario disponible.

      return transicionadas.length;
    });
  }

  // --- Feature 41 -> 241: bloqueo derivado para GESTIONAR (R12/R16/R17) ---

  /**
   * R12/R16 + feature 241 (regla firmada 2026-08-20): de `ids`, los mensajeros que NO pueden
   * gestionar ni cobrar porque arrastran AL MENOS UN cierre en `vencido` o `rechazado`.
   *
   * EL NOMBRE LLEVA «PARA GESTION» A PROPOSITO. Este predicado se llamaba `findMensajerosBloqueadosParaGestion`
   * y esa ambiguedad —bloqueado, ¿para que?— es la causa directa de la ficha 241: el 2026-08-18 se
   * cambio «el bloqueo» creyendo que se tocaba solo la asignacion, y con el mismo gesto se apagaron
   * `gestionar`/`recoger`/`escoger`, `deshacerGestion` y la recoleccion en tienda, que leian este
   * mismo dato. Hoy la respuesta esta en el nombre, en cada uno de sus call sites: LO UNICO que este
   * predicado bloquea es GESTIONAR Y COBRAR. RECIBIR ASIGNACIONES NO SE BLOQUEA NUNCA — y por eso
   * ninguna superficie de asignacion lo llama (ni figura en sus `Pick<IOrdenRepository, ...>`).
   *
   * Vuelve a ser «tiene ALGUNO», sin tope: entre el 2026-08-18 y hoy el corte era «mas de 1 cierre
   * abierto» y el invariante 109/R30 —un mensajero NUNCA tiene 2 cierres abiertos a la vez— lo hacia
   * INALCANZABLE. No era un umbral, era el predicado apagado. Con la regla nueva el tope sobra: lo
   * que decide es QUE estados bloquean, no cuantos hay.
   *
   * `distinct` sobre `mensajeroId` (interesa QUIEN, no cuantos) contra el indice `(mensajero_id,
   * estado)`.
   */
  async findMensajerosBloqueadosParaGestion(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.cierreDia.findMany({
      where: { mensajeroId: { in: ids }, estado: { in: ESTADOS_CIERRE_BLOQUEAN_GESTION } },
      select: { mensajeroId: true },
      distinct: ["mensajeroId"], // usa el indice (mensajero_id, estado)
    });
    return new Set(rows.map((r) => r.mensajeroId));
  }

  /**
   * Feature 241 — de `ids`, los mensajeros con AL MENOS UN cierre ABIERTO (los tres estados que no
   * son `aprobado`). Es un dato INFORMATIVO y no bloquea nada: alimenta el aviso «tienes N cierres
   * abiertos de tus mensajeros» de la bodega satelite, que sigue siendo cierto y util para quien
   * cuadra caja.
   *
   * Va SEPARADO de `findMensajerosBloqueadosParaGestion` porque son dos preguntas distintas y desde
   * la 241 tienen dos respuestas distintas. Compartirlas fue lo que dejo el aviso de la UI diciendo
   * una cosa y el servidor haciendo otra. Privado: nadie fuera del repositorio necesita esta
   * distincion, y exponerla invitaria a usarla como bloqueo.
   */
  private async findMensajerosConCierreAbierto(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.cierreDia.findMany({
      where: { mensajeroId: { in: ids }, estado: { in: ESTADOS_CIERRE_ABIERTO } },
      select: { mensajeroId: true },
      distinct: ["mensajeroId"],
    });
    return new Set(rows.map((r) => r.mensajeroId));
  }

  /**
   * Feature 157 (regla de dedicacion) — de `ids`, los mensajeros que tienen AL MENOS una
   * orden VIVA en alguno de los `estados` dados. Generico a proposito: el llamador decide
   * que cuenta como "ocupado", que no es lo mismo segun lo que se le vaya a asignar
   * (reparto y recoleccion se excluyen mutuamente, pero varias recolecciones conviven).
   *
   * `distinct` sobre el mensajero: interesa QUIEN esta ocupado, no cuanto.
   */
  async findMensajerosConOrdenesEn(
    ids: string[],
    estados: string[],
  ): Promise<Set<string>> {
    if (ids.length === 0 || estados.length === 0) return new Set();
    const rows = await this.prisma.orden.findMany({
      where: {
        mensajeroAsignadoId: { in: ids },
        deletedAt: null,
        estatus: { value: { in: estados } },
      },
      select: { mensajeroAsignadoId: true },
      distinct: ["mensajeroAsignadoId"],
    });
    return new Set(
      rows
        .map((r) => r.mensajeroAsignadoId)
        .filter((id): id is string => id !== null),
    );
  }

  /**
   * Zonas (central y satelite) con AL MENOS 1 mensajero BLOQUEADO PARA GESTIONAR — mismo criterio
   * que `findMensajerosBloqueadosParaGestion`, escrito como un `some` sobre la relacion.
   *
   * Feature 241: vuelve a UNA consulta. Entre el 2026-08-18 y hoy delegaba en el predicado tras un
   * pre-filtro porque el criterio («mas de N cierres abiertos») no era expresable como un `some`;
   * quitado el tope, «tiene alguno de los que bloquean» SI lo es, y la segunda consulta sobraba.
   *
   * ⚠️ SIN CONSUMIDOR DE PRODUCCION desde el 2026-08-18, cuando el commit `6a0e6d36` borro la
   * server action `listarZonasBloqueadasPorCierre` que era su unica llamadora (investigacion 241
   * §2.6). Se conserva —no se borra en esta ficha, que no es de limpieza— pero quien lo revive debe
   * saber que hoy solo lo tocan los tests.
   *
   * La pertenencia a la zona se lee de `usuario.zonaId` (fuente de verdad viva), NO de
   * `cierre_dia.destino_zona_id`, que es un snapshot del momento de la solicitud.
   */
  async findZonasConMensajeroBloqueado(): Promise<Set<string>> {
    const rows = await this.prisma.usuario.findMany({
      where: {
        rol: { value: "mensajero" },
        zonaId: { not: null },
        cierresRealizados: { some: { estado: { in: ESTADOS_CIERRE_BLOQUEAN_GESTION } } },
      },
      select: { zonaId: true },
      distinct: ["zonaId"],
    });
    return new Set(rows.map((r) => r.zonaId).filter((id): id is string => id !== null));
  }

  /**
   * `bloqueada` = SOLO la causa (ii): su propio CierreBodega hacia la central en `solicitado`. Es
   * el cierre de la BODEGA, no el de un mensajero, y nadie lo ha tocado.
   *
   * La causa (i) —«algun mensajero de la zona tiene un cierre abierto»— SIGUE RETIRADA, y la
   * feature 241 la deja retirada A PROPOSITO, no por inercia: es la regla 2 (recibir asignaciones
   * no se bloquea nunca) y ademas era la mas desproporcionada de todas, porque congelaba la bodega
   * ENTERA —companeros sin ningun cierre incluidos— por el cierre de una sola persona
   * (investigacion 241 §5).
   *
   * Los campos informativos (`porMensajeros`/`cierresAbiertos`/`totalMensajeros`/
   * `mensajerosConCierreIds`) se calculan con `findMensajerosConCierreAbierto` — los TRES estados
   * abiertos, `solicitado` incluido— y NO con el predicado de bloqueo. Son dos preguntas distintas:
   * el aviso de la UI dice «tienes N cierres abiertos de tus mensajeros» y eso debe seguir contando
   * los `solicitado`, que son abiertos aunque no bloqueen nada.
   *
   * OJO al nombre heredado: `cierresAbiertos` NO cuenta cierres, cuenta MENSAJEROS con alguno.
   */
  async existeBodegaSateliteBloqueada(zonaId: string): Promise<BodegaBloqueoResult> {
    const [mensajerosZona, countCierreBodega] = await Promise.all([
      // Mensajeros de la zona (universo del que basta 1 bloqueado para bloquear).
      this.prisma.usuario.findMany({
        where: { rol: { value: "mensajero" }, zonaId },
        select: { id: true },
      }),
      // (ii) mismo criterio que la guardia de unicidad de la feature 40 (indice unico
      // parcial WHERE estado='solicitado'): a lo sumo uno por zona.
      this.prisma.cierreBodega.count({
        where: { zonaId, estado: ESTADO_CIERRE_BODEGA_PENDIENTE },
      }),
    ]);
    const idsZona = mensajerosZona.map((m) => m.id);
    const conCierreAbierto = await this.findMensajerosConCierreAbierto(idsZona);
    const totalMensajeros = idsZona.length;
    const cierresAbiertos = conCierreAbierto.size;
    const porCierreBodega = countCierreBodega > 0;
    const porMensajeros = cierresAbiertos > 0;
    return {
      // Feature 241: la causa (i) NO entra. `porMensajeros` viaja al borde como AVISO, no como
      // veto: la pantalla puede decir cuantos cierres hay abiertos y seguir dejando asignar.
      bloqueada: porCierreBodega,
      porMensajeros,
      porCierreBodega,
      cierresAbiertos,
      totalMensajeros,
      mensajerosConCierreIds: [...conCierreAbierto],
    };
  }

  // --- Feature 87/89 → 236: las DOS superficies de `/novedades`, una por grupo ---
  // (el rotulo decia «devoluciones del mensajero de la tienda» y llevaba un año listando dos cosas)

  /**
   * Feature 236 (T2.1, design §2.2 — R3/R4/R5/R9/R10): predicado CENTRAL de UNA superficie de
   * `/novedades`, ANCLADO AL ESTADO REAL y **parametrizado por el grupo**.
   *
   * QUE CAMBIO HOY, Y POR QUE. Hasta el 2026-08-19 este metodo era un `OR` de DOS igualdades de
   * estado —`devuelta` y `ayuda_tienda`— y devolvia las dos poblaciones MEZCLADAS: la orden sobre
   * la que un mensajero pedia ayuda salia bajo la pestaña «En devolucion», con un subtitulo que no
   * era cierto de ella y sin ninguna forma de leer el motivo. El `OR` no era un fallo de datos: era
   * una pantalla que no distinguia dos cosas que ya eran distintas AQUI. La 236 parte el predicado
   * en dos, y el corte nace en el SERVIDOR o no nace (R2): un corte de cliente deja la orden
   * alcanzable por las demas vias, que es la leccion que la 235 aprendio a la mala con su `useMemo`.
   *
   * R9 (ninguna orden en dos pestañas) SALE GRATIS y conviene decir por que: con dos predicados de
   * IGUALDAD SOBRE EL MISMO CAMPO, la disyuncion es excluyente POR EL TIPO DE DATO —una orden tiene
   * un `estatus_id` y solo uno—. Deja de ser una propiedad que sostener y pasa a ser una
   * consecuencia de que el discriminante sea el estado. El `OR` de ayer, en cambio, necesitaba un
   * comentario explicando que Prisma devolveria una sola vez a la orden que casara las dos ramas.
   *
   * R3/D1: es una IGUALDAD CON EL ESTADO ACTUAL y NADA MAS. Ninguna clave hermana, ninguna marca
   * persistida. Las dos que hubo aqui costaron una ficha cada una: `orden.ayuda` dejaba la fila en
   * `/novedades` para siempre (el corte nocturno la barria sin apagar el flag, auditoria §2.1) y
   * `gestion_aprobada` borraba retroactivamente devoluciones vivas mientras su reloj corria
   * (239/R30). Las dos columnas estan retiradas, y las dos guardias que impiden su vuelta, vivas.
   *
   * R5: el value NO se escribe aqui. Sale de `ESTATUS_POR_GRUPO` (`lib/types/novedad-grupo.ts`),
   * que es TAMBIEN de donde la pantalla saca el juego de botones de cada fila (R6): asi lo que el
   * servidor lista y lo que la interfaz ofrece no pueden describir grupos distintos.
   *
   * ⚠️ EL NOMBRE DEL METODO NO CAMBIA, y es deliberado: la guardia
   * `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` lo localiza con
   * `/private\s+novedadWhere\s*\(/` y REVIENTA si no lo encuentra. Renombrarlo la pondria roja por
   * una razon que no es la suya. Lo que esa guardia SI vigila ahora es que este cuerpo no contenga
   * ningun literal de estatus: su unico origen admisible es el mapa (design §2.4).
   */
  private novedadWhere(tiendaId: string, grupo: GrupoNovedad): Prisma.OrdenWhereInput {
    return {
      tiendaId, // R10: acotada a la tienda del actor
      deletedAt: null, // R10: excluye borradas
      estatus: { value: ESTATUS_POR_GRUPO[grupo] },
    };
  }

  /**
   * Feature 235 (T2.2, R8/R9/R10/R13) — EL PUNTO UNICO DE ESCRITURA DE LAS DOS TRANSICIONES DE LA
   * AYUDA. Sustituye a los TRES metodos que vivian aqui hasta el 2026-08-19 y que escribian la
   * bandera `orden.ayuda` con un `update` ciego:
   *
   *   `marcarAyuda`      (encendedor, «Solicitar ayuda»)  ─┐
   *   `desmarcarAyuda`   (apagador 1, «Recuperar»)         ├─ colapsan AQUI
   *   `habilitarNovedad` (apagador 2, «Habilitar»)        ─┘
   *
   * QUE CAMBIA RESPECTO DE AQUELLO, y por que importa: eran `update` CIEGOS por `id`, sin guarda
   * de estado y sin rastro. Este es un `updateMany` GUARDADO POR EL ESTATUS DE ORIGEN, con su
   * append por el CHOKE POINT en la MISMA transaccion. La guarda va EN EL WHERE y no en un `if`
   * previo: si la orden ya no esta donde se creia —el corte la barrio, otra pestaña la movio— el
   * update afecta a 0 filas, NO se hace el append y no queda ningun efecto parcial (R9).
   *
   * DOS APAGADORES EN UNO (R8): el rescate lo llaman `SolicitudAyudaService.recuperar` (el
   * mensajero) y `HabilitarNovedadService.habilitar` (la tienda). Sus puertas son distintas —cada
   * una la ventana de su rol— pero la ESCRITURA es esta y solo esta. La guarda de estado vive
   * aqui, en el punto unico, y no en los llamadores: moverla a uno dejaria al otro sin ella.
   *
   * MONEY-SAFE (R13): el `data` toca UNICAMENTE `estatusId`. Ni montos, ni `prioridad`, ni
   * `mensajeroAsignadoId` (R6: pedir ayuda NO desasigna al mensajero — el paquete sigue con el).
   * Ningun movimiento de dinero, ninguna conversion a coma flotante.
   *
   * Sin autorizacion propia a proposito: la puerta la ponen los services, reusando la del hilo de
   * notas (feature 227). El repo solo ejecuta la query.
   *
   * @returns `true` si la orden transiciono (1 fila), `false` si no estaba en el origen esperado.
   */
  async transicionarAyuda(input: TransicionAyudaInput): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orden.updateMany({
        where: {
          id: input.ordenId,
          estatusId: input.estatusOrigenId, // LA GUARDA: origen exacto, no "cualquier estado"
          deletedAt: null,
        },
        // Money-safe (R13): SOLO el estatus.
        data: { estatusId: input.estatusDestinoId },
      });
      // R10: el append SOLO de lo que efectivamente transiciono. La guarda del WHERE garantiza
      // que el origen registrado es el REAL, no uno supuesto.
      if (result.count > 0) {
        await appendCambioEstado(tx, [
          {
            ordenId: input.ordenId,
            estatusOrigenId: input.estatusOrigenId,
            estatusDestinoId: input.estatusDestinoId,
            actorUsuarioId: input.actorUsuarioId, // el usuario que la provoco (R10)
            origenTipo: input.origenTipo, // `solicitud_ayuda_tienda` | `rescate_ayuda_tienda`
          },
        ]);
      }
      return result.count > 0;
    });
  }

  /**
   * Suma UNO al contador de intentos de contacto y devuelve el valor RESULTANTE.
   *
   * `{ increment: 1 }` y no un valor calculado en memoria: el incremento ocurre en la base, asi
   * que dos pulsaciones simultaneas dan dos y no una. `select` acotado a la columna para no
   * arrastrar la fila entera de vuelta por un numero.
   */
  async incrementarIntentoContacto(ordenId: string): Promise<number> {
    const fila = await this.prisma.orden.update({
      where: { id: ordenId },
      data: { intentosContacto: { increment: 1 } },
      select: { intentosContacto: true },
    });
    return fila.intentosContacto;
  }

  /**
   * Feature 236 (T2.2, R4): cuenta las NOVEDADES del `grupo` en `tiendaId`. Mismo predicado
   * central que `findNovedadesByTienda` —los dos llaman a `this.novedadWhere(tiendaId, grupo)` con
   * el MISMO grupo recibido—, asi que el total y la pagina cuentan el mismo universo POR
   * CONSTRUCCION y no por una comprobacion que alguien deba recordar.
   *
   * El nombre viejo era `countDevueltasByTienda`, decia «devueltas» y llevaba un año contando dos
   * poblaciones. El rename ES la señal buscada: el typecheck señalo uno a uno los call-sites y
   * ninguno pudo quedarse llamando a la version de un solo grupo.
   */
  async countNovedadesByTienda(tiendaId: string, grupo: GrupoNovedad): Promise<number> {
    return this.prisma.orden.count({
      where: this.novedadWhere(tiendaId, grupo),
    });
  }

  /**
   * Feature 236 (T2.2, R4/R10): una PAGINA de NOVEDADES del `grupo` en `tiendaId`, con el MISMO
   * predicado central que `countNovedadesByTienda`. `orderBy` por `Orden.createdAt` desc es el
   * FALLBACK documentado; el orden real lo decide el service segun el grupo (la devolucion, por la
   * fecha de su ultima gestion vigente; la ayuda, por la fecha de la SOLICITUD — D7/R17). El
   * `select` proyecta lo que consume el DTO + `createdAt`.
   *
   * 2026-08-13 (pedido humano): el `select` se ancha para cubrir TODO `NovedadOrdenRow`, que
   * desde hoy espeja a `MiAsignacionRow` (`/novedades` pinta las mismas cards POS que el portal
   * del mensajero; ver la cabecera de `lib/types/novedad.ts`). Sigue siendo UNA sola query sobre
   * las MISMAS filas: lo que cambia son las columnas y los cuatro joins de catalogo, no el
   * universo. Los nombres se resuelven aqui (el DTO nunca ve IDs de catalogo) y los tres
   * decimales se convierten con `.toNumber()` —nunca `parseFloat`— para que ningun
   * `Prisma.Decimal` cruce al service ni al borde RSC.
   */
  async findNovedadesByTienda(
    tiendaId: string,
    grupo: GrupoNovedad,
    pagination: { skip: number; take: number },
  ): Promise<NovedadOrdenRow[]> {
    const rows = await this.prisma.orden.findMany({
      where: this.novedadWhere(tiendaId, grupo),
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        numGuia: true,
        numRemision: true,
        destinatario: true,
        telefonoDest: true,
        direccion: true,
        producto: true,
        peso: true,
        montoCobrar: true,
        latitud: true,
        longitud: true,
        notas: true,
        // Feature 235 (T6.1, R40): aqui se leia `ayuda`. La columna se retiro; la razon por la
        // que la fila esta aqui la dice `estatus.value`, que ya se lee unas lineas mas abajo.
        intentosContacto: true,
        createdAt: true,
        // Catalogos: se traen los NOMBRES, no los IDs (mismo molde que `WITH_ASIGNACION` en
        // `GestionOrdenRepository`). `distrito` es el unico opcional -> `?.nombre ?? null`.
        estatus: { select: { value: true } },
        tienda: { select: { nombre: true } },
        zona: { select: { nombre: true } },
        provincia: { select: { nombre: true } },
        canton: { select: { nombre: true } },
        distrito: { select: { nombre: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      numGuia: row.numGuia,
      numRemision: row.numRemision,
      estatusValue: row.estatus.value,
      destinatario: row.destinatario,
      telefonoDest: row.telefonoDest,
      direccion: row.direccion,
      producto: row.producto,
      // Decimal -> number|null con guarda de null. Una instancia `Decimal` es SIEMPRE truthy,
      // incluida la de valor 0, asi que un `0.00` NO se pierde: solo `null` cae a `null`.
      peso: row.peso ? row.peso.toNumber() : null,
      montoCobrar: row.montoCobrar ? row.montoCobrar.toNumber() : null,
      latitud: row.latitud ? row.latitud.toNumber() : null,
      longitud: row.longitud ? row.longitud.toNumber() : null,
      notas: row.notas,
      tiendaNombre: row.tienda.nombre,
      zonaNombre: row.zona.nombre,
      provinciaNombre: row.provincia.nombre,
      cantonNombre: row.canton.nombre,
      distritoNombre: row.distrito?.nombre ?? null,
      intentosContacto: row.intentosContacto,
      createdAt: row.createdAt,
    }));
  }

  /**
   * R6/R7/R8: causa de devolucion VIGENTE de TODAS las ordenes de la pagina en UNA sola
   * consulta agregada (sin N+1). Filtra `gestion_orden` por `resultado: "devuelta",
   * anuladaAt: null` (criterio de vigencia de la feature 67, aplicado como LECTURA), ordena
   * por `createdAt` desc y reduce a `Map<ordenId, { causa, fecha }>` quedandose con la fila
   * MAS RECIENTE por orden (la primera del desc). Las ordenes sin gestion vigente NO entran
   * al mapa -> causa ausente (R7). `[]` -> `Map` vacio (no dispara la query).
   */
  async findCausasDevueltaVigentes(
    ordenIds: string[],
  ): Promise<Map<string, CausaDevueltaVigente>> {
    if (ordenIds.length === 0) return new Map();
    const rows = await this.prisma.gestionOrden.findMany({
      where: { ordenId: { in: ordenIds }, resultado: RESULTADO_DEVUELTA, anuladaAt: null },
      orderBy: { createdAt: "desc" },
      select: { ordenId: true, causaDevolucion: true, createdAt: true },
    });
    const map = new Map<string, CausaDevueltaVigente>();
    for (const row of rows) {
      // Las filas vienen desc: la PRIMERA por `ordenId` es la mas reciente (R6). Las
      // posteriores (gestiones mas antiguas de la misma orden) se ignoran.
      if (!map.has(row.ordenId)) {
        map.set(row.ordenId, { causa: row.causaDevolucion, fecha: row.createdAt });
      }
    }
    return map;
  }

  /**
   * Feature 236 (T2.5, D7/R17): fecha de la SOLICITUD DE AYUDA viva de TODAS las ordenes de la
   * pagina, en UNA sola consulta agregada.
   *
   * POR QUE ESTA FECHA Y NO OTRA. La pregunta que la tienda se hace al abrir la pestaña de ayuda es
   * «¿cual lleva mas tiempo esperandome?», y NINGUNA otra fecha la responde: la de creacion de la
   * orden no tiene nada que ver con cuando se pidio ayuda, y la de la ultima gestion `devuelta`
   * —la que ordena la otra pestaña— habla de una devolucion anterior ya deshecha.
   *
   * DE DONDE SALE. Del historial de estado, por la FAMILIA DE ORIGEN de la ida
   * (`solicitud_ayuda_tienda`, feature 235/P2). Se toma la MAS RECIENTE por orden: una orden puede
   * haber sido rescatada y vuelta a pedir, y lo que cuenta es la espera VIVA, no la primera de su
   * historia. Las ordenes sin ninguna transicion de esa familia NO entran al mapa — el service cae
   * a `Orden.createdAt` como fallback documentado.
   *
   * MISMO MOLDE Y MISMO COSTE que `findCausasDevueltaVigentes`: UNA consulta por pagina, NUNCA una
   * por fila (el N+1 que el contrato de `lib/types/novedad.ts` prohibe). `[]` -> `Map` vacio sin
   * disparar la query. El acceso usa `orden_historial_actor_origen_created_idx` solo parcialmente
   * (no lidera por `orden_id`): con paginas de 10 filas el coste es despreciable, y si la medicion
   * del despliegue lo desmintiera el arreglo es un indice, no un rediseño (design §1.2).
   */
  async findFechaSolicitudAyuda(ordenIds: string[]): Promise<Map<string, Date>> {
    if (ordenIds.length === 0) return new Map();
    const rows = await this.prisma.ordenHistorialEstado.findMany({
      where: { ordenId: { in: ordenIds }, origenTipo: ORIGEN_TIPO_SOLICITUD_AYUDA },
      orderBy: { createdAt: "desc" },
      select: { ordenId: true, createdAt: true },
    });
    const map = new Map<string, Date>();
    for (const row of rows) {
      // Vienen desc: la PRIMERA por `ordenId` es la solicitud VIVA. Las anteriores son ciclos de
      // ayuda ya cerrados con su rescate, y no describen la espera de hoy.
      if (!map.has(row.ordenId)) map.set(row.ordenId, row.createdAt);
    }
    return map;
  }

  // --- Feature 102: rechazos por SLA de la tienda (superficie derivada de solo-lectura) ---

  /**
   * Feature 102/R12-R15: predicado CENTRAL de un RECHAZO POR SLA, ANCLADO AL ESTADO REAL.
   * Extraido para que `count` y `find` compartan EXACTAMENTE el mismo `where` (R15: total y pagina
   * sobre el mismo universo). Una orden entra si: es de la tienda del actor (R13), no esta borrada
   * (R15), su estatus ACTUAL es `rechazada` Y tiene AL MENOS una transicion del cron SLA en su
   * historial (`origen_tipo = escalado_devuelta_sla`, feature 99). Un rechazo MANUAL del mensajero
   * (sin esa transicion) NO entra. Al salir de `rechazada` o al borrarse, deja de casar (R15).
   */
  private rechazoSlaWhere(tiendaId: string): Prisma.OrdenWhereInput {
    return {
      tiendaId, // R13: acotada a la tienda del actor
      deletedAt: null, // R15: excluye borradas
      estatus: { value: ESTATUS_RECHAZADA }, // R12/R15: solo mientras REPOSE en `rechazada`
      historialEstados: { some: { origenTipo: ORIGEN_TIPO_RECHAZO_SLA } }, // R12: alcanzada por el cron SLA
    };
  }

  /** Feature 102/R12/R13/R15: cuenta los rechazos por SLA de `tiendaId` (mismo `where` que find). */
  async countRechazadasSlaByTienda(tiendaId: string): Promise<number> {
    return this.prisma.orden.count({ where: this.rechazoSlaWhere(tiendaId) });
  }

  /**
   * Feature 102/R12/R14/R15: una PAGINA de rechazos por SLA de `tiendaId` con el MISMO predicado
   * que `countRechazadasSlaByTienda` (R15), ordenada por `Orden.createdAt` desc. El `monto` sale de
   * la gestion sintetica SLA (la enlazada por la transicion `origen_tipo = escalado_devuelta_sla`),
   * traida en el MISMO query via la relacion `historialEstados` acotada -> sin N+1. Money-safe:
   * `ingreso_bodega_rechazo` (Decimal) -> STRING escala 2, o `null` si aun sin snapshot (Q2).
   */
  async findRechazadasSlaByTienda(
    tiendaId: string,
    pagination: { skip: number; take: number },
  ): Promise<RechazoSlaTiendaRow[]> {
    const rows = await this.prisma.orden.findMany({
      where: this.rechazoSlaWhere(tiendaId),
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        numGuia: true,
        numRemision: true,
        destinatario: true,
        // La transicion del cron SLA enlaza la gestion sintetica que porta el monto de 56. Se
        // acota al origen SLA y a la mas reciente (defensivo: una orden tiene a lo sumo una).
        historialEstados: {
          where: { origenTipo: ORIGEN_TIPO_RECHAZO_SLA },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { gestion: { select: { ingresoBodegaRechazo: true } } },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      numGuia: r.numGuia,
      numRemision: r.numRemision,
      destinatario: r.destinatario,
      // Money-safe: el snapshot de 56 (Decimal) -> STRING escala 2; `null` = pendiente de cierre.
      monto: decimalOrNullToString(r.historialEstados[0]?.gestion?.ingresoBodegaRechazo ?? null),
    }));
  }
}

// BORRADO 2026-08-07 (tanda 2 del chore de deuda de superficie): aqui vivia `mapCreateError`,
// que traducia el P2002 de `num_remision` a `NumRemisionDuplicadoError`. Su unico llamador era
// `create` (alta individual). La via VIVA no lo necesita: la carga masiva detecta los
// duplicados ANTES de insertar, con `findExistingRemisiones`, y ademas inserta con
// `skipDuplicates`, asi que nunca provoca el P2002.
