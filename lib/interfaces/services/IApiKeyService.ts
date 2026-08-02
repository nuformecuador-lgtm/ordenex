import type {
  ActivarApiKeyResult,
  ApiKeyIdInput,
  ApiKeyListItemDTO,
  DesactivarApiKeyResult,
  GenerarApiKeyInput,
  GenerarApiKeyResult,
  ListarApiKeysCompletoInput,
  ListarApiKeysInput,
  ListarApiKeysResult,
  RotarApiKeyResult,
} from "@/lib/types/api-key";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";

export type { Actor };

/**
 * Feature 170 (T B.1) — lectura SIN paginacion para la descarga. Mismo guard de rol
 * (`maestro`) que `listar`: quien no puede inventariar las keys tampoco puede
 * descargarlas. Ni `forbidden` ni `limite_excedido` viajan con filas (R17/R27).
 */
export type ListarApiKeysCompletoServiceResult = ListarCompletoServiceResult<ApiKeyListItemDTO>;

export interface IApiKeyService {
  /**
   * Feature 81: genera una API key y su usuario dedicado (R7/R13).
   *
   * - Solo `maestro` [D2] (R2); el resto -> `forbidden`.
   * - Deriva el slug del identificador; vacio -> `validation_error` (R6).
   * - Devuelve el secreto en claro (`plainKey`) UNA sola vez (R18). No hay ninguna
   *   otra operacion que permita recuperarlo despues (R19).
   *
   * NO conoce HTTP ni Prisma: la autenticacion (R1) la resuelve la Server Action.
   */
  generar(input: GenerarApiKeyInput, actor: Actor): Promise<GenerarApiKeyResult>;

  /**
   * Feature 82: listado paginado de API keys (R4).
   *
   * - Solo `maestro` (R2); el resto -> `forbidden` SIN consultar la base.
   * - [D2] devuelve TODAS las keys, sin scoping por creador.
   * - Orden fijo `createdAt desc` (R7) [D4]; `pageSize` ya llega acotado por el schema.
   * - NUNCA devuelve el secreto ni su hash (R6): `ApiKeyListItem` no los declara.
   *
   * NO conoce HTTP ni Prisma: la autenticacion (R1) la resuelve la Server Action.
   */
  listar(input: ListarApiKeysInput, actor: Actor): Promise<ListarApiKeysResult>;

  /**
   * Feature 170/R9: el MISMO inventario sin recorte por pagina, para la descarga.
   *
   * - Mismo `ALLOWED_ROLES` que `listar` (R17): el resto -> `forbidden` SIN consultar.
   * - Mismo `repo.list` y por tanto el MISMO orden fijo `createdAt desc` (R11).
   * - `take: tope + 1` y guard del tope (R27/R29).
   * - Sigue sin haber secreto que borrar: `ApiKeyListItem` no declara `keyHash` (82/R6).
   */
  listarCompleto(
    input: ListarApiKeysCompletoInput,
    actor: Actor,
  ): Promise<ListarApiKeysCompletoServiceResult>;

  /**
   * Ciclo de vida/R1/R2/R3: rota el secreto de una key existente.
   *
   * - Solo `maestro` (R1); el resto -> `forbidden` SIN tocar la DB.
   * - Genera un secreto nuevo y reemplaza `keyPrefix`+`keyHash` (R2); el anterior deja de
   *   resolver. No cambia el usuario dedicado ni el `estado`.
   * - Devuelve el nuevo secreto en claro (`plainKey`) UNA sola vez (R2).
   * - id inexistente -> `not_found` (R3).
   */
  rotar(input: ApiKeyIdInput, actor: Actor): Promise<RotarApiKeyResult>;

  /**
   * Ciclo de vida/R1/R3/R4: pone la key en `activa`. Solo `maestro` (R1); id inexistente
   * -> `not_found` (R3). Idempotente: activar una key ya activa es `ok` (R4). Devuelve la
   * key publica actualizada.
   */
  activar(input: ApiKeyIdInput, actor: Actor): Promise<ActivarApiKeyResult>;

  /**
   * Ciclo de vida/R1/R3/R4: pone la key en `inactiva` (palanca de revocacion; la carga
   * queda rechazada por la feature 88/R7). Solo `maestro` (R1); id inexistente ->
   * `not_found` (R3). Idempotente. Devuelve la key publica actualizada.
   */
  desactivar(input: ApiKeyIdInput, actor: Actor): Promise<DesactivarApiKeyResult>;
}
