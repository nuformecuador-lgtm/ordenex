// Feature 124 (D4->C1, design §8, R36) — identidad de encolado del job recurrente
// `analitica_rollup_diario`. Modulo PURO: sin Prisma, sin Next.js y sin reloj propio.
//
// Vive separado del handler a proposito: la clave de deduplicacion la necesitan el handler
// (recurrencia), el script de siembra y el de invocacion manual, y ninguno de esos tres debe
// tener que importar la fabrica del servicio —con su cliente Prisma detras— solo para
// construir una cadena.
//
// Este modulo NO nombra la tabla del rollup ni la consulta de ninguna forma: la unica puerta a
// esa tabla es `lib/repositories/AnaliticaRollupRepository.ts` (guardia de frontera, R42).

/** Prefijo del `dedupe_key`: `analitica_rollup_diario:<YYYY-MM-DD CR objetivo>`. */
export const DEDUPE_PREFIX = "analitica_rollup_diario";

/**
 * R36 — la clave es la **FECHA OBJETIVO** (el dia que esa corrida va a agregar), NO la fecha
 * en que la corrida se ejecuta.
 *
 * Por que importa y no es un detalle cosmetico: la corrida de las 00:30 CR del dia D+1 agrega
 * D. Si la clave llevara la fecha de la corrida (D+1), la siembra manual del objetivo D y el
 * reencolado automatico producirian DOS claves distintas para el MISMO trabajo, el
 * `ON CONFLICT DO NOTHING` del `enqueue` no colisionaria y quedarian dos filas en `jobs`
 * agregando la misma fecha. Con la fecha objetivo, dos siembras del mismo dia colisionan y
 * dejan exactamente una fila.
 *
 * @param fecha fecha calendario CR `YYYY-MM-DD` que la corrida agregara.
 */
export function dedupeKeyRollup(fecha: string): string {
  return `${DEDUPE_PREFIX}:${fecha}`;
}
