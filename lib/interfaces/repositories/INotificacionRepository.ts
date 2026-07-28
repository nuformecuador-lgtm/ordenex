import type { PrismaClient, RolValue } from "@prisma/client";
import type {
  NotificacionEntidadTipo,
  NotificacionEvento,
  NotificationType,
} from "@/lib/types/notificacion";

// Feature 146 (design §2/§1.5) — contrato del repositorio de notificaciones. SOLO queries
// Prisma: la autorizacion de negocio y las reglas del listado viven en el service.

/**
 * Cliente de transaccion aceptado por `crear`/`existeNoLeidaPara`: cualquier cosa que
 * exponga las dos tablas de la feature. Lo satisfacen tanto el `PrismaClient` completo como
 * el `tx` de un `$transaction` (patron `OrdenHistorialTxClient` / `WalletTxClient`).
 *
 * Es lo que permite que el productor de "orden rechazada" emita DENTRO de la transaccion
 * del cambio de estado (F1.4-3, design §4.1).
 */
export type NotificacionTxClient = Pick<PrismaClient, "notificacion" | "notificacionLectura">;

/**
 * Actor tal y como lo necesita el predicado de visibilidad (design §1.5). `zonaId` es
 * `usuario.zona_id`; `null` cuando el actor no tiene zona (entonces NO ve ninguna
 * notificacion acotada por zona, R16).
 */
export interface NotificacionActor {
  usuarioId: string;
  rol: RolValue;
  zonaId: string | null;
}

/**
 * Destinatario de UNA fila (R4/R6): o un rol —opcionalmente ACOTADO por tienda o por zona—
 * o un usuario concreto. Nunca ambos: el tipo hace irrepresentable la fila que el CHECK XOR
 * de la DB rechazaria.
 */
export type NotificacionDestinatario =
  | { tipo: "rol"; rol: RolValue; tiendaId?: string | null; zonaId?: string | null }
  | { tipo: "usuario"; usuarioId: string };

/** Una notificacion a crear (design §4.6: descripcion y anexo los compone el emisor). */
export interface CrearNotificacionInput {
  tipo: NotificationType;
  evento: NotificacionEvento;
  descripcion: string;
  anexo?: string | null;
  entidadTipo: NotificacionEntidadTipo;
  entidadId: string | null;
  destinatario: NotificacionDestinatario;
}

/** Fila proyectada para el listado, con el estado de lectura del actor ya resuelto. */
export interface NotificacionRow {
  id: string;
  tipo: NotificationType;
  descripcion: string;
  anexo: string | null;
  createdAt: Date;
  /** Derivado del anti-join con `notificacion_lectura` del actor (D4). */
  leida: boolean;
}

export interface ListarParaUsuarioInput {
  actor: NotificacionActor;
  /** Instante minimo de `created_at` (ventana de 30 dias, F1.4-6). */
  desde: Date;
  /** Cota dura de filas devueltas (`PAGE_SIZE`). */
  limite: number;
}

export interface INotificacionRepository {
  /**
   * Crea UNA fila. Acepta `tx` para que el productor transaccional del rechazo (F1.4-3)
   * escriba dentro de la transaccion del cambio de estado. Devuelve `false` —sin lanzar—
   * cuando la fila choca con el indice unico de dedupe (`notificacion_dedupe_key`), que es
   * exactamente el comportamiento que R27 pide: no-op, no error.
   */
  crear(input: CrearNotificacionInput, tx?: NotificacionTxClient): Promise<boolean>;

  /**
   * Guardia de dedupe (design §1.4, R27): ya existe una notificacion para ese
   * `(evento, entidadId, destinatario)` que su destinatario NO ha leido. "No leida" depende
   * de otra tabla, asi que NO es expresable en un indice: por eso es una guardia previa al
   * `crear`, y el indice unico es solo la red ante carreras.
   */
  existeNoLeidaPara(
    evento: NotificacionEvento,
    entidadId: string,
    destinatario: NotificacionDestinatario,
    tx?: NotificacionTxClient,
  ): Promise<boolean>;

  /**
   * R28/R29/R30: las notificaciones VISIBLES para el actor (predicado unico, §1.5) que el
   * actor no haya descartado, dentro de la ventana, ordenadas de mas reciente a mas antigua
   * y acotadas a `limite`. `leida` viene resuelta por fila.
   */
  listarParaUsuario(input: ListarParaUsuarioInput): Promise<NotificacionRow[]>;

  /**
   * R35: la notificacion `id` existe Y es visible para el actor. Devuelve `"no_existe"`
   * cuando la fila no esta, y `"no_visible"` cuando esta pero el predicado la excluye: son
   * respuestas distintas (`not_found` vs `forbidden`) y el service las necesita separadas.
   */
  verificarVisible(
    id: string,
    actor: NotificacionActor,
  ): Promise<"visible" | "no_visible" | "no_existe">;

  /** R31/R37: upsert idempotente de la lectura por (notificacion, usuario). */
  marcarLeida(notificacionId: string, usuarioId: string, ahora: Date): Promise<void>;

  /**
   * R32: registra la lectura de TODAS las visibles y no descartadas del actor dentro de la
   * ventana, en UNA sentencia con `ON CONFLICT DO NOTHING` (idempotente, sin
   * read-modify-write). Devuelve cuantas filas nuevas se insertaron.
   */
  marcarTodasLeidas(actor: NotificacionActor, desde: Date, ahora: Date): Promise<number>;

  /**
   * R33/R37: descarta POR USUARIO (no borra la fila de `notificacion` ni afecta a los demas
   * destinatarios). Descartar implica leer: escribe `descartada_at` y, si aun no habia,
   * `leida_at`, para que descartar una no leida no descuadre el contador.
   */
  descartar(notificacionId: string, usuarioId: string, ahora: Date): Promise<void>;
}
