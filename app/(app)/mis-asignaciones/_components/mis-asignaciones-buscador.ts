// Feature 114 — buscador de guías asignadas del mensajero. Función PURA de filtrado
// (sin DOM, sin negocio de dominio) sobre las asignaciones que ya llegan por props al
// módulo. Reutiliza `normalizeName` (feature 24) para NO duplicar la normalización
// (NFD + strip de diacríticos + minúsculas + trim + colapso de espacios), de modo que
// la coincidencia sea PARCIAL e insensible a mayúsculas/acentos (R3). Es importable sin
// arrastrar jsdom: se testea aparte en `tests/unit/components`.

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { normalizeName } from "@/lib/utils/normalize";

/** Solo los dígitos de un texto: "8888-0000" → "88880000". */
function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/**
 * `true` si el query parece un teléfono tecleado con separadores: solo dígitos y
 * los separadores habituales (espacio, guion, parentesis, +) y al menos 4 dígitos.
 * Acota el reintento en solo-dígitos a ese caso.
 */
function pareceTelefono(query: string): boolean {
  return /^[\d\s()+-]+$/.test(query) && soloDigitos(query).length >= 4;
}

/**
 * Texto normalizado buscable de una guía: `numGuia` (num→texto, `null`→""),
 * `numRemision`, `destinatario` y `telefonoDest` concatenados con un espacio. Al
 * normalizar por igual el texto y el query (ver `coincideBusqueda`), la coincidencia
 * queda insensible a mayúsculas y acentos (R3). `numGuia` `null` aporta "" y no impide
 * la coincidencia por remisión, destinatario o teléfono (R4).
 *
 * Del teléfono se añade además su forma SOLO-DÍGITOS cuando difiere del valor guardado
 * (p. ej. "8888-0000" aporta también "88880000"), para que el número se encuentre igual
 * se teclee con o sin separadores.
 */
export function textoBuscable(orden: MiAsignacionDTO): string {
  const guia = orden.numGuia === null ? "" : String(orden.numGuia);
  const telefono = orden.telefonoDest ?? "";
  const digitos = soloDigitos(telefono);
  const partes = [guia, orden.numRemision, orden.destinatario, telefono];
  if (digitos !== "" && digitos !== telefono) partes.push(digitos);
  return normalizeName(partes.join(" "));
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
  const texto = textoBuscable(orden);
  if (texto.includes(queryNormalizado)) return true;
  // Teléfono tecleado con separadores ("8888-0000", "+506 8888 0000") contra un número
  // guardado sin ellos: se reintenta con el query en solo-dígitos. Solo si el query
  // PARECE un teléfono (ver `pareceTelefono`): con un query como "rem-0" el fallback
  // buscaría "0" y coincidiría con casi todo.
  if (!pareceTelefono(queryNormalizado)) return false;
  const digitos = soloDigitos(queryNormalizado);
  if (digitos === queryNormalizado) return false; // sin separadores: mismo intento.
  return texto.includes(digitos);
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
