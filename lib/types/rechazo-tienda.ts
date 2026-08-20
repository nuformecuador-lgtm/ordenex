import { z } from "zod";
import { motivoSchema } from "@/lib/types/gestion-orden";

// Feature 240 (design §13, D5/R12/R13) — validacion de BORDE del rechazo manual de la tienda.
//
// Este archivo viaja al bundle del navegador (la ventana valida con el MISMO schema antes de
// habilitar el boton), asi que NO puede importar `@prisma/client` ni aritmetica `Decimal`. Misma
// regla que `lib/types/gestion-orden.ts`, de donde sale `motivoSchema`.

/**
 * R12/D5 — el MOTIVO es OBLIGATORIO, y la obligatoriedad vive AQUI, en el borde, no solo en la
 * ventana. La ventana es UI: un cliente que no sea la ventana (un `fetch` a mano, un doble submit
 * con el campo borrado) llegaria igual a la Server Action. Rechazar sin motivo dejaria un cobro sin
 * una sola linea que lo explique, que es justo lo que R12 viene a evitar — y es el dato que alguien
 * pedira el dia de la primera disputa. Mismo razonamiento, palabra por palabra, que la nota
 * obligatoria de «Habilitar» (`lib/types/novedad-habilitar.ts`).
 *
 * ⚠️ EL TOPE SE REUTILIZA, NO SE INVENTA. `motivoSchema` es el MISMO schema que valida el motivo de
 * la gestion del mensajero, y el texto acaba en la MISMA columna (`gestion_orden.motivo`). Un tope
 * propio aqui seria una segunda verdad sobre el mismo campo: el dia que divergieran, el borde
 * dejaria pasar un texto que la otra via rechaza.
 *
 * Y hay que decir lo que ese schema NO tiene, porque es deuda declarada y no un descuido de esta
 * ficha: `motivoSchema` NO lleva tope de longitud (la 237/D8 lo firmo el 2026-08-20 y lo dejo
 * escrito junto al export, con su razon). Se hereda a propósito: dos reglas distintas para el mismo
 * campo es una divergencia que nadie recuerda seis meses despues. Cuando se cierre, se cierra alli
 * y vale para las dos vias.
 *
 * SIN EVIDENCIA EN IMAGEN (R13/D5): no hay campo de fotos y no es un olvido. La evidencia de la 237
 * la aporta la tienda sobre un paquete que sigue en la moto; aqui el paquete YA volvio y YA se
 * escaneo fisicamente al aprobar el cierre (238), asi que pedir una foto seria pedirle a la tienda
 * la foto de algo que no tiene delante.
 */
export const rechazarNovedadSchema = z.object({
  ordenId: z.string().uuid(),
  motivo: motivoSchema,
});

export type RechazarNovedadInput = z.infer<typeof rechazarNovedadSchema>;
