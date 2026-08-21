// La CLAVE SWR y el fetcher del conteo de entregas, en un solo sitio.
//
// Existen aparte (2026-08-19) porque ya son DOS los componentes que leen esta misma entrada: el
// anillo, que pinta las cifras, y el botón «Actualizar», que pinta su sello `lastSync`. Con la
// clave escrita a mano en cada uno, el día que a una le cambie una pieza —el prefijo, el orden,
// la subclave— dejarían de compartir entrada sin que nada se ponga rojo: el botón enseñaría la
// frescura de una consulta que no es la que hay en pantalla, y encima habría dos peticiones
// donde antes había una (SWR comparte petición y caché por IGUALDAD de clave, no por
// parecido).

import { consultarConteoEntregas } from "@/lib/actions/conteo-entregas";
import type { ResultadoConteoEntregas } from "@/lib/types/conteo-entregas";

import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

/** Distingue esta lectura de las otras cinco que comparten filtro y prefijo. */
const SUBCLAVE = "conteo-entregas";

/**
 * La clave SWR de esta lectura. El filtro ENTRA en la clave: cambiarlo cambia la clave y SWR
 * vuelve a consultar; sin él, en pantalla quedaría la cifra del filtro anterior como si fuera
 * la del nuevo.
 *
 * Comparte el prefijo `CLAVE_TABLERO` con el resto del tablero, que es lo que permite al botón
 * revalidarlas todas sin conocer ninguna.
 */
export function claveConteoEntregas(filtroSerializado: string): readonly [string, string, string] {
  return [CLAVE_TABLERO, SUBCLAVE, filtroSerializado];
}

/** La cifra sale de UNA Server Action y de ninguna otra puerta. */
export async function consultarConteoEntregasSwr(
  filtroSerializado: string,
): Promise<ResultadoConteoEntregas> {
  return consultarConteoEntregas(JSON.parse(filtroSerializado) as unknown);
}
