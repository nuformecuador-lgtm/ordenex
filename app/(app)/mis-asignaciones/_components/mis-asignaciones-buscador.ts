// Feature 114 — buscador de guías asignadas del mensajero. Función PURA de filtrado
// (sin DOM, sin negocio de dominio) sobre las asignaciones que ya llegan por props al
// módulo. Reutiliza `normalizeName` (feature 24) para NO duplicar la normalización
// (NFD + strip de diacríticos + minúsculas + trim + colapso de espacios), de modo que
// la coincidencia sea PARCIAL e insensible a mayúsculas/acentos (R3). Es importable sin
// arrastrar jsdom: se testea aparte en `tests/unit/components`.

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { normalizeName } from "@/lib/utils/normalize";

/**
 * Texto normalizado buscable de una guía: `numGuia` (num→texto, `null`→""),
 * `numRemision` y `destinatario` concatenados con un espacio. Al normalizar por igual
 * el texto y el query (ver `coincideBusqueda`), la coincidencia queda insensible a
 * mayúsculas y acentos (R3). `numGuia` `null` aporta "" y no impide la coincidencia por
 * remisión o destinatario (R4).
 */
export function textoBuscable(orden: MiAsignacionDTO): string {
  const guia = orden.numGuia === null ? "" : String(orden.numGuia);
  return normalizeName(`${guia} ${orden.numRemision} ${orden.destinatario}`);
}

/**
 * `true` si el query YA NORMALIZADO es subcadena del texto buscable de la orden. Un
 * query vacío coincide con TODO (R5): así el filtrado no descarta nada cuando no hay
 * búsqueda. Espera el query ya pasado por `normalizeName` (el llamador lo normaliza una
 * sola vez).
 */
export function coincideBusqueda(
  orden: MiAsignacionDTO,
  queryNormalizado: string,
): boolean {
  if (queryNormalizado === "") return true; // R5: sin búsqueda ⇒ todo coincide.
  return textoBuscable(orden).includes(queryNormalizado);
}

/**
 * Filtra una lista con un query CRUDO (aún sin normalizar). Preserva el orden de
 * entrada. Query vacío o solo-espacios ⇒ devuelve la MISMA lista sin filtrar (R5):
 * `normalizeName("   ")` colapsa a "".
 */
export function filtrarAsignaciones(
  ordenes: MiAsignacionDTO[],
  query: string,
): MiAsignacionDTO[] {
  const q = normalizeName(query);
  if (q === "") return ordenes; // R5: misma referencia, sin recorrer.
  return ordenes.filter((orden) => coincideBusqueda(orden, q));
}
