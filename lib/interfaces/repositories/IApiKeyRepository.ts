import type { ApiKeyPublico } from "@/lib/types/api-key";

/**
 * Feature 81/R13: datos ya RESUELTOS por el service para crear, en UNA transaccion, el
 * usuario dedicado y su api_key. El repositorio no deriva nada ni decide nada: recibe
 * los valores finales (el hash de la contrasena, el hash de la key, el slug...).
 */
export interface CreateApiKeyConUsuarioData {
  /** Input crudo recortado, para mostrar (R7: origen del `nombre` del usuario). */
  identificador: string;
  /** Slug normalizado (R5); base del email/cedula sinteticos. */
  slug: string;
  /** Email sintetico derivado (R10). */
  email: string;
  /** Cedula sintetica derivada (R10). */
  cedula: string;
  /** Hash bcrypt de la contrasena aleatoria del usuario dedicado (R8). */
  passwordHash: string;
  /** `key_prefix` no secreto (R17). */
  keyPrefix: string;
  /** SHA-256 hex del secreto de la key (R16). Nunca el secreto en claro. */
  keyHash: string;
  /** Actor (maestro) que genera la key (R21). */
  createdById: string;
}

export interface IApiKeyRepository {
  /**
   * Feature 81/R13: crea el usuario dedicado y su fila de `api_key` de forma ATOMICA
   * (si falla cualquiera de los dos, no se persiste ninguno). Resuelve por lookup el
   * rol `apiKey` y el tipo de identificacion `cedula` (nunca ids hardcodeados).
   *
   * Lanza `UsuarioDuplicadoError` ("email" | "cedula") si el usuario derivado del slug
   * ya existe (R11), reusando el mapeo de P2002 de `UserRepository`.
   *
   * El retorno NUNCA proyecta `keyHash` ni el secreto (R19).
   */
  createConUsuario(data: CreateApiKeyConUsuarioData): Promise<ApiKeyPublico>;
}
