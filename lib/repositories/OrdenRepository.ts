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
  NumRemisionDuplicadoError,
  type DeshacerAsignacionItem,
  type CantonRow,
  type CreateOrdenData,
  type CreateOrdenConGuiaResultRow,
  type CreateOrdenOpciones,
  type DistritoRow,
  type EtiquetaRow,
  type GenerarGuiaDecisionData,
  type GenerarGuiaResultRow,
  type GeoExistence,
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
import { ORIGEN_TIPO_RECHAZO_SLA } from "@/lib/utils/rechazo-sla-flag";
import type { OrdenAsignabilidadRow } from "@/lib/interfaces/services/IAsignabilidadCoordenadasService";
import type { ParadaRutaRow } from "@/lib/interfaces/repositories/IOrdenRepository";

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

/** Feature 92: unico estatus cuyas ordenes son paradas de la ruta de un mensajero. */
const ESTATUS_EN_REPARTO = "en_reparto";

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
  | "carga" // feature 141: lote de carga masiva asegurado en la tx de la insercion batch
  | "$transaction" // feature 17: generarGuiaLote necesita transaccion (R25)
  | "$executeRaw" // feature 41/R23: anti-TOCTOU (NOT EXISTS cierre bloqueante en el lote)
  | "$queryRaw" // feature 91: lo exige `JobRepository` (encolado outbox de geocodificacion)
>;

// Feature 41 (R12/R16/R17) + feature 109 (R29, modelo GLOBAL): estados de cierre ABIERTOS que
// BLOQUEAN al mensajero. Solo `aprobado` es TERMINAL (dinero conciliado); `rechazado` deja de ser
// terminal por LOGICA (109) — ahora BLOQUEA y es RE-SOLICITABLE (`rechazado -> solicitado`), igual
// que `vencido`. Fuente de verdad en lib/types/cierre.ts.
const ESTADOS_CIERRE_BLOQUEANTES: CierreEstado[] = ["solicitado", "vencido", "rechazado"];
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

// Feature 99 (Q7): `order_status.value` en el que REPOSA una devolucion diferida. El predicado
// de /novedades se ancla a este estado real (no a la gestion vigente).
const ESTATUS_DEVUELTA = "devuelta";

