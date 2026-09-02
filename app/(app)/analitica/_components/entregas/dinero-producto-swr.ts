// FICHA 347 (F5) — la CLAVE SWR y el fetcher del DETALLE ORDEN POR ORDEN del dinero de un
// producto, en un solo sitio.
//
// Mismo molde que `productos-swr.ts` y `conteo-entregas-swr.ts`, y por el mismo motivo: SWR
// comparte peticion y cache por IGUALDAD de clave, no por parecido. Dos claves «casi iguales»
// son dos peticiones a la base y dos respuestas que pueden discrepar en la misma pantalla.
//
// LAS CUATRO PROPIEDADES QUE ESTA CLAVE TIENE QUE CUMPLIR, y las cuatro estan aqui:
//
//  1. **Lleva el filtro de la seccion** (R59). El detalle se calcula sobre el MISMO recorte que
//     la fila; si el filtro cambia y la clave no, el panel abierto seguiria mostrando las
//     ordenes del filtro anterior bajo una fila que ya es otra.
//  2. **Lleva la tienda Y el producto** (R34). Puede haber dos paneles abiertos a la vez y cada
//     uno tiene que traer LO SUYO: sin los dos en la clave, el segundo leeria la respuesta
//     cacheada del primero.
//  3. **Lleva la pagina** (R34 otra vez): dos paneles abiertos llevan su propia pagina.
//  4. **Comparte el prefijo `CLAVE_TABLERO`** (R60). Es lo UNICO que hace que el boton
//     «Actualizar» revalide tambien el detalle abierto: ese boton no conoce esta lectura ni
//     tiene por que —hace `mutate((clave) => Array.isArray(clave) && clave[0] === CLAVE_TABLERO)`—.
//     El prefijo se IMPORTA, nunca se reescribe.
//
// ⚠ EL `tienda_id` VIAJA COMO UNA FACETA MAS DEL FILTRO, y no como un campo suelto. Es la pieza
// que hace que el detalle no abra una segunda puerta a la frontera multi-tenant: entra por la
// faceta que `recortarFiltroConteoEntregas` YA interseca con el alcance del actor, asi que una
// tienda ajena produce `forbidden` (R44) y la concedida acaba en el `WHERE` de SQL (R43/R7).
// El servidor exige EXACTAMENTE una, asi que se SUSTITUYE la faceta del filtro de la seccion en
// vez de anadirse a ella: si el usuario hubiera filtrado tres tiendas arriba, mandarlas todas
// seria un `validation_error` y el panel de la fila no es de tres tiendas, es de una.

import { consultarDetalleDineroProducto } from "@/lib/actions/detalle-dinero-producto";
import type { ResultadoDetalleDineroProducto } from "@/lib/types/dinero-productos";

import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

/** Distingue esta lectura de las otras que comparten filtro y prefijo. */
const SUBCLAVE = "detalle-dinero-producto";

/**
 * La clave SWR de UN panel: prefijo del tablero, subclave propia, filtro serializado, la fila
 * (tienda + producto) y la pagina.
 */
export function claveDetalleDineroProducto(
  filtroSerializado: string,
  tiendaId: string,
  producto: string,
  page: number,
): readonly [string, string, string, string, string, number] {
  return [CLAVE_TABLERO, SUBCLAVE, filtroSerializado, tiendaId, producto, page];
}

/**
 * El `raw` de la Server Action: el filtro de la seccion con la tienda de la fila FIJADA, la
 * clave del producto y la pagina.
 *
 * `producto_clave` se manda con la forma VISIBLE del producto y no con una clave normalizada
 * aqui: el servidor la normaliza con `claveDeProducto`, que es la MISMA funcion que la produjo.
 * Normalizarla en el cliente seria una segunda definicion de la misma identidad, y bastaria un
 * espacio de mas para que el panel saliera vacio sin que nada lo delatara.
 *
 * `pageSize` NO se manda: su valor por defecto y su tope viven en la configuracion del servidor
 * (R41). Un numero escrito aqui seria un segundo sitio donde ajustarlo.
 */
export function rawDetalleDineroProducto(
  filtroSerializado: string,
  tiendaId: string,
  producto: string,
  page: number,
): Record<string, unknown> {
  const filtro = JSON.parse(filtroSerializado) as Record<string, unknown>;
  return {
    filtro: { ...filtro, tienda_id: [tiendaId] },
    producto_clave: producto,
    page,
  };
}

/**
 * La lectura sale de UNA Server Action y de ninguna otra puerta.
 *
 * NO se lanza en los estados que no son `ok`: `vacio`, `forbidden` y `limite_excedido` son
 * RESPUESTAS del contrato, no fallos, y el panel tiene un texto para cada una. Lanzar los
 * convertiria a todos en «se rompio», que es justo la degradacion que el resto de la seccion
 * evita (R62).
 */
export async function consultarDetalleDineroProductoSwr(
  filtroSerializado: string,
  tiendaId: string,
  producto: string,
  page: number,
): Promise<ResultadoDetalleDineroProducto> {
  return consultarDetalleDineroProducto(
    rawDetalleDineroProducto(filtroSerializado, tiendaId, producto, page),
  );
}
