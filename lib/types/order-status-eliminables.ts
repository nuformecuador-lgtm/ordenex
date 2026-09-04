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
// desde entonces tienen dos listas distintas.
//
// ⭑ PEDIDO HUMANO 2026-09-04 — EL CRITERIO VUELVE A TENER DOS MITADES, Y NO SON LAS DE ANTES.
// Conviene decirlo aqui arriba porque a primera vista parece que se deshace la 319:
//   (1) el ESTADO, ampliado de cuatro a SIETE (entran los dos `en_ruta_*` y `por_recoger`);
//   (2) los REINTENTOS: la orden no puede tener NINGUN intento de entrega.
//
// POR QUE ESTO NO ES VOLVER AL CRITERIO RETIRADO — la confusion cara de este archivo. Lo que la
// 319 retiro fue el conteo de TRANSICIONES DEL HISTORIAL (`idsConGestionPosteriorEnLote`,
// `estatus_origen_id IS NOT NULL`): contaba CUALQUIER movimiento de estado, y por eso IMPRIMIR
// LA ETIQUETA descalificaba la orden. Lo que entra ahora es el conteo de INTENTOS DE ENTREGA
// (`contarIntentosEnLote`, feature 215): cierres APROBADOS distintos en los que la orden tuvo un
// resultado de gestion vigente de los que cuentan —`rechazada`, `devuelta`, `reprogramada`—.
// Generar la guia no es un intento de entrega, ni lo es recolectar, ni mover el paquete entre
// bodegas: el numero sigue en `0` durante toda la ventana que la 319 abrio. Las dos mitades de
// hoy pueden convivir; las de antes no podian, y esa es toda la diferencia.
//
// Y ES LA MITAD QUE HACE SEGURA LA AMPLIACION DE ESTADOS. Los tres que entran son justamente
// aquellos en los que el paquete YA se movio, y el 2026-08-28 se rechazaron por eso. Lo que
// cambia la decision es que «moverse» y «haberse intentado entregar» no son lo mismo: una orden
// en ruta a la bodega satelite que nadie ha intentado entregar es una orden que la tienda puede
// querer retirar, y el intento de entrega —no el traslado— es el hecho que ata la orden a un
// cierre y a dinero (`rechazada` -> `cobroRechazado`, feature 56).

/**
 * Los SIETE estados en los que una orden se puede eliminar (pedido humano 2026-09-04, que
 * amplia los cuatro de la 319). El motivo de cada uno va escrito al lado: quien lea esta lista
 * dentro de tres meses tiene que poder ver cual entro cuando y por que.
 *
 * ⚠️ ESTA LISTA NO BASTA POR SI SOLA. Es la PRIMERA mitad del criterio; la segunda son los
 * reintentos, y el predicado completo es `esOrdenEliminable`. Usar `esEstadoEliminable` a secas
 * para decidir un borrado es hoy un fallo ABIERTO —deja pasar ordenes ya gestionadas— y por eso
 * ningun servicio la consulta directamente. La guardia
 * `tests/unit/guards/eliminar-por-estado.guardia.test.ts` lo afirma.
 */
export const ESTADOS_ELIMINABLES = [
  // Nace aqui la orden de una tienda con fulfillment: el paquete ya esta en la bodega central y
  // no se ha hecho nada con el. Eliminable desde la 319.
  "en_preparacion",
  // Nace aqui la orden de una tienda sin fulfillment: el paquete sigue en la tienda y nadie ha
  // ido a por el. Eliminable desde la 319.
  "por_recolectar_en_tienda",
  // Ya hay un mensajero asignado para ir a la tienda, pero el paquete NO se ha movido: sigue en
  // el mostrador. Asignar a quien ira no es gestionar el paquete. Eliminable desde la 319.
  "recolectando",
  // EL CASO QUE LA FICHA 319 EXISTIO PARA ARREGLAR. Es donde aterriza la orden al GENERAR LA
  // GUIA (arista #5) y donde vuelve tras la recoleccion: el paquete esta quieto en la bodega
  // central y lo unico que ha pasado es que se le imprimio una etiqueta.
  "en_bodega_central",
  // ─── Entran el 2026-09-04 ──────────────────────────────────────────────────────────────
  // El paquete lo lleva un mensajero hacia la bodega central. El 2026-08-28 se rechazo con estas
  // palabras: «un mensajero lo lleva encima». Entra ahora porque llevarlo no es haber intentado
  // entregarlo, y la segunda mitad del criterio cubre lo que aquella frase protegia.
  "en_ruta_bodega_central",
  // El paquete va camino de una bodega satelite. El 2026-08-28 se rechazo con «ya se hizo la
  // gestion de enviarse»; hoy esa gestion se considera logistica, no entrega. Ojo a la asimetria
  // DELIBERADA: `en_ruta_bodega_satelite` SI y `en_bodega_satelite` NO (ver abajo).
  "en_ruta_bodega_satelite",
  // La orden espera a que alguien la recoja. No hay intento de entrega —si lo hubiera, el conteo
  // lo delataria— y el paquete no esta en manos del cliente.
  "por_recoger",
] as const satisfies readonly OrderStatusValue[];

