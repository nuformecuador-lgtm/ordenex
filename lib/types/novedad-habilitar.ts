import { z } from "zod";

import { CUERPO_MAX, type NotaValidationError, type OrdenNotaDTO } from "@/lib/types/orden-nota";

// «HABILITAR» una novedad (pedido humano 2026-08-18) — validacion de borde (zod) y resultado
// discriminado, con el patron de `lib/types/orden-ayuda.ts`.
//
// QUE ES. La tienda cierra la novedad desde `/novedades`: la nota obligatoria del modal se publica
// en el hilo de la feature 227 y la orden pierde LAS DOS banderas que la ponian en esa pantalla
// (`orden.ayuda` y `orden.gestion_aprobada`). Con las dos apagadas la orden cae del `OR` de
// `OrdenRepository.novedadWhere` y desaparece del listado.
//
// QUE **NO** HACE, Y ESO ES LO IMPORTANTE DE ESTE MODULO: no toca el ESTATUS de la orden. La orden
// sigue `devuelta` despues de habilitarla; lo unico que cambia es que su tienda deja de verla como
// pendiente. Que «habilitar» deba ademas moverla —y adonde, y que pasa con el plazo de la feature
// 102, que corre desde la devolucion— es la pregunta que la cabecera de `NovedadAcciones.tsx`
// declara ABIERTA desde 2026-08-12, y sigue abierta: no se decide aqui.
//
// POR QUE LA NOTA REUSA `CUERPO_MAX`. La nota ES una nota: acaba literalmente en
// `orden_nota.cuerpo`, que la 227 acota a 200 caracteres. Un tope propio seria una segunda fuente
// de verdad que el dia que divergiera dejaria pasar en el borde un texto que el service de notas
// rechazaria despues. Mismo razonamiento, misma constante, que el motivo de la ayuda.
//
// LA NOTA ES OBLIGATORIA (`min(1)`) y esto lo exige ya el modal (`HabilitarNovedadModal` no deja
// confirmar sin ella). Se vuelve a exigir aqui porque el modal es UI y este es el borde: habilitar
// sin nota dejaria la orden fuera del listado sin que conste por que, que es justo lo que la nota
// obligatoria venia a evitar.

/** Tope de la nota, en caracteres. Es EL MISMO de una nota del hilo, por construccion. */
export const NOTA_HABILITAR_MAX = CUERPO_MAX;

/** Borde: la orden (uuid) y la nota acotada. El actor NUNCA viaja: lo fija la sesion. */
export const habilitarNovedadSchema = z.object({
  ordenId: z.uuid(),
  nota: z.string().min(1).max(NOTA_HABILITAR_MAX),
});
export type HabilitarNovedadInput = z.infer<typeof habilitarNovedadSchema>;

/**
 * `ok` devuelve la nota recien publicada ya proyectada, para que la UI pueda refrescar el hilo sin
 * una segunda lectura (mismo contrato que la solicitud de ayuda).
 *
 * `forbidden` es OPACO y hereda el de la 227 tal cual: rol no autorizado, orden inexistente, orden
 * de otra tienda o fuera de la ventana de escritura del `adminTienda` (`devuelta`) devuelven todos
 * lo mismo. Habilitar no abre ni un resquicio de informacion que el hilo no abriera ya.
 */
export type HabilitarNovedadServiceResult =
  | { status: "ok"; nota: OrdenNotaDTO }
  | NotaValidationError
  | { status: "forbidden" };

export type HabilitarNovedadResult =
  | HabilitarNovedadServiceResult
  | { status: "unauthenticated" };
