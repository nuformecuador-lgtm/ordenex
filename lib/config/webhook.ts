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
import type { WebhookPausaConfig } from "@/lib/utils/webhook-suscripcion-pausa";

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
  /**
   * ⏳ 2026-08-22 (feature 268/R24, design §7.4) — ORIGIN absoluto de la app con el que se
   * construye `data.evidenciasUrl` del cuerpo del webhook. Se lee de `NEXT_PUBLIC_APP_URL`, el
   * MISMO env que usa `lib/utils/paquete-url.ts` para el QR de la etiqueta: una sola fuente de
   * verdad del origin, nunca un hardcode (`docs/architecture.md`, principio 4).
   *
   * `null` si no se puede resolver (ausente o `""`): entonces el campo se OMITE del cuerpo. NO
   * se emite una ruta relativa ni un `https://undefined/...` (R24). Y esta funcion sigue sin
   * lanzar: el invariante del modulo manda (R28), porque una excepcion al CARGAR la config
   * tumbaria la corrida entera de la cola.
   *
   * Normalizado SIN barra final para no duplicarla al concatenar el path, igual que
   * `resolveAppOrigin` en `paquete-url.ts`.
   *
   * Sobre idempotencia (R25): el origin es CONSTANTE dentro de un despliegue, asi que los cinco
   * intentos del mismo job producen el mismo enlace. Cambiar la base URL es un evento de
   * despliegue, no una variacion entre reintentos.
   */
  WEBHOOK_APP_ORIGIN: string | null;
  /**
   * FICHA 403 (R8, design §2.3) — PISO DE EVIDENCIA del circuito: fallos consecutivos minimos
   * antes de que el reloj pueda pausar. Default 3.
   *
   * Sin este piso, una suscripcion con trafico muy esporadico —un pedido, un fallo aislado y
   * luego silencio REAL durante mas de la ventana porque no llega ningun otro pedido— entraria en
   * pausa la proxima vez que llegara un intento, por el solo transcurso del reloj sobre UN dato.
   */
  WEBHOOK_PAUSA_FALLOS_MINIMOS: number;
  /**
   * FICHA 403 (R8) — VENTANA sin ninguna entrega aceptada, en MS. Default 30 min. Se configura en
   * MINUTOS (`WEBHOOK_PAUSA_VENTANA_MINUTOS`) porque es la unidad en la que se razono y la que
   * aparece en el spec; aqui sale ya en ms para que el predicado no tenga que convertir nada.
   *
   * 30 minutos NO es una intuicion: es el tiempo MEDIDO que estos mismos reintentos dejaron sin
   * turno a la geocodificacion (42 ordenes esperando, ficha 402). El espaciado entra en juego como
   * muy tarde en el mismo margen en el que ya se midio el daño colateral, no despues de repetirlo.
   */
  WEBHOOK_PAUSA_VENTANA_MS: number;
  /**
   * FICHA 403 (R4/R8/R17) — INTERVALO al que se espacian los reintentos de una suscripcion
   * pausada, en ms. Default 3_600_000 (1 h).
   *
   * No es un numero nuevo: es el MISMO tope que ya gobierna cualquier backoff de la cola
   * (`JOBS_BACKOFF_CAP_MS`, default tambien 1 h), o sea el peor caso de espera que este sistema ya
   * considera aceptable para CUALQUIER tipo de job. Reutilizarlo evita que un destino pausado
   * espere mas de lo ya tolerado en cualquier otro sitio — y de hecho `JobQueueService` lo ACOTA
   * a `JOBS_BACKOFF_CAP_MS` pase lo que pase (R17), asi que subir este env por encima del cap no
   * alarga la espera: la cola manda.
   */
  WEBHOOK_PAUSA_INTERVALO_MS: number;
}

/** Lee un origin de `process.env`; ausente/vacio -> `null`. Sin barra final. */
function readOrigin(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const normalizado = raw.replace(/\/+$/, "");
  return normalizado === "" ? null : normalizado;
}

export function loadWebhookConfig(): WebhookConfig {
  const rawKey = process.env.WEBHOOK_SECRET_ENC_KEY;
  return {
    WEBHOOK_TIMEOUT_MS: readPositiveInt("WEBHOOK_TIMEOUT_MS", 10_000),
    WEBHOOK_REPLAY_WINDOW_S: readPositiveInt("WEBHOOK_REPLAY_WINDOW_S", 300),
    WEBHOOK_SECRET_ENC_KEY: rawKey !== undefined && rawKey !== "" ? rawKey : null,
    WEBHOOK_APP_ORIGIN: readOrigin("NEXT_PUBLIC_APP_URL"),
    // FICHA 403 (R8): los tres, mismo patron que el resto del archivo — ausente, vacio o invalido
    // cae al default y esta funcion NUNCA lanza (R28: una excepcion al CARGAR la config tumbaria
    // la corrida entera de la cola, que este tipo de job comparte con otros cinco).
    WEBHOOK_PAUSA_FALLOS_MINIMOS: readPositiveInt("WEBHOOK_PAUSA_FALLOS_MINIMOS", 3),
    WEBHOOK_PAUSA_VENTANA_MS: readPositiveInt("WEBHOOK_PAUSA_VENTANA_MINUTOS", 30) * 60_000,
    WEBHOOK_PAUSA_INTERVALO_MS: readPositiveInt("WEBHOOK_PAUSA_INTERVALO_MS", 3_600_000),
  };
}

/**
 * FICHA 403 — la vista que `estaPausada` necesita, extraida de la config completa. Existe para
 * que ni el repositorio ni el service tengan que saber COMO se llaman los dos envs: reciben el
 * umbral ya en la forma del predicado (`docs/architecture.md`, principio 4).
 */
export function pausaConfigDe(config: WebhookConfig): WebhookPausaConfig {
  return {
    fallosMinimos: config.WEBHOOK_PAUSA_FALLOS_MINIMOS,
    ventanaMs: config.WEBHOOK_PAUSA_VENTANA_MS,
  };
}
