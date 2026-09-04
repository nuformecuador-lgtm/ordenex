import type { EstadoApiKey, EstadoUsuario } from "@prisma/client";
import type { ApiKeyPublico, DependenciasCuentaDedicada } from "@/lib/types/api-key";

/**
 * Feature 88/R3: proyeccion MINIMA de una `api_key` resuelta por su hash, lo justo para
 * autenticar y actuar. NUNCA proyecta `keyHash` ni el secreto (espejo del `PUBLIC_SELECT`
 * de `ApiKeyRepository`): la key viaja en cada request y no debe salir del borde.
 */
export interface ApiKeyAutenticada {
  /** id de la fila `api_key` (para trazabilidad futura; nunca es el secreto). */
  apiKeyId: string;
  /**
   * Usuario dedicado 1:1 de la key: QUIEN ENTRA (portador de la credencial, rol `apiKey`).
   *
   * ⚠️ Feature 302 — YA NO ES NECESARIAMENTE EL DUENO DE LAS ORDENES. Lo era mientras `D4`
   * decia «el usuario dedicado es dueno de las ordenes que cree»; desde la 302 el dueno lo
   * decide `resolverOwnerApiKey(usuarioId, tiendaDestinoId)`. Este campo sigue siendo la
   * identidad de la CREDENCIAL, y es sobre el que se comprueban `estado` y `rol`.
   */
  usuarioId: string;
  /**
   * Feature 302 — la tienda REAL a nombre de la cual carga esta key (`adminTienda`), o `null`
   * si la key es duena de sus propias ordenes (comportamiento historico).
   */
  tiendaDestinoId: string | null;
  /**
   * Estado de la tienda destino, o `null` si no hay tienda destino. El service lo exige `activo`
   * (fallo cerrado): dar de baja una tienda tiene que cortar tambien lo que entra por su key.
   */
  tiendaDestinoEstado: EstadoUsuario | null;
  /**
   * `value` del rol de la tienda destino, o `null` si no hay tienda destino. El service exige
   * `adminTienda`: una tienda destino con cualquier otro rol es una fila mal configurada y
   * CIERRA el canal en vez de ampliarlo (mismo criterio que 267 sobre el rol de la cuenta
   * dedicada).
   */
  tiendaDestinoRol: string | null;
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
  /**
   * Feature 302: `usuario.id` de la tienda REAL a nombre de la cual cargara la key, o `null`
   * para el comportamiento historico (la cuenta dedicada es la duena). El service ya comprobo
   * que existe, que su rol es `adminTienda` y que esta activa: el repositorio no valida nada.
   */
  tiendaDestinoId: string | null;
}

/**
 * Feature 302 — proyeccion MINIMA de una cuenta candidata a TIENDA DESTINO, lo justo para que
 * `ApiKeyService` decida si la acepta. Sin PII (ni email, ni telefono, ni cedula, ni hash).
 */
export interface TiendaDestinoCandidata {
  id: string;
  /** Para mostrarla en el resultado/listado; nunca se usa para decidir. */
  nombre: string;
  /** `value` del rol; el service exige `adminTienda`. */
  rol: string;
  /** El service exige `activo`: no se cuelga una key de una tienda dada de baja. */
  estado: EstadoUsuario;
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
  /** Feature 302: id de la tienda real a cuyo nombre carga la key, o `null`. */
  tiendaDestinoId: string | null;
  /** Feature 302: nombre de esa tienda (para la pantalla), o `null` si no hay tienda destino. */
  tiendaDestinoNombre: string | null;
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

/**
 * FICHA 373 (design §5.3) — los cuatro desenlaces del borrado, tal y como los ve el REPOSITORIO.
 *
 * El repositorio NO CLASIFICA: devuelve el `estado` y las `dependencias` CRUDOS y deja el motivo
 * al service (`docs/architecture.md`: el repositorio son queries; la regla vive en el servicio).
 * Por eso hay DOS ramas `bloqueada`:
 *   - la del GUARD, que sabe por que (estado + las tres comprobaciones de datos);
 *   - la de la RED DE FK, una `P2003` inesperada de Postgres: algo que el guard no mira apunta a
 *     la cuenta dedicada. Ahi no hay diagnostico que dar y los dos campos van en `null` (R16).
 */
export type EliminarApiKeyRepoResult =
  | { status: "ok"; identificador: string }
  | { status: "not_found" }
  | { status: "bloqueada"; estado: EstadoApiKey; dependencias: DependenciasCuentaDedicada }
  | { status: "bloqueada"; estado: null; dependencias: null };

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
  /** FICHA 362 (R5/R9): `actorUsuarioId` congela QUIEN roto. Ni el secreto ni el hash ni el
   * prefijo entran en la fila del registro. */
  rotar(
    id: string,
    data: { keyPrefix: string; keyHash: string },
    actorUsuarioId: string | null,
  ): Promise<ApiKeyPublico | null>;

