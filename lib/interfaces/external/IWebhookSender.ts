// Feature 99 (design §4) — contrato del cliente de entrega de webhooks. Vive en
// `interfaces/external/` (docs/architecture.md §Interfaces) junto a IGeocodeClient /
// IEmailProvider / IFileStorage.
//
// El cliente TRADUCE el resultado HTTP a vocabulario de DOMINIO y NO decide politica
// (completar el job vs lanzar para reintento): eso vive en `WebhookEstadoService` (design
// §7), como hizo la 91 con la geocodificacion. Asi la tabla de desenlace es testeable sin
// red. El `detalle` del resultado NUNCA incluye la URL completa ni el cuerpo (R29).

export type WebhookOutcome =
  /** 2xx: entrega aceptada por el callback. */
  | { status: "ok" }
  /** no-2xx | timeout | fallo de red. Reintentable; `detalle` sin URL ni cuerpo (R29). */
  | {
      status: "transitorio";
      detalle: string;
      /**
       * FICHA 403 (R14/R15, design §6) — cuanto pide ESPERAR el destino, en ms, cuando lo dice.
       *
       * Hoy solo lo rellena un HTTP 429 con una cabecera `Retry-After` interpretable (segundos
       * delta o fecha HTTP, RFC 7231 §7.1.3). `undefined` en todo lo demas —incluido un 429 con
       * `Retry-After` ausente o ilegible (R15)—, y entonces la cola aplica su backoff exponencial
       * generico, exactamente como hasta hoy.
       *
       * ES UNA SUGERENCIA, NO UNA ORDEN: `JobQueueService` la acota por los dos lados (nunca menor
       * que el backoff que ya tocaba, nunca mayor que `JOBS_BACKOFF_CAP_MS`, R17), de modo que un
       * `Retry-After: 999999999` de un destino hostil o malformado no puede bloquear un job.
       *
       * Y NO altera el conteo de intentos: un 429 sigue gastando uno de los 5 de
       * `MAX_INTENTOS_WEBHOOK` y muriendo al quinto, igual que cualquier otro fallo (R16).
       */
      retryAfterMs?: number;
    };

export interface IWebhookSender {
  /**
   * Hace POST del `cuerpo` (JSON serializado) a `url` con las `headers` dadas (firma +
   * timestamp). NUNCA lanza por un desenlace HTTP: todos se devuelven como `WebhookOutcome`.
   */
  entregar(
    url: string,
    cuerpo: string,
    headers: Record<string, string>,
  ): Promise<WebhookOutcome>;
}
