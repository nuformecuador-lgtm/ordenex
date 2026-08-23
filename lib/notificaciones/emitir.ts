// Feature 146 (design §4) — EMISOR CENTRAL de notificaciones: una funcion por evento de D1.
// Ubicacion UNICA de los textos (§4.6) y de la guardia de dedupe (§1.4): ningun componente,
// service ni route handler compone una descripcion. Si una cadena de notificacion aparece
// fuera de este archivo, es un bug.
import type { PrismaClient } from "@prisma/client";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionDestinatario,
  NotificacionTxClient,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import { NotificacionRepository } from "@/lib/repositories/NotificacionRepository";
import type { OrderStatusValue } from "@/lib/types/order-status";
// Feature 262 (B19, R18/R47): la fecha del aviso se pone en palabras con la MISMA funcion que la
// asignacion y el portal del mensajero. Lo que se importa es la CONVERSION de fecha, no otro
// literal: las cadenas de notificacion siguen viviendo solo en este archivo (146 §4.6). Y
// `fechaLegible` es pura — no importa `Date` ni `Intl`.
import { fechaLegible } from "@/lib/utils/dia-reparto-textos";

/**
 * Cliente transaccional que el emisor del rechazo necesita: las dos tablas de la feature +
 * `orden` (para resolver la tienda dueña y la zona DENTRO de la misma tx, F1.4-3).
 */
export type NotificacionEmisorTx = NotificacionTxClient & Pick<PrismaClient, "orden">;

/**
 * Firma del emisor inyectable que `appendCambioEstado` invoca tras el append (design §4.1),
 * mismo patron que `WebhookEmisor` de la feature 99. Recibe el catalogo YA resuelto por la
 * guardia de transiciones para no volver a consultarlo.
 */