// Feature 102 (T7): `order_status.value` de una orden rechazada. La superficie de rechazos por
// SLA de la tienda se ancla a este estado real (mientras la orden REPOSE en `rechazada`, R15).
const ESTATUS_RECHAZADA = "rechazada";

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
// GAM/no-GAM en `origen`/`destino`, design.md §4). NO selecciona producto,
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

  async create(
    data: CreateOrdenData,
    historial: HistorialContexto,
    opciones: CreateOrdenOpciones = {},
  ): Promise<OrdenDTO> {
    try {
      // Feature 49/#2 (R7/R10): create + append del historial en la MISMA transaccion.
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.orden.create({
          data: {
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
          },
          ...WITH_ESTATUS,
        });
        // Feature 155/R3/R8/R12 — numeracion OPCIONAL en la MISMA tx que la creacion. Va
        // ANTES del historial para que la orden ya este numerada cuando se registre su
        // nacimiento. Idempotente por la guarda `num_guia IS NULL` (R8), misma secuencia
        // atomica que el resto del sistema (`NUM_GUIA_GENERATOR`), y todo-o-nada con el
        // resto de la tx (R12): si el historial o el encolado fallan, la guia se revierte
        // con ellos y el numero no se pierde.
        let numGuia = row.numGuia;
        if (opciones.conGuia === true) {
          await tx.$executeRawUnsafe(
            `UPDATE "orden" SET num_guia = ${NUM_GUIA_GENERATOR} WHERE id = $1 AND num_guia IS NULL`,
            row.id,
          );
          // Relectura DEFENSIVA (patron `createManyOrdenesConGuia`): nunca un `as number`
          // sobre un valor que no se ha visto.
          const numerada = await tx.orden.findUniqueOrThrow({
            where: { id: row.id },
            select: { numGuia: true },
          });
          if (numerada.numGuia === null) {
            throw new Error(`num_guia no asignado para la orden ${row.id}`);
          }
          numGuia = numerada.numGuia;
        }
        // R10/R20: la creacion es la transicion `vacio -> estado inicial`.
        await appendCambioEstado(tx, [
          {
            ordenId: row.id,
            estatusOrigenId: null, // creacion (R1/R20)
            estatusDestinoId: data.estatusId,
            actorUsuarioId: historial.actorUsuarioId,
            origenTipo: historial.origenTipo, // creacion_manual
          },
        ]);
        // Feature 91 (R6/R7): encolado outbox DENTRO de esta misma tx. Si el create o el
        // append revierten, el job se va con ellos. No-op si la direccion no es
        // geocodificable (R9).
        await encolarGeocodificacion(this.jobRepo, tx as unknown as JobTxClient, {
          id: row.id,
          direccion: row.direccion,
        });
        // El DTO refleja el estado FINAL de la fila dentro de la tx: si se numero aqui, el
        // llamador ve el `num_guia` (el `row` del create es previo al UPDATE).
        return toDTO({ ...row, numGuia });
      });
    } catch (error) {
      throw mapCreateError(error, data.numRemision);
    }
  }

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

  async softDelete(id: string): Promise<boolean> {
    const result = await this.prisma.orden.updateMany({
      where: { id, deletedAt: null }, // R40: solo si no estaba ya borrada
      data: { deletedAt: new Date() }, // R39
    });
    return result.count > 0;
  }

  async existsEstatus(estatusId: string): Promise<boolean> {
    const found = await this.prisma.orderStatus.findUnique({ where: { id: estatusId } });
    return found !== null;
  }

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

  async existsGeo(input: {
    zonaId: string;
    provinciaId: string;
    cantonId: string;
    distritoId?: string | null;
  }): Promise<GeoExistence> {
    const [zona, provincia, canton, distrito] = await Promise.all([
      this.prisma.zona.findUnique({ where: { id: input.zonaId } }),
      this.prisma.provincia.findUnique({ where: { id: input.provinciaId } }),
      this.prisma.canton.findUnique({ where: { id: input.cantonId } }),
      input.distritoId
        ? this.prisma.distrito.findUnique({ where: { id: input.distritoId } })
        : Promise.resolve(true),
    ]);
    return {
      zona: zona !== null,
      provincia: provincia !== null,
      canton: canton !== null,
      distrito: distrito !== null,
    };
  }

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
   */
  async listByOwner(params: {
    ownerId: string;
    estatusId?: string;
    skip: number;
    take: number;
  }): Promise<ApiOrdenListResult> {
    const where: Prisma.OrdenWhereInput = {
      tiendaId: params.ownerId, // R6/R7: owner FORZADO
      deletedAt: null, // R11
      ...(params.estatusId ? { estatusId: params.estatusId } : {}),
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
      select: {
        ...API_ORDEN_SELECT,
        gestiones: {
          where: {
            resultado: { in: ["entregada", "rechazada"] }, // R15: solo entrega/rechazo
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
      },
    });
    if (!row) return null;
    return {
      ...toApiOrdenRow(row),
      evidencias: row.gestiones.map((g) => ({
        // `resultado` esta acotado por el WHERE a estos dos valores.
        resultado: g.resultado as "entregada" | "rechazada",
        // El WHERE exige `evidencia_storage_path` no nulo; el `!` es seguro.
        storagePath: g.evidenciaStoragePath!,
        contentType: g.evidenciaContentType,
      })),
    };
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
            ...(d.mensajeroAsignadoId != null ? { asignadoAt: new Date() } : {}),
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
        data: { mensajeroAsignadoId: mensajeroId, estatusId, asignadoAt: new Date(), prioridad: false },
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
   * Feature 157 (R3/R4/R5/R38): fija SOLO el mensajero que ira a recolectar a la tienda.
   *
   * Es la unica asignacion del repo que NO transiciona, y por eso no se parece a
   * `asignarBodegaLote` aunque comparta el nombre de familia:
   * - **Sin `appendCambioEstado`.** No hay cambio de estado que registrar, y el choke point
   *   de la feature 140 valida contra `TRANSICIONES`: una auto-arista
   *   `por_recolectar_en_tienda -> por_recolectar_en_tienda` NO existe en el mapa y haria
   *   lanzar `TransicionIlegalError`. Registrarla seria falsificar el historial (design Q3).
   * - **Sin `asignadoAt`** (R38): esa columna es el denominador del ranking
   *   (`RankingRepository.contarAsignadasPorMensajero`) y el numerador solo cuenta entregas,
   *   asi que estamparla aqui bajaria el porcentaje del mensajero sin poder subirlo jamas.
   *   Cuando la orden llegue a la central y se asigne para repartir, `asignarBodegaLote` la
   *   estampa en el instante correcto y el ranking la cuenta una sola vez.
   * - **Sin `prioridad: false`** (a diferencia de `asignarBodegaLote`, que la apaga): una
   *   recoleccion no participa del ciclo de reasignacion prioritaria de la feature 101.
   *
   * La guarda del `WHERE` (estado de origen + no borrada) es la defensa REAL —la validacion
   * del service solo sirve para reportar mejor, mismo criterio que `recibirEnBodegaCentral`—.
   * Si no alcanza a TODAS las ordenes pedidas, lanza para que la tx revierta: todo-o-nada (R5).
   */
  async asignarRecoleccionLote(
    ordenIds: string[],
    mensajeroId: string,
    origenValue: string,
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.orden.updateMany({
        where: {
          id: { in: ordenIds },
          deletedAt: null,
          estatus: { value: origenValue },
        },
        data: { mensajeroAsignadoId: mensajeroId },
      });
      if (result.count !== ordenIds.length) {
        throw new Error(
          `asignarRecoleccionLote: ${result.count} de ${ordenIds.length} ordenes elegibles`,
        );
      }
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
          data: { estatusId, mensajeroAsignadoId: null, asignadoAt: null },
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
   * Feature 33/R11/R18: transiciona UNA orden a `en_bodega_satelite` SOLO si sigue
   * en `en_ruta_bodega_satelite`, es de `zonaId` y no esta borrada (guardia por
   * estado de origen + zona en el propio UPDATE; concurrencia-segura). Devuelve
   * `true` si afecto 1 fila. NO toca `mensajeroAsignadoId` ni `numGuia`.
   */
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
  ): Promise<number> {
    if (ordenIds.length === 0) return 0;
    // Feature 41/R23 (anti-TOCTOU): la guardia de bloqueo del mensajero va en el MISMO
    // UPDATE via `NOT EXISTS` sobre cierre_dia (estado solicitado/vencido). Si un cierre
    // bloqueante aparece entre el pre-check del service y esta escritura, el NOT EXISTS es
    // falso -> 0 filas transicionadas -> el service detecta count != lote -> conflict SIN
    // efectos parciales. El resto de la guardia (estado de origen + zona + no borrada) se
    // conserva igual (patron `recibirEnSatelite`). NO toca num_guia (R8). `updated_at` se
    // fija a mano (raw no dispara el @updatedAt de Prisma).
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
            "estatus_id" = ${destinoEstatusId},
            "prioridad" = false,
            "updated_at" = NOW()
        WHERE "id" IN (${Prisma.join(ordenIds)})
          AND "estatus_id" = ${origenEstatusId}
          AND "zona_id" = ${zonaId}
          AND "deleted_at" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "cierre_dia" c
            WHERE c."mensajero_id" = ${mensajeroId}
              AND c."estado" IN ('solicitado', 'vencido', 'rechazado')
          )
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
        const rows = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "orden"
          SET "estatus_id" = ${item.destinoEstatusId},
              "mensajero_asignado_id" = NULL,
              "asignado_at" = NULL,
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

  // --- Feature 41: bloqueo derivado en asignacion (R12/R16/R17) ---

  /** R12/R16: de `ids`, los mensajeros con un cierre_dia en `solicitado`/`vencido`. */
  async findMensajerosBloqueados(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.prisma.cierreDia.findMany({
      where: { mensajeroId: { in: ids }, estado: { in: ESTADOS_CIERRE_BLOQUEANTES } },
      select: { mensajeroId: true },
      distinct: ["mensajeroId"], // usa el indice (mensajero_id, estado)
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
   * Zonas (central y satelite) con AL MENOS 1 mensajero con un cierre abierto
   * (`solicitado`/`vencido`) — misma regla y mismos estados que la causa (i) de
   * `existeBodegaSateliteBloqueada`, para que el gate de lectura de la UI y la guarda de
   * escritura del servidor no diverjan.
   * Una consulta agregada (sin N+1 por zona): pide los mensajeros CON zona que tengan
   * algun cierre bloqueante y devuelve sus zonas distintas. La pertenencia a la zona se
   * lee de `usuario.zonaId` (fuente de verdad viva), NO de `cierre_dia.destino_zona_id`,
   * que es un snapshot del momento de la solicitud.
   */
  async findZonasConMensajeroBloqueado(): Promise<Set<string>> {
    const rows = await this.prisma.usuario.findMany({
      where: {
        rol: { value: "mensajero" },
        zonaId: { not: null },
        cierresRealizados: { some: { estado: { in: ESTADOS_CIERRE_BLOQUEANTES } } },
      },
      select: { zonaId: true },
      distinct: ["zonaId"],
    });
    return new Set(rows.map((r) => r.zonaId).filter((id): id is string => id !== null));
  }

  /**
   * `bloqueada = (i) || (ii)`. (ii) su propio CierreBodega hacia la central en
   * `solicitado` = bloqueo duro. (i) causa de mensajeros: la bodega queda bloqueada si
   * AL MENOS 1 de sus mensajeros tiene un cierre abierto (`solicitado`/`vencido`).
   * Mientras hay un cierre pendiente la bodega esta cuadrando caja: no se le envian
   * ordenes nuevas hasta resolverlo. Una zona SIN mensajeros no bloquea por (i) (no hay
   * cierre alguno que resolver).
   * Se reutiliza `findMensajerosBloqueados` (mismo criterio que la guarda por-mensajero
   * de la asignacion, R14), de modo que el set de bloqueados coincide exactamente con
   * los mensajeros que el servidor rechazaria al asignar. Los campos informativos
   * (`cierresAbiertos`/`totalMensajeros`/`mensajerosConCierreIds`) alimentan el detalle
   * del aviso y el deshabilitado por-mensajero en el selector.
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
    const bloqueadosSet = await this.findMensajerosBloqueados(idsZona);
    const totalMensajeros = idsZona.length;
    const cierresAbiertos = bloqueadosSet.size;
    const porCierreBodega = countCierreBodega > 0;
    // (i) bloqueo duro si AL MENOS 1 mensajero de la zona tiene un cierre abierto.
    // Con 0 mensajeros, `cierresAbiertos` es 0 y no bloquea por esta causa.
    const porMensajeros = cierresAbiertos > 0;
    return {
      bloqueada: porMensajeros || porCierreBodega,
      porMensajeros,
      porCierreBodega,
      cierresAbiertos,
      totalMensajeros,
      mensajerosConCierreIds: [...bloqueadosSet],
    };
  }

  // --- Feature 87/89: lista de novedades (devoluciones del mensajero de la tienda) ---

  /**
   * Feature 99/R7-R9 (Q7): predicado CENTRAL de una NOVEDAD, ANCLADO AL ESTADO REAL. Extraido
   * para que `count` y `find` usen EXACTAMENTE el mismo `where` (R8: total y pagina cuentan el
   * mismo universo). Una orden es novedad si: es de la tienda del actor (R9), no esta borrada
   * (R5) y su estatus ACTUAL ES `devuelta` (R7). Bajo la feature 99 la orden REPOSA en `devuelta`
   * hasta que el cron SLA la libere/escale o la feature 100 la resuelva; al salir de `devuelta`
   * cae del predicado sin doble conteo (R8). Reemplaza el predicado anterior por gestion vigente
   * + estatus abierto (feature 89): ya no hace falta, el estado real es la fuente unica.
   */
  private novedadWhere(tiendaId: string): Prisma.OrdenWhereInput {
    return {
      tiendaId,
      deletedAt: null, // R5: excluye borradas
      estatus: { value: ESTATUS_DEVUELTA }, // R7: solo mientras REPOSE en `devuelta`
    };
  }

  /** Feature 99/R7/R8: cuenta las NOVEDADES de `tiendaId` (predicado central, mismo `where` que find). */
  async countDevueltasByTienda(tiendaId: string): Promise<number> {
    return this.prisma.orden.count({
      where: this.novedadWhere(tiendaId),
    });
  }

  /**
   * Feature 99/R7/R8/R9: una PAGINA de NOVEDADES de `tiendaId` con el MISMO predicado central
   * que `countDevueltasByTienda` (R8), ordenada por `Orden.createdAt` desc (fallback documentado;
   * el service reordena por la fecha de la ultima gestion `devuelta` vigente, R9). Select minimo:
   * solo lo que consume el DTO + `createdAt`.
   */
  async findDevueltasByTienda(
    tiendaId: string,
    pagination: { skip: number; take: number },
  ): Promise<NovedadOrdenRow[]> {
    const rows = await this.prisma.orden.findMany({
      where: this.novedadWhere(tiendaId),
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        numGuia: true,
        destinatario: true,
        telefonoDest: true,
        createdAt: true,
      },
    });
    return rows;
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

/** R28/R14: traduce la violacion de unicidad de num_remision a error de dominio. */
function mapCreateError(error: unknown, numRemision: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? (error.meta.target as string[]) : [];
    if (target.some((t) => t.includes("num_remision") || t.includes("numRemision"))) {
      return new NumRemisionDuplicadoError(numRemision);
    }
    // Cualquier otra unicidad se traduce igual a conflicto de num_remision por ser
    // el unico campo unico que el usuario provee.
    return new NumRemisionDuplicadoError(numRemision);
  }
  return error;
}
