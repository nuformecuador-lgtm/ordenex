import type { GenerarApiKeyInput, GenerarApiKeyResult } from "@/lib/types/api-key";
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
}
