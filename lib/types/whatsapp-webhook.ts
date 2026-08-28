// Feature 109 (design §1/§2.1, R5) — BORDE TIPADO del webhook de entrada de WhatsApp.
// El route handler valida el cuerpo crudo de Meta con estos esquemas zod (que DESCARTAN
// -strip- los campos no reconocidos) y lo NORMALIZA a un tipo de dominio. El service NO
// conoce la forma de Meta: recibe `WebhookEventos` ya limpio (mensajes entrantes + statuses).
//
// zod hace strip por defecto en `.object()`: los campos extra de Meta (contacts, metadata,
// profile, etc.) no rompen el parseo y tampoco sobreviven (R5).
import { z } from "zod";
import type { ChatMensajeTipo, ChatMensajeEstado } from "@prisma/client";
import type { ChatContactoNormalizado } from "@/lib/types/chat-contactos";
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";

// --- Esquemas de la forma cruda de Meta (solo lo que consumimos; el resto se strip-ea) ---

/**
 * Feature 308 (design §2.1, R1/R2) — la forma comun de los cinco tipos de MEDIA de Meta
 * (`image`, `audio`, `video`, `document`, `sticker`). Solo `id` es obligatorio: sin el no hay
 * forma de bajar el binario y el mensaje se degrada a `otro` (R3).
 *
 * `.catch(undefined)` en cada campo blando por el MISMO motivo que documenta `location` mas
 * abajo: un tipo inesperado hace fallar ESE campo y el `.catch` lo degrada a "sin dato" en vez
 * de tumbar el `parse` del lote entero, que devolveria el 200 pero PERDIENDO todos los mensajes.
 */
const metaMediaSchema = z
  .object({
    id: z.string().min(1),
    mime_type: z.string().optional().catch(undefined),
    filename: z.string().optional().catch(undefined), // solo documentos
    caption: z.string().optional().catch(undefined), // image/video/document
    // Meta rara vez manda el tamaño en el webhook; solo se conoce al descargar (P2).
    file_size: z.number().int().nonnegative().optional().catch(undefined),
  })
  .optional()
  .catch(undefined);

/**
 * Feature 308 (R7) — un contacto compartido, tal como lo manda Meta. TODOS sus miembros son
 * blandos: Meta ha cambiado la forma de `contacts` mas de una vez y un cambio suyo no debe
 * romper la ingesta. El strip de zod DESCARTA lo que no se declara aqui (R7).
 */
