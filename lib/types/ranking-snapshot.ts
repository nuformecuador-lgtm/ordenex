// Feature 196 (design §4.3) — DTOs del ranking CONGELADO. Money-safe y paridad con la
// feature 76 (R31): el monto del premio y el porcentaje del dia cruzan servidor->cliente como
// STRING ya formateado. El cliente NO recibe `Prisma.Decimal`, no divide y no redondea.
//
// El porcentaje NO se persiste (R10): se deriva de `entregadas`/`asignadas` con
// `formatearPct`, el mismo redondeo del ranking en vivo. Lo unico fragil ante un cambio de
// comparador —el ORDEN— ya esta congelado en `puesto`.

/** Una fila del ranking congelado, tal como se muestra y se descarga. */
export interface RankingSnapshotFilaDTO {
  /** Puesto en la lista completa congelada (1..N). Se muestra en este orden, sin reordenar. */
  puesto: number;
  /** 1|2|3 si ocupo podio; `null` si se listo sin podio (R6/R9). */
  posicion: number | null;
  /** NO viaja al archivo de descarga (R34): la fila se identifica por su nombre. */
  mensajeroId: string;
  /** Nombre CONGELADO (R16): un renombrado posterior no reescribe la historia. */
  nombre: string;
  entregadas: number;
  asignadas: number;
  /** `"96.0"` | `null` si `asignadas === 0` (indefinido, que no es cero). STRING (R10/R31). */
  pct: string | null;
  /** Monto congelado del premio, STRING escala 2; `null` fuera de podio o sin premio (R7/R8). */
  premioMonto: string | null;
  premioDescripcion: string | null;
}

/** El snapshot completo de una fecha, listo para pintar. */
export interface RankingSnapshotData {
  /** `"YYYY-MM-DD"`, la fecha calendario CR consultada. */
  fecha: string;
  /** ISO del instante en que el cron congelo la fecha (R24: «generado el...»). */
  generadoAt: string;
  /** Umbral de podio APLICADO en esa corrida, no el vigente hoy (R1). */
  minAsignadasPodio: number;
  /** En el ORDEN CONGELADO (`puesto` asc). Vacio = ese dia no hubo actividad (R11/R26). */
  filas: RankingSnapshotFilaDTO[];
}
