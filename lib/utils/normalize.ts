// Normalizador de nombres reutilizable (feature 24). Sirve para indexar/comparar
// nombres de forma estable y tolerante a erratas tipograficas: minusculas, sin
// acentos/diacriticos, sin caracteres especiales, sin espacios sobrantes. Pensado
// para claves de indices (arbol de zonas/geografia, carga masiva) y para
// comparaciones insensibles a mayusculas/acentos en otras secciones. Se aplica
// SIMETRICAMENTE a los datos de la DB y a la entrada del usuario, de modo que el
// match no dependa de mayusculas, acentos, puntuacion ni espacios duplicados.
//
// Ej: "  Perez  Zeledon " -> "perez zeledon"; "GUANACASTE" -> "guanacaste";
//     "San  Pedro" -> "san pedro"; "San José-Centro" -> "san jose centro".
export function normalizeName(value: string): string {
  return value
    .normalize("NFD") // separa cada letra de sus diacriticos combinantes
    .replace(/\p{Mn}/gu, "") // elimina las marcas combinantes (acentos/diacriticos)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // caracteres especiales/puntuacion -> espacio
    .trim()
    .replace(/\s+/g, " "); // colapsa espacios internos (incl. los recien insertados)
}
