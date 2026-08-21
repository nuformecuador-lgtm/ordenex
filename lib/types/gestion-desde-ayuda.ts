import { z } from "zod";

import {
  evidenciasSchema,
  fechaFuturaSchema,
  motivoSchema,
} from "@/lib/types/gestion-orden";

// Feature 237 (design §11, T5.2) — EL BORDE de la gestion que la TIENDA registra desde la pestaña
// «Ayuda solicitada» de `/novedades`.
//
// ⚠️ ESTE ARCHIVO VIAJA AL NAVEGADOR (la ventana valida con el MISMO schema antes de enviar), asi
// que NO puede importar `@prisma/client` ni nada de servidor. Mismo contrato que
// `lib/types/gestion-orden.ts` y `lib/types/incidente.ts`.
//
// TODO lo que se reutiliza esta importado, no copiado (R12/R13/R14, D8):
//   - `evidenciasSchema`: 1..N fotos con los MISMOS limites por archivo (MIME, tamaño) y por lista
//     (`gestionConfig.MAX_EVIDENCIAS_POR_GESTION`) que la gestion del mensajero;
//   - `fechaFuturaSchema`: «mañana o posterior en el calendario de Costa Rica», con su off-by-one
//     ya resuelto. Una segunda copia seria una segunda verdad sobre una fecha;
//   - `motivoSchema`: sin tope de longitud, deuda heredada COMPARTIDA y declarada (D8).

/**
 * R1 — LOS DOS DESENLACES QUE LA TIENDA PUEDE REGISTRAR, y ninguno mas.
 *
 * `entregada`, `devuelta` e `incidente` NO estan aqui, y su ausencia es el mecanismo del limite:
 * al ser una `discriminatedUnion` sobre estos dos literales, un cliente que envie cualquier otro
 * `resultado` no parsea — no hace falta un `if` que lo compruebe, y no hay una segunda lista que
 * pueda desincronizarse. La tienda no puede declarar entregado un paquete que no vio, ni devolver
 * por su cuenta lo que sigue en la moto del mensajero, ni reportar un incidente que no presencio.
 *
 * Coincide, no por casualidad, con las DOS aristas declaradas desde `ayuda_tienda` con
 * `via: "gestion_tienda_ayuda"` en `lib/types/order-status-transiciones.ts` (#65/#66). Si alguien
 * añadiera un tercer literal aqui sin declarar su arista, el choke point del historial lo
 * rechazaria en runtime con su guardia de fallo cerrado.
 */
export const RESULTADOS_DESDE_AYUDA = ["reprogramada", "rechazada"] as const;

export type ResultadoDesdeAyuda = (typeof RESULTADOS_DESDE_AYUDA)[number];

/**
 * R12/R13/R14 — la entrada, discriminada por `resultado`.
 *
 * ⚠️ LA EVIDENCIA ES OBLIGATORIA EN LAS DOS RAMAS, tambien al reprogramar (D2, firmada por el
 * humano el 2026-08-20), y ahi esta la unica asimetria con el mensajero: el suyo reprograma SIN
 * foto. El motivo no es rigor gratuito. La reprogramacion del mensajero ya trae una PRUEBA DE
 * PRESENCIA que la de la tienda no puede tener —la ubicacion es obligatoria en sus cinco ramas
 * desde la 193, y denegar el permiso le BLOQUEA el envio—. La tienda gestiona desde un escritorio:
 * la imagen (la captura de la conversacion con el cliente, tipicamente) es su sustituto de esa
 * prueba, no un adorno. Y reprogramar desde ayuda SUMA UN INTENTO y mueve el reloj del SLA: dos
 * clicks sin ningun respaldo sobre una orden que la tienda no vio serian demasiado baratos para lo
 * que cuestan.
 */
export const gestionarDesdeAyudaSchema = z.discriminatedUnion("resultado", [
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("reprogramada"),
    // R14: no anterior a mañana en el calendario de CR, revalidado AQUI y no solo en la ventana.
    fechaReprogramacion: fechaFuturaSchema,
    motivo: motivoSchema,
    evidencias: evidenciasSchema, // D2: tambien al reprogramar
  }),
  z.object({
    ordenId: z.string().min(1),
    resultado: z.literal("rechazada"),
    motivo: motivoSchema,
    evidencias: evidenciasSchema,
  }),
]);

export type GestionarDesdeAyudaActionInput = z.infer<typeof gestionarDesdeAyudaSchema>;

/**
 * Resultado de la Server Action (design §11).
 *
 * `conflict` existe separado de `forbidden` por R25 y por la leccion de 236/D8 sobre esta MISMA
 * card: «Habilitar» afirmaba haber habilitado aunque la carrera dejara la orden quieta. Aqui, si la
 * orden dejo de estar en ayuda entre la lectura y la escritura, la pantalla NO puede decir que
 * gestiono — y el `motivo` es el texto que se lo explica al usuario.
 *
 * `forbidden` es OPACO a proposito (R22): rol ajeno, orden inexistente, orden de otra tienda y
 * actor fuera de su ventana devuelven LO MISMO. El borde no es un oraculo del estado de una guia.
 */
export type GestionarDesdeAyudaResult =
  | { status: "ok"; ordenId: string; resultado: ResultadoDesdeAyuda }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; motivo: string };
