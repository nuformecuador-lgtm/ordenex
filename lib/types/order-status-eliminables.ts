import type { OrderStatusValue } from "@/lib/types/order-status";

// Ficha 319 (pedido humano 2026-08-28) — FUENTE UNICA de «¿esta orden se puede ELIMINAR?».
//
// EL DEFECTO QUE ARREGLA, medido en produccion el 2026-08-28: CERO ordenes eliminables de 429
// vivas. La ventana no era estrecha, estaba VACIA. El predicado anterior tenia dos mitades y
// exigia las dos —(1) cero transiciones posteriores a la creacion en el historial y (2) estado
// dentro de `ESTADOS_CREACION`— y GENERAR LA GUIA rompe las dos a la vez: anade una fila de
// historial Y mueve el estado a `en_bodega_central`. En cuanto una orden se numeraba dejaba de
// poder eliminarse para siempre. Con fulfillment era aun mas agudo: esas ordenes nacen en
// `en_preparacion` y el paso inmediato siguiente es justamente generar la guia.
//
// LA DECISION DEL HUMANO: manda la LISTA DE ESTADOS y se RETIRA el conteo de transiciones. Su
// razon, literal: el estado ya dice quien hizo que con el paquete, y el conteo lo contradice al
// descalificar una orden solo por haberle impreso la etiqueta.
//
// POR QUE ESTA LISTA ES NUEVA Y NO UNA AMPLIACION DE `ESTADOS_CREACION`. Ampliar aquella era el
// atajo tentador —los dos servicios la importaban— y habria sido un error de otra categoria:
// `ESTADOS_CREACION` tiene DOS usos criticos ajenos a esto. `registrar-cambio-estado.ts` valida
// contra ella que una orden NACE en un estado legal (la fila de historial con origen nulo), y
// `lib/analytics/metrics.ts` la usa para definir metricas. Meter `en_bodega_central` ahi haria
// LEGAL que una orden naciera directamente en la bodega central y moveria las cifras de la
// analitica. Son dos preguntas distintas —«¿donde puede NACER?» y «¿que se puede BORRAR?»— y
// desde hoy tienen dos listas distintas.
//
// PURA: sin Prisma, sin `next/`, sin lecturas de entorno. Por eso la pueden importar tanto el
// servicio que AUTORIZA el borrado (`EliminarOrdenService`) como el que decide si la UI OFRECE
// el boton (`OrdenService.marcarEliminable`). Que sea UNA sola lista no es cosmetica: si las dos
// divergen, la barra ofrece «Eliminar» sobre filas que el servidor rechaza.

/**
 * Los CUATRO estados en los que una orden se puede eliminar. Decision del humano del
 * 2026-08-28, con el motivo de cada uno escrito al lado: quien lea esta lista dentro de tres
 * meses tiene que poder ver que `en_bodega_central` SI y `en_ruta_bodega_central` NO no es un
 * descuido, sino la frontera exacta que se pidio.
 *
 * El criterio que las une: el paquete todavia esta QUIETO en un sitio bajo control de la
 * operacion —la tienda o la bodega central— y nadie lo ha movido hacia el cliente ni hacia otra
 * bodega. Imprimir la etiqueta NO cuenta como gestion.
 */
export const ESTADOS_ELIMINABLES = [
  // Nace aqui la orden de una tienda con fulfillment: el paquete ya esta en la bodega central y
  // no se ha hecho nada con el. Era eliminable antes y lo sigue siendo.
  "en_preparacion",
  // Nace aqui la orden de una tienda sin fulfillment: el paquete sigue en la tienda y nadie ha
  // ido a por el. Era eliminable antes y lo sigue siendo.
  "por_recolectar_en_tienda",
  // Ya hay un mensajero asignado para ir a la tienda, pero el paquete NO se ha movido: sigue en
  // el mostrador de la tienda. Asignar a quien ira no es gestionar el paquete.
  "recolectando",
  // EL CASO QUE ESTA FICHA EXISTE PARA ARREGLAR. Es donde aterriza la orden al GENERAR LA GUIA
  // (arista #5) y donde vuelve tras la recoleccion: el paquete esta quieto en la bodega central
  // y lo unico que ha pasado es que se le imprimio una etiqueta. Con el criterio viejo esto era
  // inalcanzable por partida doble (transicion + estado), y es lo que dejaba la ventana vacia.
  "en_bodega_central",
] as const satisfies readonly OrderStatusValue[];

/**
 * Los NO eliminables, con las palabras del humano. No se declaran en una lista —seria una
 * segunda fuente que se desincroniza— pero SI se dejan escritos, porque el motivo es lo unico
 * que impide que alguien "amplie un poquito" la de arriba:
 *
 *  - `en_reparto`: NO, aunque no tenga ni un intento de entrega — «eso esta en gestion». El
 *    paquete va con el mensajero rumbo al cliente.
 *  - `en_ruta_bodega_satelite` y `en_bodega_satelite`: NO — «ya se hizo la gestion de
 *    enviarse». Alguien decidio mandarlo a otra bodega y se mando.
 *  - `en_ruta_bodega_central`: NO — un mensajero lo lleva encima. Es la simetria que mas se
 *    presta a confusion con `en_bodega_central`, que SI: la diferencia es que ahi el paquete
 *    esta quieto y aqui esta viajando en manos de alguien.
 *  - Y TODO LO DEMAS: los terminales (`entregada`, `devuelta_a_tienda`, `incidente`), los
 *    resultados de gestion (`rechazada`, `reprogramada`, `devuelta`, `sin_gestionar`), el flujo
 *    de devoluciones (`devolviendo_a_tienda`, `devolucion_por_confirmar`, `por_devolver`,
 *    `devolviendo_a_bodega_central`, `por_devolver_a_tienda`), `por_recoger` y `ayuda_tienda`.
 *
 * La direccion del error es la SEGURA: la lista es de INCLUSION, asi que un `value` nuevo del
 * catalogo nace NO eliminable hasta que alguien decida lo contrario a proposito.
 */
const SET_ELIMINABLES: ReadonlySet<string> = new Set<string>(ESTADOS_ELIMINABLES);

/**
 * EL predicado. Los dos servicios llaman a ESTA funcion —no a una copia del `Set`, ni a un
 * `includes` propio— para que no exista la posibilidad de que la UI y el servidor respondan
 * cosas distintas a la misma pregunta.
 *
 * Acepta `undefined`/`null` y responde `false`: un DTO sin estatus resuelto no habilita el
 * borrado. Falla CERRADO, como todo lo demas de esta accion.
 */
export function esEstadoEliminable(estatusValue: string | null | undefined): boolean {
  return estatusValue !== undefined && estatusValue !== null && SET_ELIMINABLES.has(estatusValue);
}
