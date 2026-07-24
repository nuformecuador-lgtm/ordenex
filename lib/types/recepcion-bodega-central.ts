import { z } from "zod";

// Feature 138 — Recepcion en la BODEGA CENTRAL: validacion de borde (zod) y resultado tipado
// expuesto por la Server Action. Espejo de `lib/types/recepcion-origen.ts`.

// El QR de la etiqueta codifica la URL `/paquete/<numGuia>`; el escaner extrae el `num_guia`
// (Int UNIQUE de `orden`) y lo manda aqui. Se exige entero positivo; un valor ilegible (el
// escaner ya lo resuelve a null) -> ZodError -> validation_error ANTES del service, sin tocar
// datos (R10).
export const recibirEnBodegaCentralSchema = z.object({
  numGuia: z.number().int().positive(),
});
export type RecibirEnBodegaCentralActionInput = z.infer<
  typeof recibirEnBodegaCentralSchema
>;

/**
 * Resultado expuesto por `recibirEnBodegaCentralPorQr`. Espeja
 * `RecibirEnBodegaCentralServiceResult` agregando `unauthenticated` (borde, R5). NO incluye
 * `tienda_ajena`/`zona_ajena`/`sin_zona`: la bodega central es global (R11).
 */
export type RecibirEnBodegaCentralResult =
  | { status: "ok"; ordenId: string; estado: "en_bodega_central" }
  | { status: "forbidden" }
  | { status: "estado_invalido"; estado: string }
  | { status: "ya_recibida" }
  | { status: "no_encontrada" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict" }
  | { status: "unauthenticated" };
