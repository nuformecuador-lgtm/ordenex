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
}
