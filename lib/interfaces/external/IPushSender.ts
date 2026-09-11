// FICHA 410 (design §5, T2.3) — contrato del cliente que entrega un push al servicio del
// navegador. Vive en `interfaces/external/` junto a `IWebhookSender` / `IGeocodeClient` /
// `IEmailProvider`, y esta calcado del primero a proposito.
//
// EL CLIENTE TRADUCE, NO DECIDE. Convierte el desenlace HTTP a vocabulario de DOMINIO; la politica
// —borrar la suscripcion, reintentar, terminar el trabajo— vive en `PushWebService`. Asi la tabla
// de desenlaces es testeable SIN RED, que es lo unico que se puede afirmar de verdad en este repo:
// ninguna suite toca un servicio de push real.
//
// ⚠️ `detalle` NUNCA lleva el `endpoint` ni las claves de la suscripcion (R23). Como mucho cita el
// identificador PROPIO de la fila. Un endpoint en un log es la credencial de escritura sobre el
// telefono de una persona.

/** Lo MINIMO que el emisor necesita de una suscripcion. Sin `usuarioId`, sin etiqueta, sin fechas. */
export interface SuscripcionParaEnvio {
  /** Identificador PROPIO de la fila. Es lo unico citable en un log (R23). */
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/**
 * Los cuatro desenlaces posibles de una entrega, en vocabulario de dominio.
 *
 * `caducada` y `rechazada` se separan a proposito aunque las dos terminen el trabajo: la primera
 * OBLIGA a borrar la fila (el navegador retiro esa suscripcion y no volvera, R33) y la segunda NO
 * —un payload mal formado o una clave equivocada es un fallo NUESTRO, y borrar la suscripcion de
 * la persona seria castigarla por nuestro bug—.
 */
export type PushOutcome =
  /** 201/2xx: el servicio de push acepto la entrega. */
  | { status: "ok" }
  /** 404 / 410: la suscripcion esta MUERTA. Borrarla y NO reintentar jamas (R33). */
  | { status: "caducada" }
  /** Red, tiempo agotado, 5xx, 429. Reintentable con tope (R34). `detalle` sin endpoint ni claves. */
  | { status: "transitorio"; detalle: string }
  /** 4xx no recuperable (payload, claves VAPID). NO se reintenta y NO se borra la suscripcion. */
  | { status: "rechazada"; detalle: string };

export interface IPushSender {
  /**
   * Entrega `payload` (JSON ya serializado) a la suscripcion. NUNCA LANZA por un desenlace HTTP:
   * todos se devuelven como `PushOutcome`. Si lanzara, la politica de `PushWebService` se partiria
   * en dos sitios —el `catch` y la tabla— y el dia que alguien anada un caso se olvidaria de uno.
   */
  enviar(suscripcion: SuscripcionParaEnvio, payload: string): Promise<PushOutcome>;
}