  /**
   * Ciclo de vida/R4: fija el `estado` propio de la key (`activa`/`inactiva`). Idempotente
   * a nivel de fila (fijar el estado que ya tiene es un no-op valido). Devuelve la forma
   * publica actualizada, o `null` si el id no existe (R3). NUNCA proyecta `keyHash`.
   */
  setEstado(
    id: string,
    estado: EstadoApiKey,
    actorUsuarioId: string | null,
  ): Promise<ApiKeyPublico | null>;

  /**
   * Feature 302: lee la cuenta `usuarioId` como CANDIDATA a tienda destino (id, nombre, rol y
   * estado), o `null` si no existe ningun usuario con ese id. Solo query: quien decide si la
   * candidata sirve es `ApiKeyService.generar` (rol `adminTienda` + estado `activo`).
   */
  findTiendaDestino(usuarioId: string): Promise<TiendaDestinoCandidata | null>;

  /**
   * FICHA 373/R8/R9/R10/R38 — las dependencias de DATOS de varias cuentas dedicadas, EN UNA SOLA
   * CONSULTA. El numero de consultas es INDEPENDIENTE del numero de filas de la pagina (R38): es
   * `findMany` + `count` + ESTA, y ni una mas.
   *
   * Cuatro `EXISTS` por cuenta, que cortan en la primera fila que casa (un acceso por indice, no
   * un conteo: contar 40.000 ordenes para responder «si» seria el coste sin la informacion).
   *
   * ⚠️ El `EXISTS` de ordenes NO filtra `deleted_at`: las ordenes usan soft delete y su FK a la
   * tienda sigue apuntando, asi que una key con 40 ordenes borradas NO es eliminable.
   *
   * Lista vacia -> `Map` vacio SIN consultar. Un id que no resuelve a ninguna cuenta no aparece en
   * el `Map`: quien llama decide que hacer con eso (el service lo trata como «sin dependencias»,
   * porque una cuenta que no existe no tiene datos).
   */
  dependenciasDeCuentasDedicadas(
    usuarioIds: readonly string[],
  ): Promise<Map<string, DependenciasCuentaDedicada>>;

  /**
   * FICHA 373/R2/R3/R4/R15/R21/R22 — borra EN FISICO, en UNA SOLA transaccion: la fila de
   * `api_key`, la fila de `usuario` de su cuenta dedicada y la suscripcion de webhook de esa
   * cuenta (si existe), y escribe en esa MISMA transaccion UNA fila de `historial_accion` con la
   * accion `api_key_eliminada`.
   *
   * EL GUARD SE RE-EVALUA AQUI DENTRO (R15), antes de la primera escritura y sin fiarse de la
   * evaluacion con la que se pinto el listado: primero el `estado` (una key `activa` sale
   * `bloqueada` sin consultar nada mas, R11) y despues los `EXISTS`. Si algo casa, se sale sin
   * haber escrito NADA.
   *
   * Sin logica de negocio: no decide el motivo ni comprueba permisos (eso es `ApiKeyService`).
   *
   * La fila de auditoria NUNCA lleva el secreto, ni `key_hash`, ni `key_prefix` (R23): solo el
   * identificador visible, el actor congelado y el estado previo en `valor_anterior`.
   */
  eliminar(id: string, actorUsuarioId: string | null): Promise<EliminarApiKeyRepoResult>;
}
