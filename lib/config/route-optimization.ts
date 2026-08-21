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
// account y OAuth2. Es un override consciente del humano (design §9.A), no un descuido: la
// alternativa `computeRoutes` con `optimizeWaypointOrder`, que si reusaria la key, quedo
// descartada explicitamente.
//
// TRES MODOS DE OBTENER EL TOKEN (el selector vive en `construirTokenProvider`, ver
// `lib/auth/google-sa-token.ts` y `specs/92-.../credenciales-google.md`): ADC en local, WIF
// keyless en produccion, JWT-bearer con clave privada como fallback. ESTA config solo LEE
// las piezas de los tres; no decide cual se usa ni valida que esten completas.

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

/**
 * Secreto con NOMBRE ALTERNATIVO. Existe porque el entorno ya desplegado nombra las piezas
 * de WIF `GOOGLE_CLOUD_WORKLOAD_IDENTITY_*` / `GOOGLE_CLOUD_PROJECT_NUMBER`, mientras que el
 * nombre canonico del codigo es `GOOGLE_WIF_*`. Se aceptan LOS DOS para no obligar a
 * renombrar variables ya configuradas en Vercel; el canonico gana si ambos estan presentes.
 * Si algun dia el entorno queda unificado, borrar el alias es un cambio de una linea.
 *
 * EL PROJECT ID LO USA POR OTRO MOTIVO (ficha 251): ahi el alias no evita un renombrado,
 * corrige una TRAMPA. `RutaNoConfiguradoError` se lanza citando `GOOGLE_ROUTE_OPT_PROJECT_ID`
 * (`google-sa-token.ts`), pero durante meses el UNICO nombre que se leia era
 * `GOOGLE_CLOUD_PROJECT_ID`: quien seguia el mensaje al pie de la letra creaba en Vercel una
 * variable que el codigo jamas miraba, y el log seguia diciendo exactamente lo mismo. Aceptar
 * los dos hace que el error y la lectura no puedan volver a divergir.
 */
function readSecretConAlias(canonico: string, alias: string): string | null {
  return readSecret(canonico) ?? readSecret(alias);
}

/**
 * Flag booleano: SOLO la cadena `"true"` (sin distinguir mayusculas) activa. Cualquier otro
 * valor —incluido `"1"`, `"yes"` o un typo— cuenta como desactivado. Deliberado: este flag
 * conmuta a ADC, que en produccion NO funciona (no hay identidad ambiente en Vercel), asi
 * que un valor ambiguo debe caer del lado seguro.
 */
function readBool(name: string): boolean {
  return (readSecret(name) ?? "").toLowerCase() === "true";
}

/**
 * Preferencia de enrutado del TRAZADO (`computeRoutes`). No afecta a la optimizacion.
 *
 *   `TRAFFIC_UNAWARE`       — sin trafico. Es el default de Google y el nuestro. SKU basico.
 *   `TRAFFIC_AWARE`         — trafico en vivo. SKU Advanced: mas caro por llamada.
 *   `TRAFFIC_AWARE_OPTIMAL` — mas precision, mas latencia y mas coste todavia.
 *
 * La GEOMETRIA apenas cambia entre los tres; lo que cambia de verdad es `duration`. Por eso
 * el default se queda en `TRAFFIC_UNAWARE`: hoy la linea se dibuja, el ETA no se muestra.
 */
export type RoutingPreference =
  | "TRAFFIC_UNAWARE"
  | "TRAFFIC_AWARE"
  | "TRAFFIC_AWARE_OPTIMAL";

const ROUTING_PREFERENCES: readonly RoutingPreference[] = [
  "TRAFFIC_UNAWARE",
  "TRAFFIC_AWARE",
  "TRAFFIC_AWARE_OPTIMAL",
];

/**
 * Enum de `process.env` con lista blanca. Un valor desconocido —typo incluido— cae al
 * default en vez de viajar a Google y provocar un 400 que apagaria el trazado entero.
 * Cae del lado BARATO a proposito: un typo nunca debe subir de SKU sin que nadie lo pida.
 */
function readRoutingPreference(name: string): RoutingPreference {
  const raw = (readSecret(name) ?? "").toUpperCase();
  return ROUTING_PREFERENCES.find((p) => p === raw) ?? "TRAFFIC_UNAWARE";
}

