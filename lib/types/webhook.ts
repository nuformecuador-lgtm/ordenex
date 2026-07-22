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

export type RegistrarWebhookActionResult =
  /** R7: secreto en claro devuelto UNA vez para que F100 lo muestre. */
  | { status: "ok"; secret: string }
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
