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
  | { status: "transitorio"; detalle: string };

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
