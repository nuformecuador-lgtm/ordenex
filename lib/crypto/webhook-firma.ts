import { createHmac } from "node:crypto";

// Feature 99 (design §3, R18) — firma HMAC-SHA256 de la entrega de un webhook. Funcion
// PURA: sin red ni DB. El consumidor recomputa la firma y ademas descarta reenvios fuera de
// la ventana `WEBHOOK_REPLAY_WINDOW_S` (anti-replay) comparando el timestamp de la cabecera.
//
// El secreto NUNCA viaja en la peticion ni en logs (R29): solo su HMAC, que no es
// invertible. Se usa `crypto` de Node (ya disponible; `hashApiKey` usa `createHash`).

/** Cabecera con la firma: `sha256=<hex>` (R18). */
export const WEBHOOK_SIGNATURE_HEADER = "X-Ordenex-Signature";
/** Cabecera con el instante unix de la firma (R18), insumo del anti-replay del consumidor. */
export const WEBHOOK_TIMESTAMP_HEADER = "X-Ordenex-Timestamp";

/**
 * HMAC-SHA256 hex de `${timestampUnix}.${cuerpo}` con el secreto del owner (R18).
 *
 * El timestamp entra en el mensaje firmado: asi un atacante no puede reusar una firma
 * valida con otro timestamp (la firma cambia si el timestamp cambia), y el consumidor liga
 * la firma a un instante concreto para su ventana anti-replay.
 */
export function firmarWebhook(secret: string, timestampUnix: number, cuerpo: string): string {
  return createHmac("sha256", secret).update(`${timestampUnix}.${cuerpo}`, "utf8").digest("hex");
}

/**
 * Construye las cabeceras de firma de una entrega (R18). El secreto NO aparece: solo su HMAC
 * y el timestamp en claro.
 */
export function cabecerasFirma(
  secret: string,
  timestampUnix: number,
  cuerpo: string,
): Record<string, string> {
  return {
    [WEBHOOK_SIGNATURE_HEADER]: `sha256=${firmarWebhook(secret, timestampUnix, cuerpo)}`,
    [WEBHOOK_TIMESTAMP_HEADER]: String(timestampUnix),
  };
}
