// Feature 99 (design §9) — contrato del servicio de registro de la suscripcion de webhook.
// Es PURO y testeable sin controller: no conoce HTTP ni Prisma. La autenticacion/rol la
// resuelve la Server Action (`lib/actions/webhooks.ts`, D1). Todas las operaciones estan
// keyed por `ownerUsuarioId`, de modo que un owner NUNCA puede operar la suscripcion de otro
// (R9): el aislamiento es estructural, no una comprobacion olvidable.

export interface RegistrarWebhookInput {
  /** Owner (usuario dedicado de la API key) al que pertenece la suscripcion. */
  ownerUsuarioId: string;
  /** URL de callback https (validada en el borde, R5). */
  url: string;
}

export type RegistrarWebhookResult =
  /** R7: el secreto EN CLARO se devuelve UNA sola vez, aqui; nunca mas. */
  | { status: "ok"; secret: string }
  /** R5: URL no absoluta o no https; no se persiste nada. */
  | { status: "validation_error"; fieldErrors: { url?: string[] } };

export interface WebhookSuscripcionVistaDTO {
  url: string;
  activa: boolean;
}

export interface IWebhookSuscripcionService {
  /** R5/R6/R7: valida la URL, genera y CIFRA el secreto y hace upsert por owner. */
  registrar(input: RegistrarWebhookInput): Promise<RegistrarWebhookResult>;
  /** R8: da de baja la suscripcion del owner (sus ordenes dejan de generar entregas). */
  desactivar(ownerUsuarioId: string): Promise<void>;
  /** R7: consulta para display; NUNCA expone el secreto. `null` si no hay suscripcion. */
  obtener(ownerUsuarioId: string): Promise<WebhookSuscripcionVistaDTO | null>;
}
