// Feature 24 (design §5.1). Normalizacion de nombres de zona: una clave de
// deduplicacion (para unicidad R2/R21 y dedup del seed R35) y una forma canonica
// para mostrar. Reutilizado por ZonaService y por scripts/seed-zonas.ts.

// Acronimos reconocidos que se conservan en MAYUSCULAS en la forma canonica
// (design §5.1). Se comparan por su clave normalizada.
const ACRONIMOS = new Set<string>(["gam"]);

// Feature 91: `collapseSpaces` y `stripDiacritics` se EXPORTAN (antes privadas) para
// reutilizarlas en `lib/geo/direccion-query.ts`. Su comportamiento NO cambia: siguen
// siendo exactamente las mismas funciones que consumen `normalizeZonaKey` y
// `canonicalZonaNombre`.

/** trim + colapso de espacios internos a uno solo. */
export function collapseSpaces(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Quita acentos/diacriticos: NFD + elimina marcas combinantes. */
export function stripDiacritics(raw: string): string {
  return raw.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Clave de deduplicacion de una zona (design §5.1). Devuelve `null` cuando el
 * valor es vacio o solo espacios (distrito sin zona, R36).
 *
 * Ejemplos: `GAM`/`Gam` -> `"gam"`; `LIMON ABAJO`/`LIMÓN ABAJO` -> `"limon abajo"`.
 */
export function normalizeZonaKey(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const collapsed = collapseSpaces(raw);
  if (collapsed === "") return null;
  return stripDiacritics(collapsed).toLowerCase();
}

/** Title Case de una sola palabra (primera letra mayuscula, resto minuscula). */
function titleCaseWord(word: string): string {
  if (word === "") return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Forma canonica mostrada de una zona (design §5.1): trim + colapso de espacios +
 * Title Case por palabra, con excepcion de acronimos reconocidos (p. ej. `GAM`)
 * que se conservan en MAYUSCULAS. Devuelve `null` para valores vacios (R36).
 *
 * Ejemplos: `gam` -> `"GAM"`; `ZONA SUR` -> `"Zona Sur"`; `limon abajo` -> `"Limon Abajo"`.
 */
export function canonicalZonaNombre(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const collapsed = collapseSpaces(raw);
  if (collapsed === "") return null;

  return collapsed
    .split(" ")
    .map((word) => {
      const key = stripDiacritics(word).toLowerCase();
      if (ACRONIMOS.has(key)) return word.toUpperCase();
      return titleCaseWord(word);
    })
    .join(" ");
}
