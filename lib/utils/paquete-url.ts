// URL pública del "paquete" (detalle de una orden) a la que apunta el QR de la
// etiqueta. El QR codifica una URL absoluta `<origin>/paquete/<ordenId>` para que
// una cámara externa (no el escáner in-app) la abra en el navegador; la ruta valida
// sesión (middleware) y muestra los detalles. El escáner de recepción (feature 33)
// escanea el MISMO QR, por eso `extractOrdenIdFromScan` acepta tanto la URL como el
// UUID pelado (etiquetas ya impresas), devolviendo siempre el ordenId.

/** Segmento base de la ruta de detalle del paquete. */
export const PAQUETE_BASE_PATH = "/paquete";

/**
 * Construye la URL absoluta del paquete. `origin` por defecto se toma de
 * `window.location.origin` (la etiqueta se renderiza client-side); se puede inyectar
 * en tests o en contextos sin `window`. Sin origin resoluble cae a una ruta relativa.
 */
export function buildPaqueteUrl(ordenId: string, origin?: string): string {
  const base =
    origin ?? (typeof window !== "undefined" ? window.location.origin : "");
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
