// Feature 136 — Configuracion del PDF consolidado de etiquetas de guia generado
// tras la carga por API. Sin hardcode de contexto (docs/architecture.md, R18):
// el nombre del bucket privado, el TTL de la URL firmada y el TOPE de etiquetas
// por PDF se resuelven por variable de entorno con un valor por defecto (patron
// de lib/config/gestion.ts).

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Acota un entero al rango [min, max] (clamp defensivo de las env). */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Cota superior del TTL de la URL firmada: 24 h. `readPositiveInt` acepta
 * CUALQUIER positivo, asi que sin este clamp una env equivocada (p. ej. los
 * segundos de un año) dejaria el PDF del lote —con los datos de todas las
 * ordenes de la tienda— accesible durante ese tiempo para quien tuviera el
 * enlace. El default (1 h) ya es sano; el clamp solo evita el pie de plomo.
 */
export const MAX_SIGNED_URL_TTL_SECONDS = 86_400;

/**
 * Feature 177 (R24): TTL por defecto de las URL firmadas que entregan los endpoints
 * `/generate` de la API de consulta. 5 min, igual que las evidencias de la 106.
 */
const DEFAULT_API_SIGNED_URL_TTL_SECONDS = 300;

/**
 * Tope de etiquetas por PDF: default y techo duro.
 *
 * BLOQ-1 del review de la 136: el builder gasta tiempo y memoria LINEALES en el
 * numero de etiquetas (medido con las deps reales y `compress: true`: ~18 ms y
 * ~3.3 KB de PDF por etiqueta; RSS ~312 MB para 400). El lote de la carga por
 * API admite hasta `cargaMasivaConfig.MAX_CHUNK_ROWS` (5000) filas: sin tope, el
 * render costaria ~90 s y desbordaria la memoria de la function. Ese fallo
 * ocurre DESPUES de commitear las ordenes y NO es una excepcion JS capturable
 * (OOM / timeout de plataforma), asi que el integrador recibiria 500/504 en vez
 * del 200 que exige R12 y perderia los `num_guia` ya asignados.
 *
 * Default 300 (~5.6 s de render, ~1 MB de PDF, ~270 MB de RSS): entra holgado en
 * el presupuesto de la ruta (`maxDuration = 60`, que ademas paga la insercion
 * del lote). El techo 1000 (~18 s) es lo maximo que un operador puede pedir por
 * env sin comprometer ese presupuesto.
 */
export const MAX_ETIQUETAS_POR_PDF_HARD_CAP = 1_000;
const DEFAULT_MAX_ETIQUETAS_POR_PDF = 300;

export interface EtiquetasConfig {
  /** Nombre del bucket PRIVADO de Supabase Storage para los PDF de etiquetas (R8/R9). */
  ETIQUETAS_BUCKET: string;
  /**
   * TTL (segundos) de la URL firmada del PDF del lote (R10). Default 3600 (1 h),
   * acotado a `MAX_SIGNED_URL_TTL_SECONDS`.
   */
  SIGNED_URL_TTL_SECONDS: number;
  /**
   * TTL (segundos) de la URL firmada que devuelven los endpoints `/generate` de la
   * API de consulta por orden y por carga (feature 177, R24/R43). Default 300 (5 min),
   * acotado a `MAX_SIGNED_URL_TTL_SECONDS`.
   *
   * Es una clave APARTE de `SIGNED_URL_TTL_SECONDS` a proposito: ese valor (3600)
   * gobierna la URL que devuelve la carga por API de la 136/141 y bajarlo cambiaria
   * ese contrato de contrabando.
   */
  API_SIGNED_URL_TTL_SECONDS: number;
  /**
   * Tope de etiquetas admitidas en un mismo PDF. Por encima, la carga por API NO
   * intenta generarlo: responde 200 con `etiquetasPdf: { error }` (R12) y
   * conserva intactos los `num_guia`. Acotado a
   * `MAX_ETIQUETAS_POR_PDF_HARD_CAP`.
   */
  MAX_ETIQUETAS_POR_PDF: number;
}

export function loadEtiquetasConfig(): EtiquetasConfig {
  return {
    ETIQUETAS_BUCKET: process.env.ETIQUETAS_BUCKET?.trim() || "etiquetas-guia",
    SIGNED_URL_TTL_SECONDS: clamp(
      readPositiveInt("ETIQUETAS_SIGNED_URL_TTL_SECONDS", 3600),
      1,
      MAX_SIGNED_URL_TTL_SECONDS,
    ),
    API_SIGNED_URL_TTL_SECONDS: clamp(
      readPositiveInt("ETIQUETAS_API_SIGNED_URL_TTL_SECONDS", DEFAULT_API_SIGNED_URL_TTL_SECONDS),
      1,
      MAX_SIGNED_URL_TTL_SECONDS,
    ),
    MAX_ETIQUETAS_POR_PDF: clamp(
      readPositiveInt("ETIQUETAS_MAX_POR_PDF", DEFAULT_MAX_ETIQUETAS_POR_PDF),
      1,
      MAX_ETIQUETAS_POR_PDF_HARD_CAP,
    ),
  };
}

export const etiquetasConfig: EtiquetasConfig = loadEtiquetasConfig();
