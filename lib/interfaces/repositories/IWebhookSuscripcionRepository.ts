// Feature 99 (design §5) — contrato del repositorio de suscripciones de webhook. Solo
// queries Prisma (docs/architecture.md §Repository): sin logica de negocio (la validacion de
// URL, la generacion/cifrado del secreto y la autorizacion viven en `WebhookSuscripcionService`).

/** Datos del upsert por owner (R6). `secret` es el CIPHERTEXT (design §1.3), nunca en claro. */
export interface WebhookSuscripcionUpsertData {
  ownerUsuarioId: string;
  url: string;
  secret: string;
}

/** Suscripcion ACTIVA para la ENTREGA (uso server-side). Incluye el ciphertext a descifrar. */
export interface WebhookSuscripcionActiva {
  url: string;
  /** CIPHERTEXT del secreto de firma; el handler lo descifra en memoria para firmar (R32). */
  secret: string;
}

/** Vista de CONSULTA para display (R7): NUNCA incluye el secreto (ni cifrado). */
export interface WebhookSuscripcionVista {
  url: string;
  activa: boolean;
}

export interface IWebhookSuscripcionRepository {
  /** R6: crea o actualiza la suscripcion del owner (upsert por `owner_usuario_id`). Reactiva. */
  upsertByOwner(data: WebhookSuscripcionUpsertData): Promise<void>;
  /**
   * R33 (gate P4): actualiza SOLO la URL de una suscripción existente (y la reactiva),
   * CONSERVANDO el secreto. No-op si el owner no tiene fila. Editar la URL no rota el secreto.
   */
  actualizarUrlByOwner(ownerUsuarioId: string, url: string): Promise<void>;
  /**
   * R34 (gate P4): actualiza SOLO el ciphertext del secreto de una suscripción existente
   * (rotación), CONSERVANDO url/activa. No-op si el owner no tiene fila.
   */
  actualizarSecretoByOwner(ownerUsuarioId: string, secret: string): Promise<void>;
  /**
   * R10/R17/R21/R24: suscripcion ACTIVA del owner, con el ciphertext del secreto para
   * firmar. `null` si no existe o esta inactiva. Uso server-side (entrega), no display.
   */
  findActivaByOwner(ownerUsuarioId: string): Promise<WebhookSuscripcionActiva | null>;
  /** R7: vista de consulta SIN secreto (para la pantalla F100 / obtener). `null` si no hay. */
  findByOwner(ownerUsuarioId: string): Promise<WebhookSuscripcionVista | null>;
  /** R8: da de baja (activa=false) la suscripcion del owner. No-op si no existe. */
  desactivarByOwner(ownerUsuarioId: string): Promise<void>;
  /** D3 (guard del controller): `true` si el owner es un usuario de rol `apiKey`. */
  ownerEsApiKey(ownerUsuarioId: string): Promise<boolean>;
}
