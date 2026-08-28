// Feature 109 (design §3, R6/R7/R8/R14/R20/R22) — contrato del repositorio de MENSAJES de
// chat. Solo queries Prisma: dedupe por `wa_message_id` (insert idempotente), update de
// `estado` por `wa_message_id`, insert de salientes y listado ordenado del hilo. La
// interfaz NO expone `PrismaClient`.
import type { ChatMensajeDireccion, ChatMensajeEstado, ChatMensajeTipo } from "@prisma/client";
import type { ChatContactoNormalizado } from "@/lib/types/chat-contactos";

/**
 * Feature 308 (design §4) — los nueve campos nuevos de un mensaje, agrupados por el tipo que
 * los usa. Se comparten entre el DTO de lectura y el input de escritura porque son EXACTAMENTE
 * los mismos datos; `contactos` cruza la interfaz TIPADO (nunca `Prisma.JsonValue` ni `any`):
 * la conversion JSON<->tipo vive dentro del repositorio.
 */
export interface ChatMensajeCamposMedia {
  /** Id de media de Meta (R1). NUNCA se expone a la UI: la burbuja usa el id interno (R21). */
  mediaId: string | null;
  mediaMime: string | null;
  /** `filename` de un documento (R29); `null` en el resto. */
  mediaNombre: string | null;
  /** Solo si Meta lo mando; normalmente `null` (P2). */
  mediaTamanoBytes: number | null;
  /** `reaction.message_id`: el mensaje al que reacciona (R4). */
  reaccionAWaMessageId: string | null;
  /** Emoji de la reaccion; `null` con `reaccionAWaMessageId` presente = RETIRADA (R5). */
  reaccionEmoji: string | null;
  /** Contactos compartidos ya normalizados (R7); `null` si no es un mensaje de contactos. */
  contactos: ChatContactoNormalizado[] | null;
  /** Evidencia del cambio de numero del cliente (R9/R18). */
  sistemaTelefonoAnterior: string | null;
  sistemaTelefonoNuevo: string | null;
}

/** DTO plano de un mensaje de chat (nunca la entidad Prisma cruda). */
export interface ChatMensajeDTO extends ChatMensajeCamposMedia {
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
  /** Motivo del ultimo `failed` reportado por Meta; `null` si nunca fallo o ya se reconcilio. */
  errorCodigo: number | null;
  errorTitulo: string | null;
  errorDetalle: string | null;
  ocurridoAt: Date;
  createdAt: Date;
}

/** Motivo del fallo a persistir junto al estado (viene del `errors[0]` del webhook). */
export interface ChatMensajeErrorInput {
  /** `null` si el proveedor no devolvio codigo (cuerpo no-JSON, proxy, etc.). */
  codigo: number | null;
  titulo: string | null;
  detalle: string | null;
}

/**
 * Datos de un mensaje ENTRANTE a insertar (R6). `estado` no aplica a entrantes.
 * Los campos de la feature 308 son OPCIONALES: un entrante de texto no los manda y quedan NULL.
 */
export interface InsertarEntranteInput extends Partial<ChatMensajeCamposMedia> {
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
  /** Motivo, cuando se inserta ya `failed` (rechazo determinista de la Graph API). */
  error?: ChatMensajeErrorInput | null;
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
   *
   * `error` (opcional) persiste el motivo que Meta adjunta a un `failed`. Se pasa `null`
   * explicito para LIMPIARLO cuando un mensaje vuelve a un estado sano (p. ej. un reintento
   * que sale bien): asi la columna nunca conserva el motivo de un fallo ya superado.
   */
  actualizarEstadoPorWaMessageId(
    waMessageId: string,
    estado: ChatMensajeEstado,
    error?: ChatMensajeErrorInput | null,
  ): Promise<number>;

  /**
   * Busca un saliente por su `wa_message_id` (el status del webhook solo trae ese id, y el
   * job de reintento necesita el id interno del mensaje). `null` si no esta registrado.
   */
  findByWaMessageId(waMessageId: string): Promise<ChatMensajeDTO | null>;

  /**
   * D1/R21: reconcilia un saliente `queued` tras un reintento exitoso: fija su `waMessageId`
   * y su `estado`. Usado por el handler del job `whatsapp_chat_envio`.
   */
  reconciliarSaliente(
    mensajeId: string,
    waMessageId: string,
    estado: ChatMensajeEstado,
  ): Promise<void>;

  /**
   * Cierra un saliente como `failed` con su motivo. Lo usa el reintento cuando la Graph API
   * responde un rechazo DETERMINISTA: sin esto el mensaje se quedaria `queued` para siempre.
   */
  marcarFallido(mensajeId: string, error: ChatMensajeErrorInput): Promise<void>;

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

  /**
   * Feature 308 (design §4/§5.2, R23) — media de UN mensaje, SOLO si ese mensaje pertenece a un
   * hilo de una orden asignada a `mensajeroId`. Es la MISMA puerta que `listarHilo` (R16/R17 de
   * la 109): la propiedad de la orden se resuelve en el servidor, nunca por un parametro del
   * cliente. Una sola query con el join, para que la autorizacion del proxy sea barata y no
   * duplique la regla.
   *
   * `null` = mensaje inexistente, de otro hilo o de una orden ajena. El caller responde 403 SIN
   * tocar la Graph API. `mediaId: null` = el mensaje existe y es suyo pero no tiene adjunto (404).
   */
  findMediaParaMensajero(
    mensajeId: string,
    mensajeroId: string,
  ): Promise<ChatMediaAutorizada | null>;
}

/** Lo minimo que el proxy necesita para servir un adjunto ya autorizado (design §4). */
export interface ChatMediaAutorizada {
  mediaId: string | null;
  mediaMime: string | null;
  mediaNombre: string | null;
  ordenId: string;
}
