// Feature 46 (R9) — hora de Costa Rica para comparar `fecha_reprogramacion` por DIA.
// America/Costa_Rica es UTC-6 fijo (sin horario de verano), asi que el offset es una
// constante y no hace falta la API de zonas horarias.
//
// `fecha_reprogramacion` es `@db.Date` y la feature 36 la almacena a medianoche UTC
// (`new Date(`${fecha}T00:00:00.000Z`)`). Por eso `startOfDayCR` devuelve la fecha
// CALENDARIO de CR "de hoy" tambien como medianoche UTC de ESE dia: asi la comparacion
// `fecha_reprogramacion <= startOfDayCR(now)` es una comparacion por dia consistente
// (ambos lados usan la misma convencion "fecha a medianoche UTC") sin off-by-one por el
// desfase de -6h.

const CR_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC-6

/**
 * Devuelve la medianoche UTC de la fecha CALENDARIO de Costa Rica correspondiente a
 * `now`. Ejemplos (UTC-6): `2026-07-15T05:59:00Z` (23:59 CR del 14) -> `2026-07-14`;
 * `2026-07-15T06:00:00Z` (00:00 CR del 15) -> `2026-07-15`.
 */
export function startOfDayCR(now: Date = new Date()): Date {
  // Corre el reloj -6h para que los campos UTC representen la hora de pared de CR.
  const crWall = new Date(now.getTime() - CR_OFFSET_MS);
  return new Date(
    Date.UTC(crWall.getUTCFullYear(), crWall.getUTCMonth(), crWall.getUTCDate(), 0, 0, 0, 0),
  );
}
