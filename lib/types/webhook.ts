import { z } from "zod";

// Feature 99 (design §9) — schemas y tipos de resultado de la Server Action de webhooks
// (`lib/actions/webhooks.ts`). El borde valida con zod; los resultados son uniones
// discriminadas por `status` (patron `api-key.ts`), sin filtrar internals ni el secreto.

export const registrarWebhookSchema = z.object({
  ownerUsuarioId: z.string().min(1),
  url: z.string().min(1),
});
export type RegistrarWebhookInputRaw = z.infer<typeof registrarWebhookSchema>;

export const desactivarWebhookSchema = z.object({
  ownerUsuarioId: z.string().min(1),
});

/** [gate P4] rotación explícita del secreto: keyed por owner, sin URL. */
export const rotarSecretoWebhookSchema = z.object({
  ownerUsuarioId: z.string().min(1),
});

/** [gate D2] lectura de la suscripción para la UI: keyed por owner, sin URL. */
export const obtenerWebhookSchema = z.object({
  ownerUsuarioId: z.string().min(1),
});

export type RegistrarWebhookActionResult =
  /**
   * R7/R33 (gate P4): ALTA de una suscripción nueva. El secreto en claro se devuelve UNA
   * vez para que F100 lo muestre; nunca más.
   */
  | { status: "creada"; secret: string }
  /**
   * R33 (gate P4): EDICIÓN de una suscripción existente. Solo se actualizó la URL; el
   * secreto se CONSERVA y NO se devuelve (editar la URL no rota el secreto).
   */
  | { status: "actualizada" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: { url?: string[]; ownerUsuarioId?: string[] } }
  /** D3: el owner objetivo no es un usuario de rol `apiKey`. */
  | { status: "owner_invalido" }
  /** R32: `WEBHOOK_SECRET_ENC_KEY` no configurada; no se puede cifrar el secreto. */
  | { status: "config_error" };

export type DesactivarWebhookActionResult =
  | { status: "ok" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: { ownerUsuarioId?: string[] } };

export type RotarSecretoWebhookActionResult =
  /** R34 (gate P4): secreto NUEVO en claro, devuelto UNA vez; invalida el anterior. */
  | { status: "ok"; secret: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: { ownerUsuarioId?: string[] } }
  /** R34: el owner no tiene suscripción que rotar. */
  | { status: "not_found" }
  /** R32: `WEBHOOK_SECRET_ENC_KEY` no configurada; no se puede cifrar el secreto. */
  | { status: "config_error" };

export type ObtenerWebhookActionResult =
  /** R35 (gate D2): vista de la suscripción para la UI; NUNCA el secreto. `null` si no hay. */
  | { status: "ok"; webhook: { url: string; activa: boolean } | null }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: { ownerUsuarioId?: string[] } };
