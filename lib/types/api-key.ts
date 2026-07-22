import { z } from "zod";
import type { EstadoApiKey } from "@prisma/client";
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
  /** Ciclo de vida propio de la key: `activa` autoriza la carga, `inactiva` la revoca. */
  estado: EstadoApiKey;
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

// ---------------------------------------------------------------------------
// Ciclo de vida — rotar / activar / desactivar
// ---------------------------------------------------------------------------

/**
 * Entrada comun de rotar/activar/desactivar: solo el id de la fila `api_key`. Se valida
 * en el borde (la Server Action) con `uuid()`; un id malformado -> `validation_error`
 * sin tocar la DB.
 */
export const apiKeyIdSchema = z.object({
  id: z.string().uuid("El id de la API key debe ser un uuid valido"),
});

export type ApiKeyIdInput = z.infer<typeof apiKeyIdSchema>;

/**
 * Resultado de la ROTACION (R2). `plainKey` es el nuevo secreto en claro y viaja UNA
 * sola vez (como en la generacion): no se persiste ni se loguea (solo su hash SHA-256).
 * El secreto anterior deja de resolver en cuanto se reemplaza el hash. `not_found` (R3)
 * cuando el id no existe. El union es un superconjunto de `ApiKeyActionErrorResult`:
 * `forbidden` (R1) lo produce el service; `unauthenticated`/`validation_error` el borde.
 */
export type RotarApiKeyResult =
  | { status: "ok"; apiKey: ApiKeyPublico; plainKey: string }
  | { status: "not_found" } // R3
  | ApiKeyActionErrorResult;

/**
 * Resultado de activar/desactivar (R4). Devuelve la key publica ya actualizada (con su
 * `estado`), sin secreto alguno. Idempotente en el service. `not_found` (R3) si el id no
 * existe. Ambas operaciones comparten forma: solo cambia el estado destino.
 */
export type CambiarEstadoApiKeyResult =
  | { status: "ok"; apiKey: ApiKeyPublico }
  | { status: "not_found" } // R3
  | ApiKeyActionErrorResult;

/** Alias de intencion para la firma de las actions (misma forma que `CambiarEstadoApiKeyResult`). */
export type ActivarApiKeyResult = CambiarEstadoApiKeyResult;
export type DesactivarApiKeyResult = CambiarEstadoApiKeyResult;
