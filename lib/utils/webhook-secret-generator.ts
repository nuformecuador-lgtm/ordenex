import { randomBytes } from "node:crypto";

// Feature 99 (design §9, R7) — genera el secreto de firma de un webhook. Helper PURO, sin
// efectos: no persiste, no loguea (R29) y no conoce la DB. Mismo patron que
// `lib/utils/api-key-generator.ts`. El secreto se muestra en claro UNA sola vez al registrar
// y se persiste CIFRADO (design §1.3/§3.1).

/** Prefijo identificable del secreto de webhook (patron `ordx_` de la API key). */
export const WEBHOOK_SECRET_PREFIX = "ordx_whsec_";

/** Bytes de entropia: 32 = 256 bits. */
const SECRET_BYTES = 32;

/**
 * Genera un secreto nuevo: `ordx_whsec_` + 32 bytes aleatorios en base64url (256 bits). La
 * aleatoriedad es criptografica (`randomBytes`): dos invocaciones producen secretos
 * distintos.
 */
export function generarWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
}
