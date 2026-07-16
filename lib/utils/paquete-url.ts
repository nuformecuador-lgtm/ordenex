// URL pública del "paquete" (detalle de una orden) a la que apunta el QR de la
// etiqueta. El QR codifica una URL absoluta `<origin>/paquete/<numGuia>` para que
// una cámara externa (no el escáner in-app) la abra en el navegador; la ruta valida
// sesión (middleware) y muestra los detalles. El escáner de recepción (feature 33)
// escanea el MISMO QR, por eso `extractNumGuiaFromScan` devuelve el `num_guia` (Int,
// UNIQUE en `orden`) que la URL codifica. CORTE LIMPIO: el QR ya NO codifica
// `orden.id` (UUID) y NO se acepta un UUID escaneado; las etiquetas impresas con el
// formato anterior dejan de escanear y se reimprimen.

/** Segmento base de la ruta de detalle del paquete. */
export const PAQUETE_BASE_PATH = "/paquete";

/** Un `num_guia` válido en la URL: entero positivo en base 10, sin signo ni relleno. */
const NUM_GUIA_PATTERN = /^\d+$/;

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
 * Construye la URL absoluta del paquete a partir del `num_guia` de la orden.
 * `origin` por defecto se resuelve del env `NEXT_PUBLIC_APP_URL` (ver
 * `resolveAppOrigin`); se puede inyectar en tests o en contextos donde se quiera
 * forzar un origin distinto.
 */
export function buildPaqueteUrl(numGuia: number, origin?: string): string {
  const base = origin ?? resolveAppOrigin();
  return `${base}${PAQUETE_BASE_PATH}/${numGuia}`;
}

/** Parsea un segmento a `num_guia`: entero positivo estricto o `null`. */
function parseNumGuia(segment: string): number | null {
  if (!NUM_GUIA_PATTERN.test(segment)) return null; // "123abc" / "" / "-1" / "1.5"
  const n = Number(segment);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Extrae el `num_guia` de un valor escaneado. Espera la URL del paquete
 * (`.../paquete/<numGuia>`) y devuelve el entero del último segmento del path.
 * Devuelve `null` si el valor no es una URL o si el último segmento no es un entero
 * positivo válido (incluido el UUID pelado de etiquetas antiguas: NO hay
 * retrocompatibilidad). Siempre `trim`. Robusto ante barra final.
 */
export function extractNumGuiaFromScan(scanned: string): number | null {
  const text = scanned.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null; // No es una URL del paquete: no hay num_guia que extraer.
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (last === undefined) return null;
  return parseNumGuia(last);
}
