// Normalizador de nombres reutilizable (feature 24). Sirve para indexar/comparar
// nombres de forma estable: minusculas, sin acentos/diacriticos, sin espacios
// sobrantes. Pensado para claves de indices (arbol de zonas/geografia) y para
// comparaciones insensibles a mayusculas/acentos en otras secciones.
//
// Ej: "  Perez  Zeledon " -> "perez zeledon"; "GUANACASTE" -> "guanacaste".
export function normalizeName(value: string): string {
  return value
    .normalize("NFD") // separa cada letra de sus diacriticos combinantes
    .replace(/\p{Mn}/gu, "") // elimina las marcas combinantes (acentos/diacriticos)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " "); // colapsa espacios internos
}
