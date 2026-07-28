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
export function textoCargaMasivaTerminada(creadas: number): string {
  return `Carga masiva terminada: ${creadas} ${creadas === 1 ? "orden cargada" : "órdenes cargadas"}.`;
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
