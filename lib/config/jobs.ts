// Feature 90 (R21, design §2) — configuracion de la cola de background jobs. Todos los
// parametros se resuelven por variable de entorno con defaults sensatos (nada se hardcodea
// en el codigo de negocio); un valor ausente/invalido cae al default. Espejo de
// `lib/config/reintentos.ts`. El SECRETO de autorizacion NO vive aqui: se reutiliza
// `CRON_SECRET` via `loadCronConfig()` (no se anade un env de secreto nuevo).

/** Lee un entero POSITIVO de `process.env`; ausente/vacio/invalido -> `fallback`. */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface JobsConfig {
  /** Tamano del lote reclamado por corrida del drenador (`claimBatch`/`drenar`). Default 10. */
  JOBS_BATCH_SIZE: number;
  /** `max_intentos` por defecto al encolar (por-fila, override por tipo posible). Default 5. */
  JOBS_MAX_ATTEMPTS: number;
  /** Base del backoff exponencial en ms: `base * 2^(intentos-1)`. Default 60_000 (1 min). */
  JOBS_BACKOFF_BASE_MS: number;
  /** Tope (cap) del backoff exponencial en ms. Default 3_600_000 (1 h). */
  JOBS_BACKOFF_CAP_MS: number;
  /** Umbral de rescate de jobs `processing` colgados (crash) en ms. Default 3_600_000 (1 h). */
  JOBS_VISIBILITY_TIMEOUT_MS: number;
}

export function loadJobsConfig(): JobsConfig {
  return {
    JOBS_BATCH_SIZE: readPositiveInt("JOBS_BATCH_SIZE", 10),
    JOBS_MAX_ATTEMPTS: readPositiveInt("JOBS_MAX_ATTEMPTS", 5),
    JOBS_BACKOFF_BASE_MS: readPositiveInt("JOBS_BACKOFF_BASE_MS", 60_000),
    JOBS_BACKOFF_CAP_MS: readPositiveInt("JOBS_BACKOFF_CAP_MS", 3_600_000),
    JOBS_VISIBILITY_TIMEOUT_MS: readPositiveInt("JOBS_VISIBILITY_TIMEOUT_MS", 3_600_000),
  };
}
