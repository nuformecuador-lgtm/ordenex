// Feature 99 (design §2, R28/R32) — configuracion de la entrega de webhooks. Clon
// estructural de `lib/config/geocode.ts` / `lib/config/cron.ts`: ausente o "" -> default (o
// `null` para la clave de cifrado), y esta funcion NUNCA lanza. Es deliberado: el drenado de
// la cola comparte proceso con `liberar_reprogramadas` / `geocodificacion` / `optimizacion_ruta`,
// y una excepcion al CARGAR la config tumbaria toda la corrida. La ausencia de la clave de
// cifrado la decide el handler, job a job (design §1.3/§3.1): sin clave el descifrado lanza
// un error recuperable y el job reintenta cuando la clave este puesta (R32).
//
// `WEBHOOK_MAX_ATTEMPTS` NO es config: `maxIntentos` quedo FIJADO en 5 (D5), constante del
// helper de encolado (`webhook-estado-encolado.ts`), no un env.

/** Lee un entero POSITIVO de `process.env`; ausente/vacio/invalido -> `fallback`. */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface WebhookConfig {
  /** Timeout de la peticion POST al callback en ms. Default 10_000. */
  WEBHOOK_TIMEOUT_MS: number;
  /** Ventana anti-replay en segundos que el consumidor debe tolerar. Default 300. */
  WEBHOOK_REPLAY_WINDOW_S: number;
  /**
   * Clave AES-256-GCM (32 bytes en base64/hex) para descifrar el secreto de firma en la
   * entrega (D2/R32). `null` si no esta configurada: NO se lanza aqui (R28). Sin clave, el
   * descifrado del secreto lanza `WebhookSecretKeyError` recuperable en el handler (R32).
   */
  WEBHOOK_SECRET_ENC_KEY: string | null;
}

export function loadWebhookConfig(): WebhookConfig {
  const rawKey = process.env.WEBHOOK_SECRET_ENC_KEY;
  return {
    WEBHOOK_TIMEOUT_MS: readPositiveInt("WEBHOOK_TIMEOUT_MS", 10_000),
    WEBHOOK_REPLAY_WINDOW_S: readPositiveInt("WEBHOOK_REPLAY_WINDOW_S", 300),
    WEBHOOK_SECRET_ENC_KEY: rawKey !== undefined && rawKey !== "" ? rawKey : null,
  };
}
