import { z } from "zod";

// Recepcion en la tienda de ORIGEN — validacion de borde (zod) y resultado tipado
// expuesto por la Server Action. Espejo de `lib/types/recepcion-satelite.ts`.

// El QR de la etiqueta codifica la URL `/paquete/<numGuia>`; el escaner extrae el
// `num_guia` (Int UNIQUE de `orden`) y lo manda aqui. Se exige entero positivo; un
// valor ilegible (el escaner ya lo resuelve a null) -> ZodError -> validation_error
// ANTES del service, sin tocar datos.
export const recibirEnOrigenSchema = z.object({
  numGuia: z.number().int().positive(),
});
export type RecibirEnOrigenActionInput = z.infer<typeof recibirEnOrigenSchema>;

/**
 * Resultado expuesto por `recibirEnOrigenPorQr`. Espeja
 * `RecibirEnOrigenServiceResult` agregando `unauthenticated` (borde).
 */
export type RecibirEnOrigenResult =
  | { status: "ok"; ordenId: string; estado: "devuelta_a_tienda" }
  | { status: "forbidden" }
  | { status: "tienda_ajena" }
  | { status: "ya_recibida" }
  | { status: "estado_invalido"; estado: string }
  | { status: "no_encontrada" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict" }
  | { status: "unauthenticated" };