const metaContactSchema = z.object({
  name: z
    .object({
      formatted_name: z.string().optional().catch(undefined),
      first_name: z.string().optional().catch(undefined),
      last_name: z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  phones: z
    .array(
      z.object({
        phone: z.string().optional().catch(undefined),
        wa_id: z.string().optional().catch(undefined),
        type: z.string().optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
  emails: z
    .array(
      z.object({
        email: z.string().optional().catch(undefined),
        type: z.string().optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
  addresses: z
    .array(
      z.object({
        street: z.string().optional().catch(undefined),
        city: z.string().optional().catch(undefined),
        state: z.string().optional().catch(undefined),
        zip: z.string().optional().catch(undefined),
        country: z.string().optional().catch(undefined),
        type: z.string().optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
  org: z
    .object({ company: z.string().optional().catch(undefined) })
    .optional()
    .catch(undefined),
  urls: z
    .array(z.object({ url: z.string().optional().catch(undefined) }))
    .optional()
    .catch(undefined),
});

// Un mensaje ENTRANTE del cliente. `text.body` solo viene en type "text"; el resto de tipos
// trae su propio sub-objeto (media, reaction, contacts, system) desde la feature 308.
const metaMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).optional(),
  // Feature 121 (design §2, R1/R2): ubicacion compartida por el cliente (`type=location`).
  // Solo lat/lng; el strip por defecto de zod DESCARTA `name`/`address` de Meta (R2/P1). Un
  // `latitude`/`longitude` NO numerico hace fallar ESE campo; `.catch(undefined)` degrada el
  // `location` entero a `undefined` (location SIN coords) en vez de romper el parseo del lote,
  // que luego `parseWebhookEventos` normaliza a tipo `otro` (R3). No lanza.
  location: z
    .object({ latitude: z.number(), longitude: z.number() })
    .optional()
    .catch(undefined),
  // Feature 308 (design §2.1): los cinco tipos de media comparten forma.
  image: metaMediaSchema,
  audio: metaMediaSchema,
  video: metaMediaSchema,
  document: metaMediaSchema,
  sticker: metaMediaSchema,
  // R4/R5: `emoji` ausente o vacio = reaccion RETIRADA. Sin `message_id` no hay a que anclarla.
  reaction: z
    .object({
      message_id: z.string().min(1),
      emoji: z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  contacts: z.array(metaContactSchema).optional().catch(undefined),
  // R9/P1: la forma del `system` ha variado entre versiones de la Cloud API. Se declaran los
  // TRES campos que han portado el numero nuevo y se resuelven en cascada en `normalizarSistema`.
  system: z
    .object({
      type: z.string().optional().catch(undefined),
      body: z.string().optional().catch(undefined),
      wa_id: z.string().optional().catch(undefined),
      new_wa_id: z.string().optional().catch(undefined),
      customer: z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

/**
 * Motivo del fallo que Meta adjunta a un status `failed`. TODOS los campos son opcionales
 * salvo `code`: Meta ha ido variando la forma (`title` a secas en versiones viejas, `message`
 * + `error_data.details` en las nuevas) y un cambio suyo NO debe romper la ingesta, que debe
 * seguir devolviendo 200. `.catch(undefined)` en los blandos asegura que un tipo inesperado
 * degrade a "sin dato" en vez de tirar el lote entero.
 */
const metaErrorSchema = z.object({
  code: z.number().int(),
  title: z.string().optional().catch(undefined),
  message: z.string().optional().catch(undefined),
  error_data: z
    .object({ details: z.string().optional().catch(undefined) })
    .optional()
    .catch(undefined),
});

// Una actualizacion de ESTADO de un saliente. `status` es vocabulario de Meta.
// `errors` solo viene en los `failed`; es la UNICA fuente del motivo del fallo y antes se
// perdia por el strip de zod, dejando un `failed` mudo e indiagnosticable.
const metaStatusSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.string().min(1),
  errors: z.array(metaErrorSchema).optional().catch(undefined),
});

const metaValueSchema = z.object({
  messages: z.array(metaMessageSchema).optional(),
  statuses: z.array(metaStatusSchema).optional(),
});

const metaChangeSchema = z.object({
  value: metaValueSchema,
});

const metaEntrySchema = z.object({
  changes: z.array(metaChangeSchema),
});

/** Esquema del payload completo del webhook. Strip de campos extra (R5). */
export const whatsappWebhookPayloadSchema = z.object({
  entry: z.array(metaEntrySchema),
});

export type WhatsappWebhookPayload = z.infer<typeof whatsappWebhookPayloadSchema>;

// --- Tipo de dominio normalizado que consume el service (sin forma de Meta) ---

/** Un mensaje entrante ya normalizado desde el payload de Meta. */
export interface WebhookMensajeEntrante {
  waMessageId: string;
  /** Numero del cliente en formato E.164 sin `+` (como lo entrega Meta). */
  telefonoE164: string;
  tipo: ChatMensajeTipo;
  /** Texto plano si el mensaje lo trae; `null` para tipos sin cuerpo. */
  cuerpo: string | null;
  /**
   * Feature 121 (design §2, R1): coordenadas de un mensaje de ubicacion. Presente SOLO cuando
   * `tipo === "ubicacion"` con coords validas; ausente en cualquier otro caso (o vienen ambas
   * o ninguna, por eso un sub-objeto y no dos campos sueltos).
   */
  ubicacion?: { latitud: number; longitud: number };
  /**
   * Feature 308 (R1/R2): datos del adjunto cuando `tipo` es imagen/audio/video/documento/
   * sticker. Sub-objeto COHESIVO por la misma razon que `ubicacion`: o viene el grupo entero o
   * ninguno. NO contiene el binario (D1/R15): solo el id de Meta y sus metadatos.
   */
  media?: {
    mediaId: string;
    mediaMime: string | null;
    mediaNombre: string | null;
    mediaTamanoBytes: number | null;
  };
  /** Feature 308 (R4/R5): presente solo si `tipo === "reaccion"`. `emoji: null` = RETIRADA. */
  reaccion?: { objetivoWaMessageId: string; emoji: string | null };
  /** Feature 308 (R7): lista NO vacia de contactos; ausente si el mensaje no es `contactos`. */
  contactos?: ChatContactoNormalizado[];
  /** Feature 308 (R9): numeros del cambio de numero del cliente. `telefonoNuevo` siempre presente. */
  sistema?: { telefonoAnterior: string | null; telefonoNuevo: string };
  ocurridoAt: Date;
}

/**
 * Motivo del fallo, ya normalizado. `detalle` prefiere `error_data.details` (el texto mas
 * especifico que da Meta) y cae a `message`; nunca contiene el numero destino ni el cuerpo
 * del mensaje, solo la descripcion del error.
 */
export interface WebhookStatusError {
  codigo: number;
  titulo: string | null;
  detalle: string | null;
}

/** Una actualizacion de estado de entrega de un saliente, normalizada. */
export interface WebhookStatus {
  waMessageId: string;
  estado: ChatMensajeEstado;
  ocurridoAt: Date;
  /** Solo en `estado === "failed"` y solo si Meta mando `errors`; `null` en el resto. */
  error: WebhookStatusError | null;
}

/** Eventos accionables extraidos del lote del webhook. */
export interface WebhookEventos {
  mensajes: WebhookMensajeEntrante[];
  statuses: WebhookStatus[];
}

/** Estados de entrega que Meta reporta y que mapeamos al enum nativo. */
const ESTADOS_META: Record<string, ChatMensajeEstado> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

/**
 * Normaliza el PRIMER error del array de un status `failed`. Meta siempre manda uno solo en
 * la practica; si mandara varios, el primero es el que describe la causa raiz. Ausente o
 * vacio -> `null` (un `failed` sin motivo sigue siendo un `failed` valido).
 */
function primerError(
  errores: z.infer<typeof metaErrorSchema>[] | undefined,
): WebhookStatusError | null {
  const e = errores?.[0];
  if (e === undefined) return null;
  return {
    codigo: e.code,
    titulo: e.title ?? null,
    // `error_data.details` es mas especifico que `message` cuando viene; si no, `message`.
    detalle: e.error_data?.details ?? e.message ?? null,
  };
}

/** Convierte el timestamp de Meta (segundos unix como string) a Date. */
function timestampAMeta(ts: string): Date {
  const segundos = Number(ts);
  return Number.isFinite(segundos) ? new Date(segundos * 1000) : new Date(0);
}

/**
 * Feature 121 (design §2, R3): una coordenada es valida si es finita y cae en el rango
 * geografico (lat ∈ [-90, 90], lng ∈ [-180, 180]). Helper PURO y testeable: fuera de rango o
 * no finita -> se descarta la ubicacion (se degrada a `otro` sin coords), sin lanzar.
 */
export function esCoordenadaValida(latitud: number, longitud: number): boolean {
  return (
    Number.isFinite(latitud) &&
    Number.isFinite(longitud) &&
    latitud >= -90 &&
    latitud <= 90 &&
    longitud >= -180 &&
    longitud <= 180
  );
}

/**
 * Feature 308 (design §2.2, R11) — mapa explicito `type` de Meta -> enum de dominio. Lo que no
 * este aqui cae en `otro` por DEFECTO: los tipos fuera de alcance (`button`, `interactive`,
 * `order`, `request_welcome`, `ephemeral`) y cualquier tipo futuro que Meta invente.
 */
const TIPOS_META: Record<string, ChatMensajeTipo> = {
  text: "texto",
  location: "ubicacion",
  image: "imagen",
  audio: "audio",
  video: "video",
  document: "documento",
  sticker: "sticker",
  reaction: "reaccion",
  contacts: "contactos",
  system: "sistema",
};

/**
 * Mapea el `type` de Meta al enum de dominio. Nota: un `type` mapeado cuyo sub-objeto no trae
 * lo esencial (location sin coords, media sin id, reaction sin message_id, contacts vacio,
 * system sin numero nuevo) se DEGRADA a `otro` en `parseWebhookEventos` (R3/R6/R8/R10); esta
 * funcion solo mapea el `type` crudo.
 */
export function tipoDeMeta(type: string): ChatMensajeTipo {
  return TIPOS_META[type] ?? "otro";
}

/** Tipos de dominio que consumen `metaMediaSchema` (los cinco adjuntos). */
const TIPOS_CON_MEDIA: ReadonlySet<ChatMensajeTipo> = new Set<ChatMensajeTipo>([
  "imagen",
  "audio",
  "video",
  "documento",
  "sticker",
]);

/** Mensaje crudo de Meta ya validado por zod (forma interna; no cruza fronteras). */
type MetaMessage = z.infer<typeof metaMessageSchema>;

/** Devuelve el sub-objeto de media que corresponda al `type` crudo, o `undefined`. */
function mediaCrudaDe(m: MetaMessage): z.infer<typeof metaMediaSchema> {
  switch (m.type) {
    case "image":
      return m.image;
    case "audio":
      return m.audio;
    case "video":
      return m.video;
    case "document":
      return m.document;
    case "sticker":
      return m.sticker;
    default:
      return undefined;
  }
}

/**
 * Feature 308 (design §2.2, R1/R3) — helper PURO: normaliza el adjunto de un entrante de media.
 * `null` cuando no hay identificador utilizable ⇒ el mensaje se degrada a `otro` (R3). No lanza.
 */
export function normalizarMedia(m: MetaMessage): WebhookMensajeEntrante["media"] | null {
  const cruda = mediaCrudaDe(m);
  if (cruda === undefined || cruda.id.trim() === "") return null;
  return {
    mediaId: cruda.id,
    mediaMime: cruda.mime_type ?? null,
    mediaNombre: cruda.filename ?? null,
    mediaTamanoBytes: cruda.file_size ?? null,
  };
}

/**
 * Feature 308 (R2) — el pie de foto de un adjunto es el CUERPO del mensaje: no tiene columna
 * propia. Asi la linkificacion del texto funciona igual sobre el caption de una imagen.
 */
export function captionDeMedia(m: MetaMessage): string | null {
  return mediaCrudaDe(m)?.caption ?? null;
}

/**
 * Feature 308 (design §2.2, R4/R5/R6) — helper PURO: normaliza una reaccion.
 * - Sin `message_id` ⇒ `null` ⇒ el mensaje se degrada a `otro` (R6).
 * - `emoji` ausente o cadena vacia ⇒ `emoji: null`, que es la reaccion RETIRADA (R5), NO una
 *   reaccion con emoji vacio: el agregado del hilo la usa para BORRAR la anterior.
 */
export function normalizarReaccion(m: MetaMessage): WebhookMensajeEntrante["reaccion"] | null {
  const cruda = m.reaction;
  if (cruda === undefined || cruda.message_id.trim() === "") return null;
  const emoji = cruda.emoji?.trim();
  return {
    objetivoWaMessageId: cruda.message_id,
    emoji: emoji === undefined || emoji === "" ? null : emoji,
  };
}

/** Compone una direccion de Meta (troceada) en una sola linea legible; `null` si queda vacia. */
function componerDireccion(dir: {
  street?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  zip?: string | undefined;
  country?: string | undefined;
}): string | null {
  const linea = [dir.street, dir.city, dir.state, dir.zip, dir.country]
    .map((p) => p?.trim())
    .filter((p): p is string => p !== undefined && p !== "")
    .join(", ");
  return linea === "" ? null : linea;
}

/**
 * Feature 308 (design §2.2, R7/R8) — helper PURO: normaliza `contacts`. Descarta los contactos
 * sin ningun dato utilizable; lista resultante vacia ⇒ `null` ⇒ degradacion a `otro` (R8).
 * No lanza y no loguea: el contenido de un contacto es PII de un tercero (R35).
 */
export function normalizarContactos(m: MetaMessage): ChatContactoNormalizado[] | null {
  const crudos = m.contacts;
  if (crudos === undefined || crudos.length === 0) return null;

  const contactos: ChatContactoNormalizado[] = [];
  for (const c of crudos) {
    const nombre =
      c.name?.formatted_name?.trim() ||
      [c.name?.first_name, c.name?.last_name]
        .map((p) => p?.trim())
        .filter((p): p is string => p !== undefined && p !== "")
        .join(" ");
    const telefonos = (c.phones ?? [])
      .map((p) => ({ valor: (p.phone ?? p.wa_id ?? "").trim(), tipo: p.type ?? null }))
      .filter((p) => p.valor !== "");
    const correos = (c.emails ?? [])
      .map((e) => ({ valor: (e.email ?? "").trim(), tipo: e.type ?? null }))
      .filter((e) => e.valor !== "");
    const direcciones = (c.addresses ?? [])
      .map(componerDireccion)
      .filter((d): d is string => d !== null);
    const organizacion = c.org?.company?.trim();
    const urls = (c.urls ?? [])
      .map((u) => u.url?.trim())
      .filter((u): u is string => u !== undefined && u !== "");

    // Un contacto sin NADA que pintar no se guarda: seria una tarjeta vacia.
    const vacio =
      nombre === "" &&
      telefonos.length === 0 &&
      correos.length === 0 &&
      direcciones.length === 0 &&
      urls.length === 0 &&
      (organizacion === undefined || organizacion === "");
    if (vacio) continue;

    contactos.push({
      nombre,
      telefonos,
      correos,
      direcciones,
      organizacion: organizacion === undefined || organizacion === "" ? null : organizacion,
      urls,
    });
  }

  return contactos.length === 0 ? null : contactos;
}

/**
 * Feature 308 (R9/P1) — subtipos de `system` que significan "el cliente cambio de numero".
 *
 * SON TRES A PROPOSITO. La Cloud API ha usado los tres nombres para el MISMO evento
 * (`user_changed_number` es el antiguo) y el repo apunta a `v21.0`
 * (`lib/config/whatsapp.ts`), donde el evento NO se llama asi. Casar solo contra el literal
 * antiguo dejaria R9 muerto en silencio, y ningun test lo delataria porque los tests usan el
 * mismo payload supuesto que el codigo. El criterio real es el NUMERO NUEVO, no el nombre.
 */
const SUBTIPOS_CAMBIO_NUMERO: ReadonlySet<string> = new Set([
  "user_changed_number",
  "customer_changed_number",
  "customer_identity_changed",
]);

/**
 * Feature 308 (design §2.2, R9/R10) — helper PURO: normaliza el cambio de numero del cliente.
 *
 * Cascada tolerante para el numero NUEVO (`system.wa_id ?? system.new_wa_id ?? system.customer`)
 * porque la forma ha variado entre versiones y el repo NO tiene un payload real capturado (P1).
 * El ANTERIOR es el `from` del propio mensaje. Sin numero nuevo utilizable ⇒ `null` ⇒ el mensaje
 * se degrada y NO se migra ningun hilo: no se inventan numeros (R10).
 */
export function normalizarSistema(m: MetaMessage): WebhookMensajeEntrante["sistema"] | null {
  const sistema = m.system;
  if (sistema === undefined) return null;
  const subtipo = sistema.type?.trim();
  if (subtipo === undefined || !SUBTIPOS_CAMBIO_NUMERO.has(subtipo)) return null;

  const nuevoCrudo = sistema.wa_id ?? sistema.new_wa_id ?? sistema.customer;
  if (nuevoCrudo === undefined) return null;
  const telefonoNuevo = normalizarTelefonoWa(nuevoCrudo);
  if (telefonoNuevo === "") return null;

  const anterior = normalizarTelefonoWa(m.from);
  return { telefonoAnterior: anterior === "" ? null : anterior, telefonoNuevo };
}

/**
 * Valida el payload crudo (strip, R5) y lo NORMALIZA a `WebhookEventos`. Recorre
 * `entry[].changes[].value` aplanando mensajes entrantes y statuses. Los statuses con un
 * valor que no reconocemos (p. ej. futuros de Meta) se DESCARTAN silenciosamente: no son
 * accionables y no deben romper el 200 (R9). `throwOnInvalid` deja que el caller decida.
 */
export function parseWebhookEventos(raw: unknown): WebhookEventos {
  const parsed = whatsappWebhookPayloadSchema.parse(raw);
  const mensajes: WebhookMensajeEntrante[] = [];
  const statuses: WebhookStatus[] = [];

  for (const entry of parsed.entry) {
    for (const change of entry.changes) {
      for (const m of change.value.messages ?? []) {
        // Feature 121 (design §2, R1/R3): normaliza `type=location`. Si trae coords numericas
        // VALIDAS (rango geografico), es un entrante `ubicacion` con sus lat/lng; si no (coords
        // ausentes, no numericas -zod las descarta- o fuera de rango), se DEGRADA a `otro` sin
        // coords, sin lanzar (no rompe el 200 del lote). No se loguea la coordenada (R15).
        let tipo = tipoDeMeta(m.type);
        let ubicacion: WebhookMensajeEntrante["ubicacion"];
        if (tipo === "ubicacion") {
          const loc = m.location;
          if (loc !== undefined && esCoordenadaValida(loc.latitude, loc.longitude)) {
            ubicacion = { latitud: loc.latitude, longitud: loc.longitude };
          } else {
            tipo = "otro"; // location sin coords validas: se degrada (R3)
          }
        }

        // Feature 308 (design §2.2): un tipo mapeado cuyo sub-objeto no trae lo ESENCIAL se
        // degrada a `otro` sin lanzar y sin romper el lote (R3/R6/R8/R10). Ninguna rama de
        // aqui loguea nada: el cuerpo, el caption, el numero y los contactos son PII (R35).
        let media: WebhookMensajeEntrante["media"];
        let cuerpo = m.text?.body ?? null;
        if (TIPOS_CON_MEDIA.has(tipo)) {
          const normalizada = normalizarMedia(m);
          if (normalizada === null) {
            tipo = "otro"; // media sin id utilizable: no hay binario que bajar (R3)
          } else {
            media = normalizada;
            cuerpo = captionDeMedia(m); // R2: el caption ES el cuerpo; sin caption, null
          }
        }

        let reaccion: WebhookMensajeEntrante["reaccion"];
        if (tipo === "reaccion") {
          const normalizada = normalizarReaccion(m);
          if (normalizada === null) tipo = "otro"; // sin objetivo no hay a que anclarla (R6)
          else reaccion = normalizada;
        }

        let contactos: WebhookMensajeEntrante["contactos"];
        if (tipo === "contactos") {
          const normalizados = normalizarContactos(m);
          if (normalizados === null) tipo = "otro"; // lista ausente, vacia o inutilizable (R8)
          else contactos = normalizados;
        }

        let sistema: WebhookMensajeEntrante["sistema"];
        if (tipo === "sistema") {
          const normalizado = normalizarSistema(m);
          // Sin numero nuevo determinable NO se migra nada y no se inventan numeros (R10).
          // Un `system` de otro subtipo (fuera de alcance) cae igualmente en `otro`.
          if (normalizado === null) tipo = "otro";
          else sistema = normalizado;
        }

        mensajes.push({
          waMessageId: m.id,
          telefonoE164: m.from,
          tipo,
          cuerpo,
          ...(ubicacion !== undefined ? { ubicacion } : {}),
          ...(media !== undefined ? { media } : {}),
          ...(reaccion !== undefined ? { reaccion } : {}),
          ...(contactos !== undefined ? { contactos } : {}),
          ...(sistema !== undefined ? { sistema } : {}),
          ocurridoAt: timestampAMeta(m.timestamp),
        });
      }
      for (const s of change.value.statuses ?? []) {
        const estado = ESTADOS_META[s.status];
        if (estado === undefined) continue; // no accionable -> se descarta (R9)
        statuses.push({
          waMessageId: s.id,
          estado,
          ocurridoAt: timestampAMeta(s.timestamp),
          error: primerError(s.errors),
        });
      }
    }
  }

  return { mensajes, statuses };
}
