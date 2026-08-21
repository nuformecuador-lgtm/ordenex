import type { OrderStatusValue } from "@/lib/types/order-status";

// Feature 236 (T1.1, design §2.1 — R5/R6/R7) — LA DECLARACION UNICA DE LOS GRUPOS DE `/novedades`.
//
// QUE PROBLEMA CIERRA. Hasta hoy `/novedades` listaba DOS poblaciones distintas bajo UNA sola
// pestaña, porque `OrdenRepository.novedadWhere` era un `OR` de dos igualdades de estado y la
// pantalla las pintaba seguidas. La orden sobre la que un mensajero pedia ayuda aparecia bajo «En
// devolucion», con un subtitulo que no era cierto de ella y con un juego de botones decidido por
// condiciones sueltas repartidas por el componente.
//
// POR QUE UN MODULO PURO Y NO DOS CONSTANTES AL LADO DE CADA CONSUMIDOR. Los dos lados de la
// pantalla —el SERVIDOR, que decide QUE LISTA (§2.2), y la INTERFAZ, que decide QUE BOTONES OFRECE
// (§6)— tienen que describir LOS MISMOS grupos. Con dos literales, el dia que entre un tercer grupo
// uno de los dos se queda atras y nada rompe: la pantalla ofreceria acciones de un grupo que el
// servidor no lista, o al reves. Con una sola declaracion, ese desacuerdo no se puede escribir.
//
// R7 (no compila lo que no cuadra) lo entrega el `satisfies` de `ESTATUS_POR_GRUPO`, en sus dos
// mitades: un grupo sin estado no compila (falta una clave del `Record`), y un estado que no exista
// en `ORDER_STATUS_SEED` tampoco (no es un `OrderStatusValue`). Es el mismo mecanismo con el que la
// 235 justifico pasar de bandera a estatus: que el typecheck reclame la decision, en vez de que la
// reclame produccion.
//
// LO QUE ESTE MODULO **NO** HACE, y es deliberado: no conoce Prisma, ni React, ni HTTP. Es un
// modulo puro de tipos y valores, importable desde el repositorio y desde la pantalla sin arrastrar
// ninguna de las dos capas a la otra.

/**
 * Por que una orden esta en `/novedades`. **Una pestaña por grupo**, y una orden vive en
 * EXACTAMENTE una (R9): el discriminante es el estado, y una orden tiene un `estatus_id` y solo
 * uno, asi que la exclusion es del tipo de dato y no una propiedad que alguien deba sostener.
 *
 * La tercera pestaña de la pantalla —«Rechazadas por plazo vencido», feature 102— NO es un grupo de
 * novedad: tiene su propio servicio, su propio DTO y su propio predicado, y esta ficha no la toca.
 */
export type GrupoNovedad = "devolucion" | "ayuda";

/**
 * Los grupos, como VALORES, y **en el orden en que se enseñan** (D6, firmada por el humano el
 * 2026-08-19): la ayuda va PRIMERA porque alguien esta esperando respuesta AHORA; una devolucion no
 * espera a nadie con esa urgencia.
 *
 * Que el orden viva junto al mapa —y no en la pantalla— evita que el listado de pestañas y la
 * descarga los enumeren en ordenes distintos. Y que sean valores (no solo un tipo) es lo que permite
 * a los tests recorrerlos: la invariante «count y find comparten predicado» ITERA esta lista, asi
 * que un grupo nuevo entra SOLO a la asercion, sin que nadie se acuerde (T2.3).
 *
 * ⚠️ El `satisfies` comprueba que cada elemento SEA un grupo, no que esten TODOS: la exhaustividad
 * la vigila `tests/unit/types/novedad-grupo.test.ts` contra las claves de `ESTATUS_POR_GRUPO`.
 */
export const GRUPOS_NOVEDAD = ["ayuda", "devolucion"] as const satisfies readonly GrupoNovedad[];

/**
 * **EL punto unico.** El servidor lo usa para decidir QUE LISTA (`OrdenRepository.novedadWhere`,
 * design §2.2) y la pantalla para decidir QUE BOTONES OFRECE (`ACCIONES_POR_GRUPO`, design §6.2).
 * Dos consumidores, una sola verdad: no pueden describir grupos distintos (R6).
 *
 * Cada valor es una IGUALDAD CON EL ESTADO ACTUAL de la orden y nada mas (R3, D1 firmada). Ninguna
 * clave hermana, ninguna marca persistida: cada vez que una rama de este predicado tuvo un booleano
 * al lado del estado, aparecio una fuga (`orden.ayuda` dejaba la fila en `/novedades` para siempre,
 * auditoria §2.1; `orden.gestion_aprobada` la borraba retroactivamente, 239/R30). Las dos columnas
 * estan retiradas y las dos guardias que impiden su vuelta siguen vivas.
 */
export const ESTATUS_POR_GRUPO = {
  // Feature 235: solicitud de ayuda VIVA — el paquete sigue con el mensajero, en la calle.
  ayuda: "ayuda_tienda",
  // Feature 239: devolucion ANCLADA — confirmada al aprobar el cierre, con el reloj del plazo
  // corriendo. El pre-estado `devolucion_por_confirmar` NO casa: ni se ve ni corre plazo.
  devolucion: "devuelta",
} as const satisfies Record<GrupoNovedad, OrderStatusValue>;

/**
 * El sentido inverso: de que grupo es este estado, o `null` si no es ninguno.
 *
 * **Se DERIVA recorriendo el mapa, nunca como un segundo literal.** Un segundo literal es una
 * segunda verdad, y bastaria con que alguien cambiara un value en un sitio para que el servidor
 * listara una cosa y la pantalla ofreciera los botones de otra — que es exactamente el desacuerdo
 * que este modulo existe para hacer imposible.
 *
 * El `null` NO es defensa muerta: es R21. La pantalla lo usa para no ofrecer NINGUNA accion de
 * resolucion sobre una orden cuyo estado no pertenece a ningun grupo. Con los predicados de §2 no
 * puede ocurrir —el servidor solo lista esos dos estados—, y precisamente por eso hay que escribirlo:
 * el dia que un tercer camino traiga una fila por otra via, no se inventaran botones para ella.
 */
export function grupoDeEstatus(estatusValue: string): GrupoNovedad | null {
  for (const [grupo, value] of Object.entries(ESTATUS_POR_GRUPO) as Array<
    [GrupoNovedad, string]
  >) {
    if (value === estatusValue) return grupo;
  }
  return null;
}
