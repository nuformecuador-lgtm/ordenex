// Feature 91 (design §2, R33) — configuracion del proveedor de geocodificacion. La
// credencial vive SIEMPRE en variable de entorno `GOOGLE_MAPS_API_KEY`, nunca hardcodeada
// ni en logs. Clon estructural de `lib/config/cron.ts`: ausente o "" -> `null`, y esta
// funcion NUNCA lanza. Es deliberado: el drenado de la cola comparte proceso con
// `liberar_reprogramadas`, y una excepcion al CARGAR la config tumbaria toda la corrida.
// La ausencia de credencial la decide el handler, job a job (R25).

/** Lee un entero POSITIVO de `process.env`; ausente/vacio/invalido -> `fallback`. */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface GeocodeConfig {
  /** Credencial del proveedor (R33). `null` si no esta configurada: NO se lanza aqui. */
  GOOGLE_MAPS_API_KEY: string | null;
  /** Timeout de la llamada HTTP al proveedor en ms. Default 10_000. */
  GEOCODE_TIMEOUT_MS: number;
}

export function loadGeocodeConfig(): GeocodeConfig {
  const raw = process.env.GOOGLE_MAPS_API_KEY;
  return {
    GOOGLE_MAPS_API_KEY: raw !== undefined && raw !== "" ? raw : null,
    GEOCODE_TIMEOUT_MS: readPositiveInt("GEOCODE_TIMEOUT_MS", 10_000),
  };
}
