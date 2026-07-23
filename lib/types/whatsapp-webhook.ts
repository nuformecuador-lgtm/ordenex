// Feature 109 (design §1/§2.1, R5) — BORDE TIPADO del webhook de entrada de WhatsApp.
// El route handler valida el cuerpo crudo de Meta con estos esquemas zod (que DESCARTAN
// -strip- los campos no reconocidos) y lo NORMALIZA a un tipo de dominio. El service NO
// conoce la forma de Meta: recibe `WebhookEventos` ya limpio (mensajes entrantes + statuses).
//
// zod hace strip por defecto en `.object()`: los campos extra de Meta (contacts, metadata,
// profile, etc.) no rompen el parseo y tampoco sobreviven (R5).
import { z } from "zod";
import type { ChatMensajeTipo, ChatMensajeEstado } from "@prisma/client";

// --- Esquemas de la forma cruda de Meta (solo lo que consumimos; el resto se strip-ea) ---

// Un mensaje ENTRANTE del cliente. `text.body` solo viene en type "text"; otros tipos
// (image, audio, ...) llegan sin cuerpo y se registran como `otro` (alcance v1).
const metaMessageSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).optional(),
});

// Una actualizacion de ESTADO de un saliente. `status` es vocabulario de Meta.
const metaStatusSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  timestamp: z.string().min(1),
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
  ocurridoAt: Date;
}

/** Una actualizacion de estado de entrega de un saliente, normalizada. */
export interface WebhookStatus {
  waMessageId: string;
  estado: ChatMensajeEstado;
  ocurridoAt: Date;
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

/** Convierte el timestamp de Meta (segundos unix como string) a Date. */
function timestampAMeta(ts: string): Date {
  const segundos = Number(ts);
  return Number.isFinite(segundos) ? new Date(segundos * 1000) : new Date(0);
}

/** Mapea el `type` de Meta al enum de dominio. Solo "text" es cuerpo libre en v1. */
function tipoDeMeta(type: string): ChatMensajeTipo {
  return type === "text" ? "texto" : "otro";
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
        mensajes.push({
          waMessageId: m.id,
          telefonoE164: m.from,
          tipo: tipoDeMeta(m.type),
          cuerpo: m.text?.body ?? null,
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
        });
      }
    }
  }

  return { mensajes, statuses };
}