export type NotificacionEmisor = (
  tx: NotificacionEmisorTx,
  entradas: CambioEstadoEntrada[],
  valuePorEstatusId: ReadonlyMap<string, OrderStatusValue>,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Textos (design §4.6). NUNCA direccion, telefono ni monto.
// ---------------------------------------------------------------------------

export const TEXTO_ORDEN_RECHAZADA = "Una orden fue rechazada por el destinatario.";
export const TEXTO_POSTULACION_PENDIENTE =
  "Una postulación de mensajero está pendiente de aprobación.";
export const TEXTO_CIERRE_POR_APROBAR = "Un mensajero envió su cierre del día para aprobación.";
/**
 * Feature 253 (D6). El texto NO nombra a la persona, ni su teléfono, ni su correo, ni una palabra
 * de su mensaje (R19): quién es y qué ofrece se lee en el panel, que es donde la autorización por
 * rol vive. El aviso solo dice que hay algo que atender.
 */
export const TEXTO_POSTULACION_RECURSO_PENDIENTE =
  "Alguien ofreció un vehículo o una bodega desde la web.";
export function textoCargaMasivaTerminada(creadas: number): string {
  return `Carga masiva terminada: ${creadas} ${creadas === 1 ? "orden cargada" : "órdenes cargadas"}.`;
}
/**
 * Feature 262 (D7, R47) — el aviso al mensajero cuando le corrigen el día de una orden suya.
 *
 * ⚠️ NOMBRA LA FECHA, NUNCA «hoy» NI «mañana», y es la mitad del requisito. Un aviso que dijera
 * «pasó a hoy» y se leyera a la mañana siguiente sería FALSO — y la campana guarda 30 días
 * (`VENTANA_DIAS`). Es el mismo argumento con el que la 261 puso la fecha en
 * `avisoReservaParaOtroDia`: «si el texto dijera mañana, la app mentiría».
 *
 * UN SOLO TEXTO PARA LOS DOS SENTIDOS (R55). «Pasó al reparto del X» es cierto tanto si el día se
 * adelantó como si se retrasó, y evita que el emisor tenga que decidir cuál es cuál. El mensajero
 * compara con lo que ya sabe; la app no le explica su propia agenda.
 *
 * SIN el motivo escrito por quien corrigió (R48/A24): es texto libre de 10 a 300 caracteres escrito
 * por un humano y puede contener cualquier cosa, incluido un teléfono o un nombre. El motivo se lee
 * en el historial de la orden, que sí autoriza por orden.
 */
export function textoDiaRepartoCorregido(fechaNuevaISO: string): string {
  const fecha = fechaLegible(fechaNuevaISO);
  return fecha
    ? `Una orden tuya pasó al reparto del ${fecha}.`
    : "Una orden tuya cambió de día de reparto.";
}

/** Roles que aprueban postulaciones y cierres (espejo de ROLES_APROBADORES, F1.4-2). */
const ROLES_ADMINISTRACION: NotificacionDestinatario[] = [
  { tipo: "rol", rol: "maestro" },
  { tipo: "rol", rol: "admin" },
];

/**
 * Aplica la guardia de dedupe (R27) y crea. "Ya existe una NO LEIDA para el mismo
 * (evento, entidad, destinatario)" -> no-op. El `crear` del repositorio ademas absorbe la
 * violacion del indice unico, que es la red ante la carrera que la guardia no puede ver.
 *
 * Devuelve cuantas filas se crearon realmente (insumo de los tests de dedupe).
 */
async function emitirFilas(
  repo: INotificacionRepository,
  filas: CrearNotificacionInput[],
  tx?: NotificacionTxClient,
): Promise<number> {
  let creadas = 0;
  for (const fila of filas) {
    if (fila.entidadId !== null) {
      const yaHay = await repo.existeNoLeidaPara(
        fila.evento,
        fila.entidadId,
        fila.destinatario,
        tx,
      );
      if (yaHay) continue;
    }
    if (await repo.crear(fila, tx)) creadas += 1;
  }
  return creadas;
}

// ---------------------------------------------------------------------------
// §4.1 — Orden rechazada por el destinatario (R18-R21). TRANSACCIONAL.
// ---------------------------------------------------------------------------

/** Datos de la orden que el aviso de rechazo necesita para su alcance y su anexo. */
export interface OrdenRechazadaContexto {
  ordenId: string;
  tiendaId: string;
  zonaId: string | null;
  numGuia: number | null;
  numRemision: string;
}

/**
 * R18: CUATRO filas por rechazo — `maestro` y `admin` sin alcance, `adminTienda` acotada a la
 * tienda dueña de la orden y `adminSatelite` acotada a la zona de la orden. Si la zona no se
 * resuelve, esa cuarta fila NO se emite y las otras tres si: una fila con `zona_id` inventado
 * seria peor que un aviso menos.
 *
 * El anexo es la guia si existe y el numero de remision si no (§4.6): identifica la orden sin
 * exponer destinatario, direccion ni monto.
 */
export async function emitirOrdenRechazada(
  repo: INotificacionRepository,
  orden: OrdenRechazadaContexto,
  tx?: NotificacionTxClient,
): Promise<number> {
  const anexo = orden.numGuia !== null ? String(orden.numGuia) : orden.numRemision;
  const destinatarios: NotificacionDestinatario[] = [
    { tipo: "rol", rol: "maestro" },
    { tipo: "rol", rol: "admin" },
    { tipo: "rol", rol: "adminTienda", tiendaId: orden.tiendaId },
  ];
  if (orden.zonaId !== null) {
    destinatarios.push({ tipo: "rol", rol: "adminSatelite", zonaId: orden.zonaId });
  }
  return emitirFilas(
    repo,
    destinatarios.map((destinatario) => ({
      tipo: "alert" as const,
      evento: "orden_rechazada" as const,
      descripcion: TEXTO_ORDEN_RECHAZADA,
      anexo,
      entidadTipo: "orden" as const,
      entidadId: orden.ordenId,
      destinatario,
    })),
    tx,
  );
}

/** Estado destino y familia de origen que identifican el rechazo DEL DESTINATARIO (R18/R19). */
const DESTINO_RECHAZO: OrderStatusValue = "rechazada";
const ORIGEN_RECHAZO_DEL_DESTINATARIO = "gestion";

// ⚠️ FEATURE 237 (D4, firmada el 2026-08-20) — `gestion_tienda_ayuda` QUEDA FUERA A PROPOSITO, y
// esto se escribe aqui para que la AUSENCIA sea una DECISION y no un olvido.
//
// Desde la 237 la TIENDA puede rechazar una orden desde su pestaña de ayuda. Esa transicion
// tambien aterriza en `rechazada`, pero con `origen_tipo = gestion_tienda_ayuda`, asi que la
// igualdad de arriba NO la alcanza y el aviso NO se emite.
//
// POR QUE NO SE AMPLIA EL FILTRO: el texto del aviso es «Una orden fue rechazada POR EL
// DESTINATARIO», y aqui eso seria FALSO — rechazo la tienda, sobre un paquete que el destinatario
// no llego a ver. Este repo tiene escrito lo que cuesta un dato que miente con formato de dato
// (236/D3, la columna «Sin causa registrada»). Y el aviso no es el mecanismo de nada: el paquete
// llega igual a `por_devolver`/`por_devolver_a_tienda` al aprobar el cierre (139), que es donde
// bodega lo ve.
//
// LO QUE SE PIERDE, DECLARADO: los admins no reciben el aviso anticipado de que viene un rechazo de
// esta clase. Si el humano lo quiere, hace falta un TEXTO PROPIO y es otra decision — no ensanchar
// esta igualdad. Afirmado en `tests/unit/services/gestion-desde-ayuda-cierre-aprobacion.test.ts`.
//
// ⚠️ FEATURE 240 (R45) — `rechazo_tienda` QUEDA FUERA POR LA MISMA RAZON, y se escribe aparte
// porque es un caso distinto que llega al mismo sitio.
//
// Desde la 240 la tienda puede rechazar a mano una devolucion ya anclada (`devuelta -> rechazada`,
// familia `rechazo_tienda`). Tambien aterriza en `rechazada` y tampoco la alcanza la igualdad de
// arriba, asi que el aviso NO se emite. Y aqui el texto seria todavia mas falso que en el caso de
// la 237: el paquete ni siquiera esta en la calle — volvio a la bodega, se escaneo al aprobar el
// cierre (238) y lleva dias esperando. Decir «rechazada por el destinatario» sobre eso es contar un
// hecho que no ocurrio.
//
// Y como en la 237, el aviso no es el mecanismo de nada: la orden llega igual a
// `por_devolver`/`por_devolver_a_tienda` al aprobarse el cierre que recoja la gestion sintetica
// (139). Afirmado con su CONTROL POSITIVO en
// `tests/unit/repositories/notificacion-orden-rechazada.test.ts`.

/**
 * Emisor REAL usado por defecto en `appendCambioEstado` (design §4.1). Filtra el lote por
 * `destino === "rechazada" && origenTipo === "gestion"`: el escalado por SLA
 * (`escalado_devuelta_sla`) tambien aterriza en `rechazada` y NO notifica (R19).
 *
 * GUARD DEFENSIVO (patron `emisorWebhookEstadoReal`): los ~18 call-sites historicos del choke
 * point tienen tests unitarios que mockean `tx` con SOLO `ordenHistorialEstado`. Si el `tx`
 * no expone las tablas de esta feature no hay nada real que emitir y se retorna sin tocar
 * nada, para no romper esas suites. En produccion el `tx` es el de `$transaction`, completo.
 */
export const emisorNotificacionReal: NotificacionEmisor = async (
  tx,
  entradas,
  valuePorEstatusId,
) => {
  const rechazos = entradas.filter(
    (e) =>
      e.origenTipo === ORIGEN_RECHAZO_DEL_DESTINATARIO &&
      valuePorEstatusId.get(e.estatusDestinoId) === DESTINO_RECHAZO,
  );
  if (rechazos.length === 0) return; // caso mayoritario: ni una consulta
  if (typeof (tx as { orden?: unknown }).orden !== "object" || tx.orden === null) return;
  if (typeof (tx as { notificacion?: unknown }).notificacion !== "object") return;

  const ordenIds = Array.from(new Set(rechazos.map((e) => e.ordenId)));
  const ordenes = await tx.orden.findMany({
    where: { id: { in: ordenIds } },
    select: { id: true, tiendaId: true, zonaId: true, numGuia: true, numRemision: true },
  });
  if (!Array.isArray(ordenes)) return;

  const repo = new NotificacionRepository(tx);
  for (const orden of ordenes) {
    await emitirOrdenRechazada(
      repo,
      {
        ordenId: orden.id,
        tiendaId: orden.tiendaId,
        zonaId: orden.zonaId ?? null,
        numGuia: orden.numGuia ?? null,
        numRemision: orden.numRemision,
      },
      tx,
    );
  }
};

// ---------------------------------------------------------------------------
// §4.2 — Carga masiva terminada (R22, R39). BEST-EFFORT en los call-sites.
// ---------------------------------------------------------------------------

export interface CargaMasivaContexto {
  /** Usuario que EJECUTO la carga: unico destinatario posible (F1.4-2). */
  usuarioId: string;
  creadas: number;
  total: number;
  /** Clave de idempotencia (R39): `loteId` del cliente o id de lote server-side. */
  loteId: string;
}

/** R22/R39: UNA fila `box` dirigida al ejecutor; la dedupe por `loteId` la hace idempotente. */
export async function emitirCargaMasivaTerminada(
  repo: INotificacionRepository,
  ctx: CargaMasivaContexto,
  tx?: NotificacionTxClient,
): Promise<number> {
  return emitirFilas(
    repo,
    [
      {
        tipo: "box",
        evento: "carga_masiva_terminada",
        descripcion: textoCargaMasivaTerminada(ctx.creadas),
        anexo: `${ctx.total} ${ctx.total === 1 ? "fila" : "filas"}`,
        entidadTipo: "carga",
        entidadId: ctx.loteId,
        destinatario: { tipo: "usuario", usuarioId: ctx.usuarioId },
      },
    ],
    tx,
  );
}

// ---------------------------------------------------------------------------
// §4.3 — Postulacion de mensajero pendiente (R23). BEST-EFFORT.
// ---------------------------------------------------------------------------

export interface PostulacionContexto {
  postulanteId: string;
  nombre: string;
}

/** R23: DOS filas `warning` sin alcance, a `maestro` y `admin` (espejo de ROLES_APROBADORES). */
export async function emitirPostulacionPendiente(
  repo: INotificacionRepository,
  ctx: PostulacionContexto,
  tx?: NotificacionTxClient,
): Promise<number> {
  return emitirFilas(
    repo,
    ROLES_ADMINISTRACION.map((destinatario) => ({
      tipo: "warning" as const,
      evento: "postulacion_mensajero_pendiente" as const,
      descripcion: TEXTO_POSTULACION_PENDIENTE,
      anexo: ctx.nombre,
      entidadTipo: "usuario" as const,
      entidadId: ctx.postulanteId,
      destinatario,
    })),
    tx,
  );
}

// ---------------------------------------------------------------------------
// Feature 253 (D6) — Postulacion de vehiculo o bodega pendiente. BEST-EFFORT.
// ---------------------------------------------------------------------------

/** Lo MINIMO que el aviso necesita. Ni `nombre`, ni `correo`, ni `telefono`, ni `mensaje`: R19
 *  prohibe que esos tres ultimos salgan de la fila, y el nombre no aporta nada aqui. */
export interface PostulacionRecursoContexto {
  postulacionId: string;
  /** `vehiculo` | `bodega`. Solo alimenta el anexo, que es la unica pista del aviso. */
  tipo: "vehiculo" | "bodega";
}

/** Etiqueta legible del tipo para el anexo. No es PII y ahorra abrir el panel para saber que es. */
const ANEXO_POR_TIPO: Record<PostulacionRecursoContexto["tipo"], string> = {
  vehiculo: "Vehiculo",
  bodega: "Bodega",
};

/**
 * D6: DOS filas `warning` sin alcance, a `maestro` y `admin` (espejo exacto de quien autoriza el
 * panel, `ROLES_ATENCION` de `PostulacionRecursoService`). Misma forma que el aviso de postulacion
 * de mensajero, del que este es hermano.
 *
 * `entidadTipo` es `postulacion_recurso` y NO `usuario`: esta postulacion no crea ninguna cuenta
 * (design §14-C), y con `usuario` el `entidad_id` apuntaria a una tabla en la que esa fila no
 * existe. El valor lo anade la migracion `*_notificacion_evento_postulacion_recurso`.
 */
export async function emitirPostulacionRecursoPendiente(
  repo: INotificacionRepository,
  ctx: PostulacionRecursoContexto,
  tx?: NotificacionTxClient,
): Promise<number> {
  return emitirFilas(
    repo,
    ROLES_ADMINISTRACION.map((destinatario) => ({
      tipo: "warning" as const,
      evento: "postulacion_recurso_pendiente" as const,
      descripcion: TEXTO_POSTULACION_RECURSO_PENDIENTE,
      anexo: ANEXO_POR_TIPO[ctx.tipo],
      entidadTipo: "postulacion_recurso" as const,
      entidadId: ctx.postulacionId,
      destinatario,
    })),
    tx,
  );
}

// ---------------------------------------------------------------------------
// Feature 262 (D7) — Al mensajero le corrigieron el dia de una orden suya. BEST-EFFORT.
// ---------------------------------------------------------------------------

/** Lo MINIMO que el aviso necesita. Ni direccion, ni telefono, ni destinatario, ni monto (R48). */
export interface DiaRepartoCorregidoContexto {
  /**
   * Id de la fila de `orden_dia_reparto_cambio`: LA ENTIDAD del aviso.
   *
   * ⚠️ NO ES EL `ordenId`, Y ES EL HALLAZGO QUE DECIDE ESTE DISENO (design §15.2/§15.3, A20).
   * `notificacion_dedupe_key` es UNIQUE sobre `(evento, entidad_id, destinatario_rol,
   * destinatario_usuario_id)` con `NULLS NOT DISTINCT`. Con el id de la ORDEN, esa clave admitiria
   * UNA sola fila por (evento, orden, mensajero) PARA SIEMPRE —ni siquiera despues de que el primer
   * aviso se lea— y `NotificacionRepository.crear` ABSORBE el `P2002` devolviendo `false`: la
   * SEGUNDA correccion de esa orden no avisaria nunca, en silencio absoluto. Y «mañana -> hoy sobre
   * una orden que el mensajero ya lleva encima» —el caso por el que existe esta feature— es
   * precisamente el que llega en segundo lugar. Con el id del CAMBIO, cada correccion es una
   * entidad distinta: la clave nunca colisiona y R50 es una propiedad ESTRUCTURAL.
   */
  cambioId: string;
  /** El destinatario, y el UNICO (R51): el mensajero asignado de esa orden. */
  mensajeroUsuarioId: string;
  /** `YYYY-MM-DD` ya resuelto por el servidor. El aviso nombra la FECHA, no «hoy»/«mañana» (R47). */
  fechaNuevaISO: string;
  /** La guia si existe; si no, el numero de remision. Copia exacta de `emitirOrdenRechazada`. */
  anexo: string;
}

/**
 * R46/R50/R51 — UNA fila `box` dirigida al mensajero asignado, y a nadie mas.
 *
 * `tipo: "box"` (icono de paquete) y no `alert` ni `warning`: esto es un PAQUETE QUE CAMBIO DE DIA,
 * no una alarma ni algo pendiente de aprobacion. `alert` teñiria de rojo una correccion legitima de
 * planificacion (`NotificationsBell.tsx:55-63`).
 *
 * LOS ADMINS NO SE AVISAN (R51): ellos son quienes corrigen. La tienda tampoco. Es —junto con el de
 * carga masiva— la unica notificacion de este repo dirigida a UNA persona; el precedente del
 * destinatario por usuario es `emitirCargaMasivaTerminada`.
 */
export async function emitirDiaRepartoCorregido(
  repo: INotificacionRepository,
  ctx: DiaRepartoCorregidoContexto,
  tx?: NotificacionTxClient,
): Promise<number> {
  return emitirFilas(
    repo,
    [
      {
        tipo: "box",
        evento: "dia_reparto_corregido",
        descripcion: textoDiaRepartoCorregido(ctx.fechaNuevaISO),
        anexo: ctx.anexo,
        entidadTipo: "orden_dia_reparto_cambio",
        entidadId: ctx.cambioId,
        destinatario: { tipo: "usuario", usuarioId: ctx.mensajeroUsuarioId },
      },
    ],
    tx,
  );
}

// ---------------------------------------------------------------------------
// §4.4 — Cierre de dia por aprobar (R24). BEST-EFFORT.
// ---------------------------------------------------------------------------

export interface CierrePorAprobarContexto {
  cierreId: string;
  /** Zona DESTINO del cierre (ya resuelta por `resolverDestinoCierre`). */
  zonaId: string | null;
  /** Nombre del mensajero, unico dato del anexo (sin telefono ni monto). */
  mensajeroNombre: string | null;
}

/**
 * R24: TRES filas `warning` — `maestro` y `admin` sin alcance y `adminSatelite` acotada a la
 * zona destino del cierre (espejo del alcance de `CierresAdminService`). Sin zona resuelta,
 * la tercera no se emite. La dedupe (§1.4) evita el segundo aviso cuando el MISMO cierre se
 * re-solicita sin que nadie haya leido el primero (R27).
 */
export async function emitirCierreDiaPorAprobar(
  repo: INotificacionRepository,
  ctx: CierrePorAprobarContexto,
  tx?: NotificacionTxClient,
): Promise<number> {
  const destinatarios: NotificacionDestinatario[] = [...ROLES_ADMINISTRACION];
  if (ctx.zonaId !== null) {
    destinatarios.push({ tipo: "rol", rol: "adminSatelite", zonaId: ctx.zonaId });
  }
  return emitirFilas(
    repo,
    destinatarios.map((destinatario) => ({
      tipo: "warning" as const,
      evento: "cierre_dia_por_aprobar" as const,
      descripcion: TEXTO_CIERRE_POR_APROBAR,
      anexo: ctx.mensajeroNombre,
      entidadTipo: "cierre_dia" as const,
      entidadId: ctx.cierreId,
      destinatario,
    })),
    tx,
  );
}
