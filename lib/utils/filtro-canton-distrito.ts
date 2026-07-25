// Feature 117 — filtro de asignaciones del mensajero por cantón y distrito. Lógica
// PURA de derivación de opciones y filtrado (sin React, sin DOM, sin Server Actions),
// aplicada 100% en cliente sobre los `MiAsignacionDTO[]` que ya llegan por props al
// módulo (R12). Reutiliza `normalizeName` (feature 24) para deduplicar/comparar de
// forma insensible a mayúsculas/acentos/espacios, sin duplicar la normalización.

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import { normalizeName } from "@/lib/utils/normalize";

/**
 * Una opción de los selects de filtro. `value` = nombre ORIGINAL (no normalizado) que
 * se guarda en el estado y con el que se filtra; `label` = texto mostrado.
 */
export interface OpcionFiltro {
  value: string;
  label: string;
}

// Colación en español, insensible a acentos/caso, para un orden alfabético estable
// (que no "salte" opciones al cambiar la selección).
function compararEs(a: string, b: string): number {
  return a.localeCompare(b, "es", { sensitivity: "base" });
}

/**
 * R2/R13 — opciones del select de Cantón derivadas de TODAS las asignaciones cargadas
 * (no del subconjunto ya filtrado, para que la selección no elimine otras opciones).
 *   - dedup por la clave cantón+provincia (normalizada), conservando los primeros
 *     nombres originales vistos;
 *   - `label` = `"<Cantón> (<Provincia>)"` para desambiguar cantones homónimos
 *     (p. ej. "Central (San José)" vs "Central (Alajuela)"), decisión del gate F1.4;
 *   - `value` = nombre original del cantón (el filtrado es por nombre de cantón);
 *   - orden alfabético por la etiqueta (cantón y, dentro de homónimos, provincia).
 */
export function derivarCantones(ordenes: MiAsignacionDTO[]): OpcionFiltro[] {
  const vistos = new Map<string, OpcionFiltro>();
  for (const orden of ordenes) {
    const clave = `${normalizeName(orden.cantonNombre)}|${normalizeName(
      orden.provinciaNombre,
    )}`;
    if (!vistos.has(clave)) {
      vistos.set(clave, {
        value: orden.cantonNombre,
        label: `${orden.cantonNombre} (${orden.provinciaNombre})`,
      });
    }
  }
  return [...vistos.values()].sort((a, b) => compararEs(a.label, b.label));
}

/**
 * R4 — opciones del select de Distrito: los `distritoNombre` distintos (no nulos) de
 * las asignaciones cuyo cantón coincide con `cantonNombre` (comparación normalizada
 * para tolerar acentos/caso), deduplicados y ordenados alfabéticamente. `value` =
 * `label` = nombre original del distrito.
 */
export function derivarDistritos(
  ordenes: MiAsignacionDTO[],
  cantonNombre: string,
): OpcionFiltro[] {
  const cantonNorm = normalizeName(cantonNombre);
  const vistos = new Map<string, OpcionFiltro>();
  for (const orden of ordenes) {
    if (normalizeName(orden.cantonNombre) !== cantonNorm) continue;
    if (orden.distritoNombre === null) continue;
    const clave = normalizeName(orden.distritoNombre);
    if (!vistos.has(clave)) {
      vistos.set(clave, {
        value: orden.distritoNombre,
        label: orden.distritoNombre,
      });
    }
  }
  return [...vistos.values()].sort((a, b) => compararEs(a.label, b.label));
}

/**
 * R6/R7 — aplica el filtro combinado, preservando el orden de entrada.
 *   - `canton === ""` (sin cantón): devuelve la MISMA lista sin recorrer (R7).
 *   - con cantón: conserva las órdenes cuyo `cantonNombre` coincide (normalizado).
 *   - con distrito además: exige `distritoNombre !== null` y coincidencia normalizada;
 *     las órdenes con `distritoNombre === null` quedan excluidas bajo distrito (R6).
 */
export function filtrarAsignaciones(
  ordenes: MiAsignacionDTO[],
  filtro: { canton: string; distrito: string },
): MiAsignacionDTO[] {
  const { canton, distrito } = filtro;
  if (canton === "") return ordenes; // R7: sin filtro, misma referencia.
  const cantonNorm = normalizeName(canton);
  const distritoNorm = distrito === "" ? "" : normalizeName(distrito);
  return ordenes.filter((orden) => {
    if (normalizeName(orden.cantonNombre) !== cantonNorm) return false;
    if (distritoNorm === "") return true; // solo cantón.
    if (orden.distritoNombre === null) return false; // R6: excluye distrito nulo.
    return normalizeName(orden.distritoNombre) === distritoNorm;
  });
}
