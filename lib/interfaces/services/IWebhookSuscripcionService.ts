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
  /**
   * R33 (gate P4): ALTA. Se generó y cifró un secreto nuevo; se devuelve EN CLARO una sola
   * vez, aqui; nunca mas.
   */
  | { status: "creada"; secret: string }
  /**
   * R33 (gate P4): EDICIÓN de una suscripción existente. Solo se actualizó la URL; el
   * secreto se CONSERVA intacto y NO se devuelve (editar la URL no rota el secreto).
   */
  | { status: "actualizada" }
  /** R5: URL no absoluta o no https; no se persiste nada. */
  | { status: "validation_error"; fieldErrors: { url?: string[] } };

export type RotarSecretoResult =
  /** R34 (gate P4): secreto NUEVO cifrado y persistido; se devuelve EN CLARO una sola vez. */
  | { status: "ok"; secret: string }
  /** R34: el owner no tiene suscripción que rotar. */
  | { status: "not_found" };

export interface WebhookSuscripcionVistaDTO {
  url: string;
  activa: boolean;
  /**
   * FICHA 403 (R18) — si AHORA MISMO sus reintentos estan espaciados por fallos de entrega
   * sostenidos. DERIVADO en el momento de la consulta (`estaPausada()`), no una columna.
   *
   * ⚠️ INDEPENDIENTE DE `activa`: una suscripcion pausada sigue activa, sigue recibiendo jobs y se
   * recupera sola al primer 2xx. La pantalla debe pintarlo como una linea ADICIONAL, no como otra
   * rama de "activa / no hay webhook".
   */
  pausada: boolean;
  /** FICHA 403 (R18) — ISO-8601 del instante desde el que no hay ninguna entrega aceptada. */
  sinExitoDesde: string | null;
}

export interface IWebhookSuscripcionService {
  /**
   * R5/R6/R7/R33: valida la URL. Si el owner NO tiene suscripción, la crea generando y
   * CIFRANDO un secreto nuevo que devuelve una vez (`creada`). Si YA la tiene, solo
   * actualiza la URL conservando el secreto existente (`actualizada`, sin secreto).
   */
  registrar(input: RegistrarWebhookInput): Promise<RegistrarWebhookResult>;
  /**
   * R34 (gate P4): rotación explícita. Genera y CIFRA un secreto NUEVO para una suscripción
   * existente (invalida el anterior) y lo devuelve en claro una vez. `not_found` si no hay.
   */
  rotarSecreto(ownerUsuarioId: string): Promise<RotarSecretoResult>;
  /** R8: da de baja la suscripcion del owner (sus ordenes dejan de generar entregas). */
  desactivar(ownerUsuarioId: string): Promise<void>;
  /** R7: consulta para display; NUNCA expone el secreto. `null` si no hay suscripcion. */
  obtener(ownerUsuarioId: string): Promise<WebhookSuscripcionVistaDTO | null>;
}
