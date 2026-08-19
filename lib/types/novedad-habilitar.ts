import { z } from "zod";

import { CUERPO_MAX, type NotaValidationError, type OrdenNotaDTO } from "@/lib/types/orden-nota";

// «HABILITAR» una novedad (pedido humano 2026-08-18) — validacion de borde (zod) y resultado
// discriminado, con el patron de `lib/types/orden-ayuda.ts`.
//
// QUE ES. La tienda cierra la novedad desde `/novedades`: la nota obligatoria del modal se publica
// en el hilo de la feature 227 y la orden pierde la bandera `orden.ayuda`.
//
// FEATURE 239 (T3.1, R23) — CAMBIO DE ALCANCE, y es el punto importante de este modulo. Hasta el
// 2026-08-19 apagaba DOS banderas (`ayuda` y `gestion_aprobada`) y con eso la orden caia del `OR`
// de `OrdenRepository.novedadWhere` **sin dejar de estar en `devuelta`**: seguia siendo candidata
// del cron de SLA y a los 5 dias se escalaba a `rechazada` y se COBRABA, sin aviso y sin que
// nadie la viera (auditoria §2.2). `gestion_aprobada` ya no existe y la rama de la devolucion es
// una IGUALDAD DE ESTADO, asi que **«Habilitar» ya no puede esconder una devolucion con el reloj
// corriendo**: mientras la orden siga en `devuelta`, sigue listada. Es exactamente lo que R23
// exige, y se cumple por construccion, no por una comprobacion que alguien tenga que recordar.
//
// QUE **NO** HACE: no toca el ESTATUS de la orden. Que «habilitar» deba ademas moverla —y adonde—
// es la pregunta que la cabecera de `NovedadAcciones.tsx` declara ABIERTA desde 2026-08-12; la
// puerta humana del 2026-08-19 se la asigno a la ficha 240, no a esta.
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
