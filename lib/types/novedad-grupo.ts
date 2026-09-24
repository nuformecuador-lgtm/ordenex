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
// R7 (no compila lo que no cuadra) lo entrega el `satisfies` de `PREDICADO_POR_GRUPO` (antes
// `ESTATUS_POR_GRUPO`; ficha 454), en sus dos
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
 * FICHA 454 (2026-09-23, design §4.3) — `PREDICADO_POR_GRUPO`. Aqui decia que cada grupo era una
 * IGUALDAD CON EL ESTADO ACTUAL (D1 firmada de la 236). Eso deja de ser cierto para la ayuda: el
 * estado `ayuda_tienda` sale del catalogo y la ayuda pasa a ser un EVENTO (`orden_evento`) sobre una
 * orden que sigue en `en_reparto`. El discriminante del grupo `ayuda` es la DERIVACION de
 * `lib/repositories/ayuda-abierta.ts`, que solo evalua el servidor. Se respeta el principio de la
 * D1 —ninguna marca persistida que alguien deba apagar: `orden_evento` es append-only y cualquier
 * transicion cierra la ayuda— y se revisa su letra.
 *
 * `estatus` es el estado que una fila del grupo tiene NECESARIAMENTE. Para `devolucion` es ademas
 * suficiente (`tipo: "estatus"`); para `ayuda` NO lo es (`tipo: "ayuda_abierta"`: no toda orden
 * `en_reparto` tiene ayuda abierta). La exclusion mutua de grupos (R9 de la 236) sigue siendo de
 * tipo: una orden con ayuda abierta esta en `en_reparto` y nunca en `devuelta`.
 */
export const PREDICADO_POR_GRUPO = {
  // Feature 235 -> FICHA 454: solicitud de ayuda VIVA — el paquete sigue con el mensajero, en la
  // calle, y la orden en `en_reparto`.
  ayuda: { tipo: "ayuda_abierta", estatus: "en_reparto" },
  // Feature 239: devolucion ANCLADA — confirmada al aprobar el cierre, con el reloj del plazo
  // corriendo.
  devolucion: { tipo: "estatus", estatus: "novedad" },
} as const satisfies Record<
  GrupoNovedad,
  { readonly tipo: "estatus" | "ayuda_abierta"; readonly estatus: OrderStatusValue }
>;

/**
 * Los grupos que SON una igualdad de estado (hoy, solo `devolucion`). Lo consumen el servidor
 * (`novedadWhere`, el aviso agregado) y la habilitacion por API, que ya no pueden deducir la ayuda
 * del estado. Se DERIVA de `PREDICADO_POR_GRUPO`: un solo literal por grupo.
 */
export const ESTATUS_POR_GRUPO = {
  devolucion: PREDICADO_POR_GRUPO.devolucion.estatus,
} as const satisfies Partial<Record<GrupoNovedad, OrderStatusValue>>;

/**
 * El sentido inverso, SOLO para los grupos que son una igualdad de estado: de que grupo es este
 * estado, o `null` si no es ninguno. FICHA 454: la ayuda ya no se deduce del estado (una orden
 * `en_reparto` no esta por eso en ayuda), asi que `grupoDeEstatus("en_reparto")` es `null`. Quien
 * sabe que una fila es de ayuda es quien la LISTO: ver `grupoDeFila`.
 *
 * **Se DERIVA recorriendo el mapa, nunca como un segundo literal.**
 *
 * El `null` NO es defensa muerta: es R21. La pantalla lo usa para no ofrecer NINGUNA accion de
 * resolucion sobre una orden cuyo estado no pertenece a ningun grupo.
 */
export function grupoDeEstatus(estatusValue: string): GrupoNovedad | null {
  for (const [grupo, value] of Object.entries(ESTATUS_POR_GRUPO) as Array<
    [GrupoNovedad, string]
  >) {
    if (value === estatusValue) return grupo;
  }
  return null;
}

/**
 * FICHA 454 (T2.5) — el grupo de una FILA que el servidor listo bajo `grupoListado`.
 *
 * Sigue mandando el ESTADO DE LA FILA cuando basta para decidir (236: el juego de botones lo decide
 * la fila, no la pestaña): una `devuelta` es de `devolucion` la liste quien la liste. Lo que ya no se
 * deduce del estado es la ayuda —una orden `en_reparto` no esta por eso en ayuda—, y para ella se
 * usa lo que la pantalla SI sabe: que el servidor la listo bajo `ayuda`, cuyo predicado
 * (`ayuda_abierta`) exige `en_reparto`. Si el estado no casa con nada —una fila que cambio de estado
 * por otra via, un fixture viejo— devuelve `null` y la fila se queda sin acciones que la resuelvan
 * (R21, fallo cerrado).
 */
export function grupoDeFila(estatusValue: string, grupoListado: GrupoNovedad): GrupoNovedad | null {
  const porEstado = grupoDeEstatus(estatusValue);
  if (porEstado !== null) return porEstado;
  const predicado = PREDICADO_POR_GRUPO[grupoListado];
  return predicado.tipo === "ayuda_abierta" && predicado.estatus === estatusValue
    ? grupoListado
    : null;
}
