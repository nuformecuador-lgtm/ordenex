/**
 * Feature 108/T1 — helper compartido de validación de URL de webhook.
 *
 * R6 (feature 105) exige que la URL de callback sea `https`. El schema base
 * `registrarWebhookSchema` solo garantiza `min(1)`; el refuerzo `https` vive aquí,
 * en un único origen consumido por `RegistrarWebhookForm` (gestión por fila) y por
 * `GenerarApiKeyForm` (alta con webhook opcional). No duplica reglas de forma.
 */

/** `true` si `url` es una URL `https` válida. */
export function esHttpsValida(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
