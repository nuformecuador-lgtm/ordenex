/**
 * Feature 194 — preferencia de columnas del manifiesto, por FLUJO.
 *
 * FICHA 314: la MAQUINARIA se mudó a `lib/columnas/preferencia-columnas.ts`, generalizada por
 * ámbito. Aquí queda lo único que es propio del manifiesto: su CLAVE de almacenamiento y los
 * dos accesores de su catálogo. El razonamiento de por qué se guardan las columnas OCULTAS y
 * no las visibles vive ahora en la cabecera de aquel módulo, y sigue rigiendo íntegro.
 *
 * LA CLAVE NO SE TOCA, y no es un detalle de estilo (design 314 §0/D3). El manifiesto es
 * superficie viva en producción: mover el prefijo huerfanaría en silencio todas las
 * preferencias guardadas hoy en el navegador de la gente. No fallaría nada — simplemente
 * volverían todas las columnas. Un fallo mudo.
 */
import { etiquetaColumna } from "@/lib/manifiesto/etiquetas-columnas";
import type { ManifiestoFlujo } from "@/lib/types/manifiesto";
import type { XlsxColumn } from "@/lib/utils/xlsx-template";

/** Prefijo de la clave de almacenamiento. `ordenex:` sigue el precedente de `CLAVE_SONIDO`. */
const PREFIJO_CLAVE = "ordenex:manifiesto-columnas:";

/** Clave propia de cada flujo (194/R14). Un flujo NUNCA lee ni escribe la clave de otro (R10). */
export function claveColumnas(flujo: ManifiestoFlujo): string {
  return `${PREFIJO_CLAVE}${flujo}`;
}

/**
 * Accesor de clave del ámbito manifiesto. Declarado a NIVEL DE MÓDULO a propósito (design
 * 314 §5): un `(c) => c.key` escrito en el JSX cambia de identidad en cada render y recalcula
 * las derivaciones del hook sin necesidad.
 */
export function claveDeColumnaManifiesto(columna: XlsxColumn): string {
  return columna.key;
}

/**
 * Etiqueta del selector: `Etiqueta legible (clave_maquina)` (194 requirements D-A). El ARCHIVO
 * sigue emitiendo solo la clave máquina; la pantalla es una vista, y el usuario necesita casar
 * casilla y columna sin adivinar. Una columna sin etiqueta declarada cae al fallback de
 * `etiquetaColumna` y se muestra con su propia clave (194/R5).
 */
export function etiquetaDeColumnaManifiesto(columna: XlsxColumn): string {
  return `${etiquetaColumna(columna.header)} (${columna.header})`;
}
