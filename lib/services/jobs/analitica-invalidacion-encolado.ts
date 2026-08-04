// Feature 128 (T6.2, design §7.1) — IDENTIDAD DE ENCOLADO del job puntual
// `analitica_invalidacion_cache`.
//
// Modulo PURO: sin Prisma, sin Next y sin reloj propio. Vive separado del handler por el mismo
// motivo que su hermano `analitica-rollup-diario-encolado.ts`: la clave la necesitan el script
// del backfill y los tests, y ninguno debe importar la fabrica del servicio —con su cliente
// Prisma detras— solo para construir una cadena.

/** Prefijo del `dedupe_key`. Tambien es el valor del enum `job_tipo`. */
export const DEDUPE_PREFIX_INVALIDACION = "analitica_invalidacion_cache";

/**
 * `analitica_invalidacion_cache:<desde>..<hasta>:<epoch>`.
 *
 * ⚠ EL `epoch` NO ES RUIDO: es lo que hace que la clave NO deduplique entre corridas.
 *
 * `IJobRepository.enqueue` inserta con `ON CONFLICT ("dedupe_key") DO NOTHING`. La clave del
 * rollup diario (`analitica_rollup_diario:<fecha>`) quiere deduplicar: dos siembras del mismo
 * dia son el MISMO trabajo. Aqui es al reves. Dos backfills del mismo rango en el mismo dia
 * son dos recomputos DISTINTOS, y el segundo tiene que invalidar igual que el primero: si la
 * clave los fundiera, el segundo encolado se descartaria en silencio y la cache serviria las
 * cifras del primer recomputo. Es exactamente el modo de fallo que R12 evita.
 *
 * Lo que el `dedupe_key` si sigue dando es la idempotencia dentro de UNA corrida: el script
 * calcula la clave una vez y un reintento del mismo proceso no encola dos veces.
 *
 * @param desde fecha CR `YYYY-MM-DD`, inclusive, del rango recomputado.
 * @param hasta fecha CR `YYYY-MM-DD`, inclusive.
 * @param instante momento de la corrida (inyectado: nada de `Date.now()` escondido).
 */
export function dedupeKeyInvalidacion(desde: string, hasta: string, instante: Date): string {
  return `${DEDUPE_PREFIX_INVALIDACION}:${desde}..${hasta}:${instante.getTime()}`;
}

/** Payload del job. Solo para el registro (R23): la invalidacion es POR DOMINIO, no por fecha. */
export interface PayloadInvalidacionCache extends Record<string, unknown> {
  readonly desde: string;
  readonly hasta: string;
}

export function payloadInvalidacion(desde: string, hasta: string): PayloadInvalidacionCache {
  return { desde, hasta };
}