/**
 * Los NO eliminables. No se declaran en una lista —seria una segunda fuente que se
 * desincroniza— pero SI se dejan escritos, porque el motivo es lo unico que impide que alguien
 * "amplie un poquito" la de arriba:
 *
 *  - `en_reparto`: NO — «eso esta en gestion» (palabras del humano el 2026-08-28, que se
 *    mantienen el 2026-09-04). El paquete va con el mensajero RUMBO AL CLIENTE, que es la
 *    diferencia exacta con los dos `en_ruta_*` que si entran: aquellos van entre bodegas.
 *  - `en_bodega_satelite`: NO, aunque su `en_ruta_*` si entre. El paquete ya ATERRIZO en la
 *    satelite, que es el ultimo eslabon antes del cliente y de donde el mensajero lo toma para
 *    repartir; retirarlo de ahi es retirarlo de una operacion en marcha.
 *  - Y TODO LO DEMAS: los terminales (`entregada`, `devuelta_a_tienda`, `incidente`), los
 *    resultados de gestion (`rechazada`, `reprogramada`, `devuelta`, `sin_gestionar`) y el flujo
 *    de devoluciones (`devolviendo_a_tienda`, `devolucion_por_confirmar`, `por_devolver`,
 *    `devolviendo_a_bodega_central`, `por_devolver_a_tienda`, `ayuda_tienda`).
 *
 * Notese que los resultados de gestion estarian ADEMAS bloqueados por la segunda mitad del
 * criterio: una orden `rechazada` o `reprogramada` tiene, por construccion, al menos un intento.
 * Que sobren razones es lo correcto; no es motivo para retirar ninguna de las dos.
 *
 * La direccion del error es la SEGURA: la lista es de INCLUSION, asi que un `value` nuevo del
 * catalogo nace NO eliminable hasta que alguien decida lo contrario a proposito.
 */
const SET_ELIMINABLES: ReadonlySet<string> = new Set<string>(ESTADOS_ELIMINABLES);

/**
 * LA PRIMERA MITAD: ¿el ESTADO admite borrado?
 *
 * Acepta `undefined`/`null` y responde `false`: un DTO sin estatus resuelto no habilita el
 * borrado. Falla CERRADO, como todo lo demas de esta accion.
 *
 * ⚠️ NO ES EL CRITERIO COMPLETO desde el 2026-09-04. Se sigue exportando porque el repositorio
 * necesita la pregunta de estado POR SEPARADO —`softDeleteViaApi` la baja a su `where` como
 * `estadosPermitidos`, y un `where` no sabe de intentos— y porque los tests la ejercitan
 * aislada. Para DECIDIR un borrado se llama a `esOrdenEliminable`.
 */
export function esEstadoEliminable(estatusValue: string | null | undefined): boolean {
  return estatusValue !== undefined && estatusValue !== null && SET_ELIMINABLES.has(estatusValue);
}

/**
 * EL PREDICADO COMPLETO. Los tres consumidores llaman a ESTA funcion —no a una copia, ni a un
 * `includes` propio, ni a `esEstadoEliminable` a secas— para que no exista la posibilidad de que
 * la UI y el servidor respondan cosas distintas a la misma pregunta: el que AUTORIZA por
 * pantalla (`EliminarOrdenService`), el que BORRA por API key (`ApiOrdenEliminacionService`) y
 * el que decide si la barra OFRECE el boton (`OrdenService.marcarEliminable`). Que sea UNA sola
 * funcion no es cosmetica: si divergieran, la pantalla ofreceria «Eliminar» sobre filas que el
 * servidor rechaza.
 *
 * `intentosEntrega` es el numero de la feature 215 (`IOrdenHistorialService.contarIntentos` y su
 * gemelo en lote): cierres aprobados distintos con una gestion vigente de las que cuentan. Se
 * recibe YA CALCULADO y no se consulta aqui: este modulo es puro a proposito (sin Prisma, sin
 * `next/`, sin entorno) y quien llama ya tiene el dato o sabe pedirlo en lote.
 *
 * `null`/`undefined` en los intentos responde `false`, igual que un estatus ausente: «no se
 * cuantos intentos tiene» no es «tiene cero». Es la misma direccion de fallo que el resto de la
 * accion, y la que evita que un DTO incompleto abra el borrado por omision.
 */
export function esOrdenEliminable(
  estatusValue: string | null | undefined,
  intentosEntrega: number | null | undefined,
): boolean {
  return esEstadoEliminable(estatusValue) && intentosEntrega === 0;
}
