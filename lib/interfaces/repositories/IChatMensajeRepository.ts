// Feature 109 (design §3, R6/R7/R8/R14/R20/R22) — contrato del repositorio de MENSAJES de
// chat. Solo queries Prisma: dedupe por `wa_message_id` (insert idempotente), update de
// `estado` por `wa_message_id`, insert de salientes y listado ordenado del hilo. La
// interfaz NO expone `PrismaClient`.
import type { ChatMensajeDireccion, ChatMensajeEstado, ChatMensajeTipo } from "@prisma/client";

/** DTO plano de un mensaje de chat (nunca la entidad Prisma cruda). */
export interface ChatMensajeDTO {
  id: string;
  conversacionId: string;
  direccion: ChatMensajeDireccion;
  tipo: ChatMensajeTipo;
  cuerpo: string | null;
  plantillaId: string | null;
  waMessageId: string | null;
  estado: ChatMensajeEstado | null;
  /** Feature 121: coordenadas de un mensaje de ubicacion; `null` en los demas tipos. */
  latitud: number | null;
  longitud: number | null;
  ocurridoAt: Date;
  createdAt: Date;
}

/** Datos de un mensaje ENTRANTE a insertar (R6). `estado` no aplica a entrantes. */
export interface InsertarEntranteInput {
  conversacionId: string;
  tipo: ChatMensajeTipo;
  cuerpo: string | null;
  waMessageId: string;
  /** Feature 121 (R4): coordenadas cuando `tipo === "ubicacion"`; `null`/ausente en el resto. */
  latitud?: number | null;
  longitud?: number | null;
  ocurridoAt: Date;
}

/** Datos de un mensaje SALIENTE a insertar (R20). `waMessageId` null si aun no lo dio Meta. */
export interface InsertarSalienteInput {
  conversacionId: string;
  tipo: ChatMensajeTipo;
  cuerpo: string | null;
  plantillaId?: string | null;
  waMessageId?: string | null;
  estado: ChatMensajeEstado;
  ocurridoAt: Date;
}

export interface IChatMensajeRepository {
  /**
   * R6/R8: inserta un entrante de forma IDEMPOTENTE. Con `ON CONFLICT DO NOTHING` sobre el
   * indice unico parcial de `wa_message_id`: un id ya registrado NO crea fila y NO falla.
   * Devuelve `true` si insertó, `false` si el dedupe lo omitió.
   */
  insertarEntranteIdempotente(input: InsertarEntranteInput): Promise<boolean>;

  /** R20: inserta un saliente y devuelve su DTO (incluye el id generado). */
  insertarSaliente(input: InsertarSalienteInput): Promise<ChatMensajeDTO>;

  /**
   * R7/R8: actualiza el `estado` del saliente identificado por `waMessageId`. Devuelve el
   * numero de filas afectadas: 0 = el saliente aun no esta registrado (el status llego
   * antes; no rompe el 200, R9).
   */
  actualizarEstadoPorWaMessageId(
    waMessageId: string,
    estado: ChatMensajeEstado,
  ): Promise<number>;

  /**
   * D1/R21: reconcilia un saliente `queued` tras un reintento exitoso: fija su `waMessageId`
   * y su `estado`. Usado por el handler del job `whatsapp_chat_envio`.
   */
  reconciliarSaliente(
    mensajeId: string,
    waMessageId: string,
    estado: ChatMensajeEstado,
  ): Promise<void>;

  /** Busca un mensaje por id (drenado del job de reintento). */
  findById(mensajeId: string): Promise<ChatMensajeDTO | null>;

  /** R22: lista el historial de un hilo ordenado cronologicamente (`ocurrido_at` asc). */
  listarHilo(conversacionId: string): Promise<ChatMensajeDTO[]>;

  /**
   * `ocurrido_at` del ULTIMO mensaje entrante del hilo (o null si no hay). Fuente autoritativa
   * de la ventana de 24 h para el envio, consistente con el panel (que habilita el input al
   * haber entrantes). Evita depender de la columna `ultimo_entrante_at`, que puede desincronizar.
   */
  ultimoEntranteAt(conversacionId: string): Promise<Date | null>;
}
