import type { EstadoUsuario } from "@prisma/client";
import type { ApiKeyPublico } from "@/lib/types/api-key";

/**
 * Feature 88/R3: proyeccion MINIMA de una `api_key` resuelta por su hash, lo justo para
 * autenticar y actuar. NUNCA proyecta `keyHash` ni el secreto (espejo del `PUBLIC_SELECT`
 * de `ApiKeyRepository`): la key viaja en cada request y no debe salir del borde.
 */
export interface ApiKeyAutenticada {
  /** id de la fila `api_key` (para trazabilidad futura; nunca es el secreto). */
  apiKeyId: string;
  /** Usuario dedicado 1:1 de la key. Sera el `tienda_id` de las ordenes creadas (D4). */
  usuarioId: string;
  /** Estado del usuario dedicado: la carga solo procede si es `activo` (R5). */
  estado: EstadoUsuario;
  /** `value` del rol del usuario dedicado (`apiKey`); el service revalida (defensa en profundidad). */
  rol: string;
}

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

  /**
   * Feature 88/R3/R4: lookup O(1) por `key_hash` (UNIQUE) de la key presentada, ya
   * hasheada por el service (SHA-256 hex, el MISMO `hashApiKey` de la 81). Devuelve la
   * proyeccion minima para autorizar (`ApiKeyAutenticada`) o `null` si ninguna fila
   * coincide. NUNCA proyecta `keyHash` ni el secreto (R19/R6); jamas compara el secreto
   * en claro contra la DB (el lookup es siempre por hash).
   */
  findByKeyHash(keyHash: string): Promise<ApiKeyAutenticada | null>;
}
