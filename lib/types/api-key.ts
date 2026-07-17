import { z } from "zod";
import { apiKeysConfig } from "@/lib/config/api-keys";
import type { ApiKeyListItem } from "@/lib/interfaces/repositories/IApiKeyRepository";

// Feature 81 (design §3): contratos de I/O de la generacion de API keys.
// Feature 82 (design §2.3): contratos de I/O del listado.

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

// ---------------------------------------------------------------------------
// Feature 82 — listado
// ---------------------------------------------------------------------------

/**
 * Feature 82/R3/R8: entrada del listado. `pageSize` se acota a `MAX_PAGE_SIZE` en el
 * propio schema (R8), asi que el service ya recibe el valor efectivo y lo refleja en
 * la salida. Sin `sortBy`/`sortDir` [D4]. Mismo molde que `listarUsuariosSchema`.
 */
export const listarApiKeysSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(apiKeysConfig.DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, apiKeysConfig.MAX_PAGE_SIZE)),
});

export type ListarApiKeysInput = z.infer<typeof listarApiKeysSchema>;

/** R5: DTO de fila del listado; se alinea al item del repositorio (nunca `keyHash`). */
export type ApiKeyListItemDTO = ApiKeyListItem;

/**
 * R1/R2/R3/R4: resultado discriminado del listado. Union deliberadamente mas estrecho
 * que `GenerarApiKeyResult`: aqui no hay `conflict` ni `not_found` posibles.
 *
 * Invariante R6: ninguna rama de este union contiene `keyHash` ni el secreto en claro.
 */
export type ListarApiKeysResult =
  | { status: "ok"; items: ApiKeyListItemDTO[]; page: number; pageSize: number; total: number }
  | ApiKeyActionErrorResult;

/**
 * Errores comunes al borde de las actions de API keys. `generarApiKey` los admite todos
 * (su union los incluye) y `listarApiKeys` no admite mas que estos.
 */
export type ApiKeyActionErrorResult =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R3
  | { status: "forbidden" } // R2
  | { status: "unauthenticated" }; // R1
