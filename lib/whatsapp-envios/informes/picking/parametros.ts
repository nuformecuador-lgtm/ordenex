// Ficha 476 (design §4.2, R2) — PARAMETROS del informe de picking: una tienda (una sola eleccion,
// D1) y el umbral de dias para marcar una orden como atrasada.
import { z } from "zod";

export const DIAS_ATRASO_MIN = 1;
export const DIAS_ATRASO_MAX = 30;
export const DIAS_ATRASO_POR_DEFECTO = 2;

export const MENSAJES_PICKING = {
  tienda: "Elige la tienda del picking.",
  dias: `Escribe un número entero de días entre ${DIAS_ATRASO_MIN} y ${DIAS_ATRASO_MAX}.`,
} as const;

/** El umbral N de «atrasada» (entero 1..30). Lo comparten el informe y el selector de tienda. */
export const diasAtrasoSchema = z
  .number({ error: MENSAJES_PICKING.dias })
  .int({ error: MENSAJES_PICKING.dias })
  .min(DIAS_ATRASO_MIN, { error: MENSAJES_PICKING.dias })
  .max(DIAS_ATRASO_MAX, { error: MENSAJES_PICKING.dias });

/**
 * `tiendaId`: id de usuario, NO `.uuid()`: el repo valida ids con `min(1)` (`idSchema` de la 474) y
 * zod 4 exige un UUID RFC estricto que un id sembrado a mano podria no cumplir. Que la tienda
 * exista y tenga fulfillment se comprueba AL GENERAR (R7), que es cuando importa.
 */
export const parametrosPickingSchema = z
  .object({
    tiendaId: z.string({ error: MENSAJES_PICKING.tienda }).trim().min(1, { error: MENSAJES_PICKING.tienda }),
    diasAtraso: diasAtrasoSchema.default(DIAS_ATRASO_POR_DEFECTO),
  })
  .strict();

export type ParametrosPicking = z.infer<typeof parametrosPickingSchema>;

/**
 * Valores de partida (R13 de la 474). `tiendaId: ""` A PROPOSITO (design §4.2): no hay una tienda
 * «por defecto» razonable, y guardar sin elegir da error en `parametros.tiendaId` (R2).
 */
export const PARAMETROS_PICKING_POR_DEFECTO: ParametrosPicking = {
  tiendaId: "",
  diasAtraso: DIAS_ATRASO_POR_DEFECTO,
};
