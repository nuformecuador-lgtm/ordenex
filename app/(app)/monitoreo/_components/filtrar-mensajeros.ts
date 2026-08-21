// Feature 258 (F4.1) — el filtro por nombre y las iniciales del avatar, en funciones PURAS.
//
// Sin React, sin DOM y sin dominio: entran filas y una cadena, sale un subconjunto. Vive
// aparte del componente para poder probar la normalizacion (que es donde de verdad se
// equivoca un filtro: acentos y mayusculas) sin montar nada.
//
// ⛔ EL FILTRO NO TOCA LA URL (R73). El unico parametro de estado de la ruta sigue siendo
// `?mensajero=`. Anadir un `?q=` obliga a decidir que ve quien abre un enlace compartido con
// filtro puesto, y eso es una decision de producto que nadie ha tomado.
//
// ⛔ EL FILTRO NO ORDENA (R40). Recibe las filas YA ordenadas por `ordenarFilasTablero` y
// conserva su orden: dos criterios de orden en la misma pantalla acaban pintando distinto
// segun quien toque el dato al final.

import type { FilaTableroDia } from "@/lib/types/tablero-dia";

/**
 * R41 — minusculas y SIN acentos, para que «jimenez» encuentre «Jiménez».
 *
 * `NFD` descompone cada letra acentuada en su letra base mas su marca diacritica, y el rango
 * `\u0300-\u036f` (Combining Diacritical Marks) borra las marcas. Se hace asi y no con una
 * tabla `a con tilde -> a` escrita a mano porque una tabla se queda corta con la primera
 * letra que nadie previo (dieresis, cedilla...).
 *
 * ⚠️ La `ñ` tambien se descompone (`n` + tilde), asi que «munoz» encuentra «Muñoz». Es
 * deliberado: en un buscador de nombres es lo que la gente espera cuando teclea deprisa.
 */
export function normalizarNombre(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * R40 — recorta QUE filas se pintan y nada mas: no consulta, no reordena y no muta la
 * entrada. Con la consulta vacia (o solo espacios) devuelve las filas TAL CUAL, sin copiar:
 * «sin filtro» y «filtro que no descarta a nadie» no son el mismo estado.
 */
export function filtrarFilas(
  filas: readonly FilaTableroDia[],
  consulta: string,
): readonly FilaTableroDia[] {
  const buscado = normalizarNombre(consulta);
  if (buscado === "") return filas;
  return filas.filter((fila) => normalizarNombre(fila.mensajeroNombre).includes(buscado));
}

/** `true` si la consulta recorta algo, es decir si hay filtro ACTIVO. */
export function hayFiltroActivo(consulta: string): boolean {
  return normalizarNombre(consulta) !== "";
}

/**
 * R71 — las iniciales del avatar. «Ana Rojas» -> «AR»; un solo nombre -> su primera letra.
 *
 * Los acentos NO se quitan aqui, a diferencia del filtro: el avatar MUESTRA la inicial, y
 * «Ángela» empieza por Á. Se toma la primera y la ULTIMA palabra (nombre y primer apellido),
 * que es como viaja el nombre en la fila.
 *
 * El avatar es DECORATIVO (`aria-hidden` en quien lo pinta) y el nombre completo sigue
 * presente como texto: dos iniciales nunca identifican a nadie por si solas.
 */
export function iniciales(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return "";
  const primera = [...palabras[0]][0] ?? "";
  const ultima = palabras.length > 1 ? ([...palabras[palabras.length - 1]][0] ?? "") : "";
  return `${primera}${ultima}`.toLocaleUpperCase("es");
}
