import type { OrdenFilterField } from "@/lib/types/orden";

// Feature 144 / B4 (design.md §4.3, R61) — identidad de cache/refetch del listado.

/**
 * Filtro tal como lo construye la UI: las claves de la lista blanca del borde, con
 * listas de ids o valores escalares. Es deliberadamente mas laxo que
 * `OrdenFilterInput` (que exige listas NO vacias): la UI omite las claves vacias
 * ANTES de enviarlas (`seleccionAFilter`), y el borde valida igualmente.
 */
export type OrdenesFilterUI = Partial<Record<OrdenFilterField, string | string[]>>;

/**
 * Serializacion ESTABLE del filtro para la key de SWR (R61): claves ordenadas y, en
 * cada lista, valores ordenados. Asi dos selecciones con los mismos valores —en
 * distinto orden o con distinta identidad de objeto— producen la MISMA key, comparten
 * cache y no provocan una consulta nueva en cada render.
 *
 * Generaliza la disciplina que la feature 63 ya tenia para `status_id`.
 * Sin `filter`, devuelve `""`: la llamada a `listarOrdenes` es la previa a esta
 * feature (R45/R59, sin regresion).
 */
export function serializarFiltro(filter?: OrdenesFilterUI): string {
  if (!filter) return "";
  return Object.keys(filter)
    .sort()
    .map((clave) => {
      const valor = filter[clave as OrdenFilterField];
      if (valor === undefined) return null;
      return `${clave}=${Array.isArray(valor) ? [...valor].sort().join(",") : valor}`;
    })
    .filter((parte): parte is string => parte !== null)
    .join("&");
}
