// FICHA 345 (T7.1) — la CLAVE SWR y el fetcher del analisis de productos, en un solo sitio.
//
// Mismo molde que `conteo-entregas-swr.ts`, y por el mismo motivo: la clave la necesitan hoy la
// tabla y manana quien quiera pintar su sello o su total, y escrita a mano en cada sitio dejaria
// de ser LA MISMA en cuanto a una le cambiara una pieza —el prefijo, el orden, la subclave—.
// SWR comparte peticion y cache por IGUALDAD de clave, no por parecido: dos claves «casi
// iguales» son dos peticiones a la base y dos respuestas que pueden discrepar en pantalla.
//
// LAS DOS PROPIEDADES QUE ESTA CLAVE TIENE QUE CUMPLIR, y las dos estan aqui:
//
//  1. **Lleva el filtro** (R40/R41). Cambiar el rango o una faceta cambia la clave y SWR vuelve a
//     consultar; sin el filtro dentro, en pantalla quedaria la tabla del filtro ANTERIOR como si
//     fuera la del nuevo — que es la peor clase de dato equivocado, porque parece correcto.
//  2. **Comparte el prefijo `CLAVE_TABLERO`** (R42). Es lo unico que hace que el boton
//     «Actualizar» la revalide: ese boton no conoce esta lectura ni tiene por que —hace
//     `mutate((clave) => Array.isArray(clave) && clave[0] === CLAVE_TABLERO)`—. El prefijo se
//     IMPORTA, nunca se reescribe: un literal aqui dejaria la tabla fuera del refresco el dia
//     que la constante cambie, y en silencio.

import { consultarConteoProductos } from "@/lib/actions/conteo-productos";
import type { ResultadoConteoProductos } from "@/lib/types/conteo-productos";

import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

/** Distingue esta lectura de las otras seis que comparten filtro y prefijo. */
const SUBCLAVE = "conteo-productos";

/**
 * La clave SWR del analisis de productos: prefijo del tablero, subclave propia y el filtro
 * serializado.
 */
export function claveConteoProductos(
  filtroSerializado: string,
): readonly [string, string, string] {
  return [CLAVE_TABLERO, SUBCLAVE, filtroSerializado];
}

/**
 * La cifra sale de UNA Server Action y de ninguna otra puerta.
 *
 * Lo que se manda es el filtro y NADA MAS: `conteoEntregasFiltroSchema` es `.strict()`, asi que
 * una clave de mas —«rol», «tienda», «alcance»— no es un extra inocuo sino un `validation_error`.
 * El alcance lo resuelve el servidor a partir de la sesion; el cliente no opina.
 */
export async function consultarConteoProductosSwr(
  filtroSerializado: string,
): Promise<ResultadoConteoProductos> {
  return consultarConteoProductos(JSON.parse(filtroSerializado) as unknown);
}
