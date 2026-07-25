import type { EstadoApiKey, EstadoUsuario } from "@prisma/client";
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
  /**
   * Estado PROPIO de la key (activar/desactivar): la carga solo procede si es `activa`.
   * Palanca de revocacion independiente del estado del usuario dedicado (R7).
   */
  apiKeyEstado: EstadoApiKey;
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

/**
 * Feature 82/R5: fila del listado. NO declara `keyHash` ni el secreto en claro, y esa
 * ausencia es la garantia de R6: no hay nada que filtrar porque nunca entra al tipo.
 * `usuarioEmail` llega por `include` del usuario dedicado [D1]: el uuid no le dice nada
 * a un humano, el email sintetico identifica la cuenta de forma inequivoca.
 */
export interface ApiKeyListItem {
  id: string;
  identificador: string;
  /** No secreto (81/R17): permite mostrar `ordx_ab12cd3…` sin revelar nada. */
  keyPrefix: string;
  /** Estado propio de la key (activar/desactivar): `activa` | `inactiva`. */
  estado: EstadoApiKey;
  usuarioId: string;
  /** Email sintetico del usuario dedicado (`apikey+<slug>@apikey.invalid`). [D1] */
  usuarioEmail: string;
  createdAt: Date;
}

/**
 * Feature 82/R7: parametros del listado paginado. Sin `sortBy`/`sortDir`: el orden es
 * fijo (`createdAt desc`) en v1 [D4], asi que no hay lista blanca que validar.
 */
export interface ListApiKeysParams {
  skip: number;
  take: number;
}

export interface ListApiKeysResult {
  items: ApiKeyListItem[];
  total: number;
}

export interface IApiKeyRepository {
  /**
   * Feature 82/R4/R7/R10: listado paginado, ordenado por `createdAt` descendente.
   * Sin logica de negocio ni permisos: eso vive en `ApiKeyService`. `total` es el
   * numero total de keys existentes, independiente de la pagina pedida (R9).
   *
   * El retorno NUNCA proyecta `keyHash` ni el secreto (R6).
   */
  list(params: ListApiKeysParams): Promise<ListApiKeysResult>;

  /** Feature 82: total de API keys existentes. [D2] sin scoping por creador. */
  count(): Promise<number>;

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

  /**
   * Ciclo de vida/R2: reemplaza ATOMICAMENTE el `key_prefix` y el `key_hash` de la fila
   * `id` por los de un secreto nuevo (ya generados por el service). No toca el usuario
   * dedicado ni el `estado`. Devuelve la forma publica actualizada, o `null` si el id no
   * existe (R3). NUNCA proyecta `keyHash` ni el secreto (R6/R19).
   */
  rotar(id: string, data: { keyPrefix: string; keyHash: string }): Promise<ApiKeyPublico | null>;

  /**
   * Ciclo de vida/R4: fija el `estado` propio de la key (`activa`/`inactiva`). Idempotente
   * a nivel de fila (fijar el estado que ya tiene es un no-op valido). Devuelve la forma
   * publica actualizada, o `null` si el id no existe (R3). NUNCA proyecta `keyHash`.
   */
  setEstado(id: string, estado: EstadoApiKey): Promise<ApiKeyPublico | null>;
}
