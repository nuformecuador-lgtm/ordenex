import { z } from "zod";

// Feature 116 — validacion de borde (zod) + resultado tipado de la NOTA PRIVADA del
// mensajero por orden. Patron `lib/types/orden-mensajero-meta.ts` (feature 115): zod en el
// borde (Server Action) y resultado DISCRIMINADO por `status`. El service devuelve
// `forbidden` como resultado de dominio (rol != mensajero u orden inexistente por la FK); el
// borde agrega `unauthenticated` (R10) y `validation_error` (R13).
//
// La nota es DISTINTA de `orden.notas` (nota de la TIENDA): esta viaja SOLO por (usuario_id,
// orden_id) en `orden_mensajero_meta.nota` (columna creada por la feature 115). NUNCA toca
// `orden.notas` (R7).

// P1: tope de caracteres de la nota para evitar abuso (la columna `text` de Postgres es
// ilimitada). Ajustable sin tocar el modelo (solo este schema). Holgado para notas de reparto.
export const NOTA_MAX = 2000;

// R13: `ordenId` con formato valido (uuid, como `Orden.id`) y `nota` acotada al maximo. La
// `nota` se RECORTA en el service (no aqui): un texto en blanco es valido para el schema y el
// service lo trata como limpiar (R5). El maximo se mide sobre el texto crudo (pre-recorte).
export const guardarNotaSchema = z.object({
  ordenId: z.string().uuid(),
  nota: z.string().max(NOTA_MAX),
});
export type GuardarNotaInput = z.infer<typeof guardarNotaSchema>;

// R13: limpiar solo necesita el `ordenId` (uuid). El `usuario_id` lo fija el service con el
// actor autenticado (nunca el input): la nota es privada por construccion (R6/R8/R9).
export const limpiarNotaSchema = z.object({
  ordenId: z.string().uuid(),
});
export type LimpiarNotaInput = z.infer<typeof limpiarNotaSchema>;

// Resultado expuesto por la Server Action de GUARDAR. `ok` refleja la `nota` resultante
// (`null` si se limpio por venir en blanco) para que la UI la muestre sin re-fetch inmediato;
// el resto son los rechazos de dominio/borde. Espejo del design §4.
export type GuardarNotaResult =
  | { status: "ok"; nota: string | null }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R13
  | { status: "forbidden" } // R10 (rol != mensajero) / R16 (orden inexistente, FK)
  | { status: "unauthenticated" }; // R10 (sin sesion)

// Resultado expuesto por la Server Action de LIMPIAR. Idempotente: `ok` aunque no hubiera fila
// que limpiar (R4).
export type LimpiarNotaResult =
  | { status: "ok" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R13
  | { status: "forbidden" } // R10
  | { status: "unauthenticated" }; // R10
