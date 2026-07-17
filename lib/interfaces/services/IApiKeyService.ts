import type {
  GenerarApiKeyInput,
  GenerarApiKeyResult,
  ListarApiKeysInput,
  ListarApiKeysResult,
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
}
