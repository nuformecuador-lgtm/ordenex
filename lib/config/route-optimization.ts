// Feature 92 (design §2, R10) — configuracion del proveedor de optimizacion de ruta
// (Google Cloud Route Optimization) y de las guardas de coste de la feature.
//
// CLON ESTRUCTURAL de `lib/config/geocode.ts`: lee `process.env` en CADA llamada, los
// secretos se resuelven a `string | null` y esta funcion NUNCA lanza. Es deliberado: el
// drenador de la cola comparte proceso con `liberar_reprogramadas` y `geocodificacion`, y
// una excepcion al CARGAR la config tumbaria toda la corrida. La ausencia de credencial la
// decide el service, job a job (R12).
//
// ⚠️ LA CREDENCIAL DE LA FEATURE 91 (`GOOGLE_MAPS_API_KEY`) NO SIRVE AQUI. Route
// Optimization (`routeoptimization.googleapis.com`) NO acepta API key: exige una service
// account y OAuth2 (JWT-bearer). Es un override consciente del humano (design §9.A), no un
// descuido: la alternativa `computeRoutes` con `optimizeWaypointOrder`, que si reusaria la
// key, quedo descartada explicitamente.

/** Lee un entero POSITIVO de `process.env`; ausente/vacio/invalido -> `fallback`. */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Secreto: ausente o cadena vacia -> `null`. NUNCA lanza (R10). */
function readSecret(name: string): string | null {
  const raw = process.env[name];
  return raw !== undefined && raw !== "" ? raw : null;
}

export interface RouteOptimizationConfig {
  /** Proyecto GCP donde esta habilitado el SKU de Route Optimization. `null` si falta. */
  GOOGLE_ROUTE_OPT_PROJECT_ID: string | null;
  /** Email de la service account (claim `iss` del JWT). `null` si falta. */
  GOOGLE_ROUTE_OPT_SA_EMAIL: string | null;
  /**
   * Clave privada PEM de la service account. En Vercel los saltos de linea viajan
   * escapados como `\n` literales: se desescapan aqui, que es el UNICO sitio que conoce
   * el formato del transporte. NUNCA se loguea ni se propaga en un mensaje de error (R14).
   */
  GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: string | null;
  /** Timeout de la llamada HTTP al proveedor en ms. Default 20_000. */
  ROUTE_OPT_TIMEOUT_MS: number;
  /** R16: ventana del debounce de la reoptimizacion tras recoger, en segundos. */
  RUTA_DEBOUNCE_S: number;
  /** R24: antiguedad maxima de una ubicacion `gps` para servir de origen, en minutos. */
  RUTA_ORIGEN_TTL_MIN: number;
  /** R34: intervalo minimo entre dos sincronizaciones manuales facturadas, en segundos. */
  RUTA_SYNC_MIN_INTERVALO_S: number;
  /** R38: tope de paradas enviadas al proveedor en una optimizacion. */
  RUTA_MAX_PARADAS: number;
}

export function loadRouteOptimizationConfig(): RouteOptimizationConfig {
  const pem = readSecret("GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY");
  return {
    GOOGLE_ROUTE_OPT_PROJECT_ID: readSecret("GOOGLE_ROUTE_OPT_PROJECT_ID"),
    GOOGLE_ROUTE_OPT_SA_EMAIL: readSecret("GOOGLE_ROUTE_OPT_SA_EMAIL"),
    GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: pem === null ? null : pem.replace(/\\n/g, "\n"),
    ROUTE_OPT_TIMEOUT_MS: readPositiveInt("ROUTE_OPT_TIMEOUT_MS", 20_000),
    RUTA_DEBOUNCE_S: readPositiveInt("RUTA_DEBOUNCE_S", 60),
    RUTA_ORIGEN_TTL_MIN: readPositiveInt("RUTA_ORIGEN_TTL_MIN", 120),
    RUTA_SYNC_MIN_INTERVALO_S: readPositiveInt("RUTA_SYNC_MIN_INTERVALO_S", 10),
    RUTA_MAX_PARADAS: readPositiveInt("RUTA_MAX_PARADAS", 100),
  };
}
