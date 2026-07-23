import type {
  ActivarApiKeyResult,
  ApiKeyIdInput,
  DesactivarApiKeyResult,
  GenerarApiKeyInput,
  GenerarApiKeyResult,
  ListarApiKeysInput,
  ListarApiKeysResult,
  RotarApiKeyResult,
} from "@/lib/types/api-key";
import type { Actor } from "@/lib/interfaces/services/IUsuarioService";

export type { Actor };

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
