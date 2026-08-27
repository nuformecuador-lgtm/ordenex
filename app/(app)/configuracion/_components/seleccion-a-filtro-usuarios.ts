import type { RolValue } from "@prisma/client";

import type { FilterSelection } from "@/components/shared/FilterComponent";
import {
  USUARIO_BUSQUEDA_MAX_CHARS,
  USUARIO_BUSQUEDA_MIN_CHARS,
} from "@/lib/types/usuario";

import { CLAVE_ROL } from "./usuarios-filtros-def";

// Feature 285 (design §4.3) — traduccion de la seleccion agregada del componente
// GENERICO a las claves que acepta `listarUsuariosSchema`. Calco del patron de
// `seleccion-a-filter.ts`, SIN importar nada de ordenes: aquella esta tipada sobre
// `OrdenFilterField` y conoce claves que aqui no existen.
//
// La traduccion es responsabilidad de la SUPERFICIE, no del componente compartido: otro
// consumidor con otro transporte escribiria la suya.

/**
 * El filtro tal como lo construye la UI. Es deliberadamente mas laxo que el input del
 * borde (que exige lista NO vacia): la UI OMITE las claves vacias antes de enviarlas, y
 * el borde valida igualmente.
 */
export type FiltroUsuariosUI = { q?: string; rol?: RolValue[] };

/**
 * `FilterSelection` + termino del buscador -> entrada de `listarUsuarios`.
 *
 * Reglas duras del borde que esta funcion NO puede violar:
 *
 * - **Una lista de roles VACIA se OMITE, jamas se manda `[]`.** El schema la declara
 *   `.nonempty()`, asi que `[]` es `validation_error` y NUNCA "sin filtro". Falla
 *   cerrado: si en vez de omitirla se mandara vacia, un filtro presente degradaria a
 *   "todos" y el listado devolveria DE MAS.
 * - **El termino se recorta** antes de mirarlo: el borde hace `.trim()` ANTES del
 *   `.min()`, asi que `"  a  "` es 1 caracter, no 5.
 * - **El termino se TRUNCA al maximo (R9)**, y por eso se vuelve a recortar despues: si
 *   el corte cae dentro de una tira de espacios, lo que quedaria seria mas corto de lo
 *   que aparenta, y ese `.trim()` del borde lo dejaria por debajo del minimo. Pegar 500
 *   caracteres no puede acabar en un listado en estado de error.
 * - **Por debajo del minimo la clave se OMITE** (R7): no es un error de validacion, es
 *   "todavia no hay busqueda". `BuscadorFiltros` ya emite `""` por debajo de su
 *   `minChars`; esto es defensa en profundidad, no un segundo sitio donde vive la regla
 *   (el numero sale de la MISMA constante que valida el borde, R29).
 */
export function seleccionAFiltroUsuarios(
  sel: FilterSelection,
  termino: string,
): FiltroUsuariosUI {
  const out: FiltroUsuariosUI = {};

  const roles = sel[CLAVE_ROL];
  // La lista vacia NO se emite: la clave desaparece del objeto (R14/R15).
  if (roles && roles.length > 0) {
    // `FilterSelection` es `Record<string, string[]>` —el componente generico no conoce
    // el enum—, y las opciones ofrecidas salen de `ROL_LABELS`, que SI esta tipado sobre
    // `RolValue`. El borde vuelve a validar cada valor contra la lista blanca, asi que
    // este es el unico punto donde hace falta el estrechamiento, y no reemplaza a nada.
    out.rol = roles as RolValue[];
  }

  const recortado = termino
    .trim()
    .slice(0, USUARIO_BUSQUEDA_MAX_CHARS) // R9: truncar, nunca dejar que el borde rechace
    .trim();
  if (recortado.length >= USUARIO_BUSQUEDA_MIN_CHARS) out.q = recortado;

  return out;
}

/**
 * ¿Hay algun filtro puesto AHORA MISMO? Se pregunta sobre el filtro ya traducido —no
 * sobre la seleccion cruda— porque es lo traducido lo que decide las tres cosas que
 * dependen de esta respuesta: si el `fallbackData` del servidor sigue valiendo, si el
 * vacio de la tabla puede seguir diciendo "crea el primer usuario", y si la descarga
 * viaja con filtros o con la entrada de siempre.
 *
 * Preguntarlo sobre la seleccion daria `true` con un control montado pero sin marcar, o
 * con un termino de un solo caracter — y en los dos casos el listado que se va a pintar
 * es el completo.
 */
export function hayFiltroUsuarios(filtro: FiltroUsuariosUI): boolean {
  return filtro.q !== undefined || filtro.rol !== undefined;
}

/**
 * Identidad ESTABLE del filtro para la key de SWR y para detectar el cambio que devuelve
 * a la pagina 1 (R18).
 *
 * Los roles se ORDENAN: dos selecciones equivalentes marcadas en distinto orden
 * producen la misma clave, comparten cache y no disparan una consulta nueva en cada
 * render. Es la misma disciplina que `serializarFiltro` en ordenes, escrita aqui en tres
 * lineas en vez de importada de alla (design §10, alternativa D).
 */
export function serializarFiltroUsuarios(filtro: FiltroUsuariosUI): string {
  const roles = [...(filtro.rol ?? [])].sort().join(",");
  return `q=${filtro.q ?? ""}&rol=${roles}`;
}
