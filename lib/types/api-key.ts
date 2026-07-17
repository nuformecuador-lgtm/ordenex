import { z } from "zod";

// Feature 81 (design §3): contratos de I/O de la generacion de API keys.

/** R3: unica entrada obligatoria. `trim` antes de medir la longitud (3..60). */
export const generarApiKeySchema = z.object({
  identificador: z
    .string()
    .trim()
    .min(3, "El identificador debe tener al menos 3 caracteres")
    .max(60, "El identificador no puede exceder 60 caracteres"),
});

export type GenerarApiKeyInput = z.infer<typeof generarApiKeySchema>;

/**
 * Forma publica de una API key. NUNCA incluye `keyHash` ni el secreto en claro (R19):
 * no existe ninguna operacion que permita recuperar el secreto una vez generado.
 */
export interface ApiKeyPublico {
  id: string;
  identificador: string;
  /** No secreto (R17): permite mostrar `ordx_ab12cd3…` sin revelar nada. */
  keyPrefix: string;
  usuarioId: string;
  createdAt: Date;
}

/**
 * Resultado de la generacion. `plainKey` es el secreto en claro y viaja UNA sola vez
 * (R18), solo en el retorno de esta operacion: no se persiste ni se loguea (R16/R20).
 */
export type GenerarApiKeyResult =
  | { status: "ok"; apiKey: ApiKeyPublico; plainKey: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R4/R6
  | { status: "conflict"; campo: "email" | "cedula" } // R11
  | { status: "forbidden" } // R2
  | { status: "unauthenticated" }; // R1
