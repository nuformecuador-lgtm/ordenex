import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

// Feature 102 (T1, design §2) — CLASIFICACION `esRechazoSla`, DERIVADA del historial INMUTABLE
// de la feature 99. Sin columna/tabla/migracion (objetivo del gate F1.4): la etiqueta ya vive en
// `orden_historial_estado.origen_tipo`.

// `origen_tipo` que la feature 99 (`DevolucionSlaRepository.escalarDevueltaSla`) escribe en la
// transicion `devuelta -> rechazada` hecha por el cron SLA, enlazando la gestion sintetica. Un
// rechazo MANUAL del mensajero escribe `origen_tipo = "gestion"`. Fuente unica del predicado
// (reusado por CierresAdminRepository y OrdenRepository) para no duplicar el string magico.
export const ORIGEN_TIPO_RECHAZO_SLA = "escalado_devuelta_sla" satisfies OrdenHistorialOrigenTipo;

// Fila MINIMA de historial que consume el predicado: solo su `origen_tipo`.
export interface HistorialOrigenRow {
  origenTipo: OrdenHistorialOrigenTipo;
}

/**
 * R1/R2 — una gestion `rechazada` es un RECHAZO SLA (`esRechazoSla = true`) SI Y SOLO SI existe
 * al menos una fila de historial enlazada con `origen_tipo = escalado_devuelta_sla`. Un rechazo
 * manual del mensajero (`origen_tipo = "gestion"`) es NO-SLA (`false`) AUNQUE tenga un
 * `ingreso_bodega_rechazo` snapshoteado: el monto no distingue el origen, solo el historial (R2).
 * Funcion PURA: recibe las filas ya leidas (el repo acota el `where` por rendimiento); no toca DB.
 */
export function esRechazoSla(historialEstados: readonly HistorialOrigenRow[]): boolean {
  return historialEstados.some((h) => h.origenTipo === ORIGEN_TIPO_RECHAZO_SLA);
}
