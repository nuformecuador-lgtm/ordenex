// Feature 255 (design.md §2.3) — mensajes FIJOS del borde de cotizacion por API key.
//
// Viven aqui, en `lib/`, y NO inline en el route handler, por una razon concreta: la cadena
// del 409 es contrato publicado (aparece en `lib/api/openapi-spec.ts` y en su espejo `.yaml`),
// asi que necesita UN solo dueño. Duplicarla en la ruta la convertiria en dos cadenas que
// divergen a la primera errata corregida.

/**
 * R13/R16 — la tienda del actor no tiene ninguna tarifa cotizable (`deleted_at IS NULL` +
 * `status = 'activo'`). Se traduce a `409 CONFLICT`, no a 422: el cuerpo del integrador es
 * valido; lo que falta es una precondicion del ESTADO de la cuenta.
 *
 * El mensaje NO nombra la tienda, ni la API key, ni su hash, ni ningun dato de ninguna fila
 * (R16/R49): es una cadena constante, sin interpolacion, y esa es su garantia.
 */
export const MSG_COTIZACION_SIN_TARIFA =
  "la tienda no tiene una tarifa vigente asociada: no se puede cotizar";
