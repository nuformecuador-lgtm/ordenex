import { z } from "zod";

// Feature 246 (T1.2, design §4.1) — EL TOKEN de la eleccion «hoy o mañana» al asignar.
//
// POR QUE UN TOKEN Y NO UNA FECHA (R6). El cliente NUNCA manda una fecha: manda cual de las dos
// opciones eligio, y el servidor decide a que fecha calendario corresponde (`resolverFechaReparto`,
// `lib/utils/dia-reparto.ts`). Un `YYYY-MM-DD` calculado con el reloj del navegador dejaria el dia
// de reparto de una orden en manos de un portatil con la hora corrida — y «hoy» solo significa algo
// con un huso, que en este repo es siempre el de Costa Rica y siempre server-side (R5).
//
// POR QUE UN UNICO ARCHIVO PARA LAS DOS SUPERFICIES (D4). El selector va en bodega central Y en
// bodega satelite. Si cada schema declarara su propio `z.enum([...])`, un dia uno aceptaria
// `"manana"` y el otro `"mañana"` y la regla del sistema pasaria a depender de desde que bodega te
// asignaron. Un solo enum: una sola forma de escribirlo.
//
// SIN TILDE en el valor `"manana"` a proposito: es un token de protocolo que viaja por la red y por
// zod, no un texto visible. La etiqueta con tilde («Mañana») la pone la pantalla.
export const DIA_REPARTO = ["hoy", "manana"] as const;

export type DiaReparto = (typeof DIA_REPARTO)[number];

/**
 * R4 — `.default("hoy")` lo aplica CADA schema que lo consume, no este. Aqui el enum es
 * ESTRICTO: `diaRepartoSchema.parse(undefined)` falla. Asi el default es una decision explicita
 * del borde que lo declara (`asignarBodegaSchema`, `asignarSateliteSchema`) y no algo que se
 * hereda sin querer en cualquier sitio donde se reuse el enum.
 */
export const diaRepartoSchema = z.enum(DIA_REPARTO);