export interface RouteOptimizationConfig {
  /**
   * Proyecto GCP donde esta habilitado el SKU de Route Optimization. `null` si falta.
   * Alias aceptado: `GOOGLE_CLOUD_PROJECT_ID` (el nombre con el que ya vive en `.env`).
   */
  GOOGLE_ROUTE_OPT_PROJECT_ID: string | null;
  /** Email de la service account (claim `iss` del JWT). `null` si falta. */
  GOOGLE_ROUTE_OPT_SA_EMAIL: string | null;
  /**
   * Clave privada PEM de la service account. En Vercel los saltos de linea viajan
   * escapados como `\n` literales: se desescapan aqui, que es el UNICO sitio que conoce
   * el formato del transporte. NUNCA se loguea ni se propaga en un mensaje de error (R14).
   */
  GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: string | null;
  /**
   * Numero (no id) del proyecto GCP que hospeda el pool de WIF. Alias aceptado:
   * `GOOGLE_CLOUD_PROJECT_NUMBER`. `null` si falta.
   */
  GOOGLE_WIF_PROJECT_NUMBER: string | null;
  /** Id del Workload Identity Pool. Alias: `GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_ID`. */
  GOOGLE_WIF_POOL_ID: string | null;
  /**
   * Id del provider OIDC dentro del pool. Alias:
   * `GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`.
   */
  GOOGLE_WIF_PROVIDER_ID: string | null;
  /**
   * SOLO DESARROLLO LOCAL: fuerza el modo ADC (`gcloud auth application-default login`).
   * En Vercel no hay identidad ambiente, asi que activarlo en produccion rompe el modo real.
   */
  GOOGLE_ROUTE_OPT_USE_ADC: boolean;
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
  /**
   * Preferencia de trafico del TRAZADO. Default `TRAFFIC_UNAWARE` (SKU basico): subirlo
   * cuesta dinero por llamada, asi que es una decision explicita, nunca implicita.
   */
  ROUTES_ROUTING_PREFERENCE: RoutingPreference;
}

export function loadRouteOptimizationConfig(): RouteOptimizationConfig {
  const pem = readSecret("GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY");
  return {
    GOOGLE_ROUTE_OPT_PROJECT_ID: readSecretConAlias(
      "GOOGLE_ROUTE_OPT_PROJECT_ID",
      "GOOGLE_CLOUD_PROJECT_ID",
    ),
    GOOGLE_ROUTE_OPT_SA_EMAIL: readSecret("GOOGLE_ROUTE_OPT_SA_EMAIL"),
    GOOGLE_ROUTE_OPT_SA_PRIVATE_KEY: pem === null ? null : pem.replace(/\\n/g, "\n"),
    GOOGLE_WIF_PROJECT_NUMBER: readSecretConAlias(
      "GOOGLE_WIF_PROJECT_NUMBER",
      "GOOGLE_CLOUD_PROJECT_NUMBER",
    ),
    GOOGLE_WIF_POOL_ID: readSecretConAlias(
      "GOOGLE_WIF_POOL_ID",
      "GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_ID",
    ),
    GOOGLE_WIF_PROVIDER_ID: readSecretConAlias(
      "GOOGLE_WIF_PROVIDER_ID",
      "GOOGLE_CLOUD_WORKLOAD_IDENTITY_POOL_PROVIDER_ID",
    ),
    GOOGLE_ROUTE_OPT_USE_ADC: readBool("GOOGLE_ROUTE_OPT_USE_ADC"),
    ROUTE_OPT_TIMEOUT_MS: readPositiveInt("ROUTE_OPT_TIMEOUT_MS", 20_000),
    RUTA_DEBOUNCE_S: readPositiveInt("RUTA_DEBOUNCE_S", 60),
    RUTA_ORIGEN_TTL_MIN: readPositiveInt("RUTA_ORIGEN_TTL_MIN", 120),
    RUTA_SYNC_MIN_INTERVALO_S: readPositiveInt("RUTA_SYNC_MIN_INTERVALO_S", 10),
    RUTA_MAX_PARADAS: readPositiveInt("RUTA_MAX_PARADAS", 100),
    ROUTES_ROUTING_PREFERENCE: readRoutingPreference("ROUTES_ROUTING_PREFERENCE"),
  };
}
