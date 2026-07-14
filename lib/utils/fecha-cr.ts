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

/**
 * Feature 45 (R30) — periodo mensual `YYYY-MM` de la fecha CALENDARIO de Costa Rica (UTC-6)
 * correspondiente a `now`. Consistente con `startOfDayCR` (mismo offset). Se usa como parte
 * de la clave de idempotencia del cron de gastos fijos (`<plantillaId>:<YYYY-MM>`). Ejemplos:
 * `2026-07-01T06:00:00Z` (00:00 CR del 1 jul) -> `"2026-07"`; `2026-07-01T05:59:00Z` (23:59 CR
 * del 30 jun) -> `"2026-06"`.
 */
export function periodoMensualCR(now: Date = new Date()): string {
  const crWall = new Date(now.getTime() - CR_OFFSET_MS);
  const anio = crWall.getUTCFullYear();
  const mes = String(crWall.getUTCMonth() + 1).padStart(2, "0");
  return `${anio}-${mes}`;
}
