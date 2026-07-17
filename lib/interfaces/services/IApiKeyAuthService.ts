import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * Feature 88 (design §1.2): resultado discriminado de autenticar una API key presentada.
 * La autenticacion NO lanza; el borde (Route Handler) traduce cada variante al AppError
 * correspondiente (feature 10):
 *   - `ok`             -> continua (actor = usuario dedicado de la key).
 *   - `unauthenticated`-> 401 (sin key, o el hash no coincide con ninguna fila; R2/R4).
 *   - `forbidden`      -> 403 (la key existe pero su usuario dedicado NO esta `activo`; R5).
 * `apiKeyId` viaja solo en el caso `ok` (trazabilidad); NUNCA lleva la key ni el hash (R6).
 */
export type ApiKeyAuthResult =
  | { status: "ok"; actor: Actor; apiKeyId: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export interface IApiKeyAuthService {
  /**
   * Feature 88/R2-R5: autentica el secreto en claro presentado en la peticion.
   * `rawKey` null/vacio -> `unauthenticated` SIN tocar la DB (R2). En otro caso hashea con
   * el MISMO `hashApiKey` de la 81 (SHA-256 hex) y busca por `key_hash`; sin match ->
   * `unauthenticated` (R4); con match pero usuario no `activo` -> `forbidden` (R5); si todo
   * pasa -> `ok` con el actor del usuario dedicado. NUNCA loguea la key ni el hash (R6); el
   * lookup es siempre por hash, jamas por comparacion en claro (R3).
   */
  autenticar(rawKey: string | null): Promise<ApiKeyAuthResult>;
}
