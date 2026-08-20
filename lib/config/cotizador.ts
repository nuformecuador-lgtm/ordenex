// Feature 248 (D16/R27) — umbrales del cotizador. Sobreescribibles por variable de entorno,
// con el defecto en codigo (patron `lib/config/rastreo-publico.ts`, principio 4 de
// `docs/architecture.md`: "Sin hardcode de contexto").
//
// El tope de `cantidad` (1..1000) es la firma 5 del gate humano del 2026-08-20. Vive AQUI y no
// en el service ni en el schema zod a proposito: el modulo que APLICA el tope no lo escribe.
// La cotizacion multiple es una multiplicacion, asi que el tope no protege de coste de computo
// sino de respuestas absurdas (mismo espiritu que `cargaMasivaConfig.MAX_CHUNK_ROWS`).

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface CotizadorConfig {
  /** Minimo de ordenes por cotizacion. Ambos extremos se ACEPTAN (R27). */
  CANTIDAD_MIN: number;
  /** Maximo de ordenes por cotizacion (firma 5: 1..1000). */
  CANTIDAD_MAX: number;
  /** Cantidad aplicada cuando el parametro viene ausente (R25). */
  CANTIDAD_POR_DEFECTO: number;
}

export function loadCotizadorConfig(): CotizadorConfig {
  const min = readPositiveInt("COTIZADOR_CANTIDAD_MIN", 1);
  const max = readPositiveInt("COTIZADOR_CANTIDAD_MAX", 1000);
  return {
    CANTIDAD_MIN: min,
    CANTIDAD_MAX: max,
    CANTIDAD_POR_DEFECTO: min,
  };
}

/**
 * Instantanea al cargar el modulo. El schema zod del borde se construye una sola vez (es una
 * constante de modulo), asi que lee de aqui; un service que necesite releer el entorno llama a
 * `loadCotizadorConfig()`.
 */
export const cotizadorConfig: CotizadorConfig = loadCotizadorConfig();
