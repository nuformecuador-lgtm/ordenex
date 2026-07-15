// URL pública del "paquete" (detalle de una orden) a la que apunta el QR de la
// etiqueta. El QR codifica una URL absoluta `<origin>/paquete/<ordenId>` para que
// una cámara externa (no el escáner in-app) la abra en el navegador; la ruta valida
// sesión (middleware) y muestra los detalles. El escáner de recepción (feature 33)
// escanea el MISMO QR, por eso `extractOrdenIdFromScan` acepta tanto la URL como el
// UUID pelado (etiquetas ya impresas), devolviendo siempre el ordenId.

/** Segmento base de la ruta de detalle del paquete. */
export const PAQUETE_BASE_PATH = "/paquete";

/**
 * Origin base de la app. Se toma de `NEXT_PUBLIC_APP_URL` (inlineada por Next tanto
 * en server como en cliente); si no está configurada, cae a `window.location.origin`
 * (client-side) y, en último caso, a cadena vacía (ruta relativa). Se normaliza sin
 * barra final para no duplicarla al concatenar el path.
 */
function resolveAppOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/**
 * Construye la URL absoluta del paquete. `origin` por defecto se resuelve del env
 * `NEXT_PUBLIC_APP_URL` (ver `resolveAppOrigin`); se puede inyectar en tests o en
 * contextos donde se quiera forzar un origin distinto.
 */
export function buildPaqueteUrl(ordenId: string, origin?: string): string {
  const base = origin ?? resolveAppOrigin();
  return `${base}${PAQUETE_BASE_PATH}/${ordenId}`;
}

/**
 * Extrae el ordenId de un valor escaneado. Si es una URL (`.../paquete/<id>`),
 * devuelve el último segmento del path; si no es URL (UUID pelado de etiquetas
 * previas), devuelve el texto tal cual. Siempre `trim`. Robusto ante barra final.
 */
export function extractOrdenIdFromScan(scanned: string): string {
  const text = scanned.trim();
  try {
    const url = new URL(text);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? text;
  } catch {
    // No es una URL: el valor escaneado ES el ordenId (retrocompatibilidad).
    return text;
  }
}
