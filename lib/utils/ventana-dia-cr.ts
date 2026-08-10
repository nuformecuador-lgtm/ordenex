// Feature 192 (B1.1, design.md §4) — la ventana del DIA EN CURSO de Costa Rica.
//
// Modulo PURO: sin Prisma, sin `next/headers`, sin `new Date()` propio. El unico
// `new Date()` de la feature vive en la Server Action, que es el borde.

import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";

/** R12 — intervalo SEMIABIERTO `[desde, hasta)` en UTC, mas la fecha calendario CR. */
export interface VentanaDiaCR {
  /** `YYYY-MM-DD` calendario de Costa Rica. */
  readonly fecha: string;
  /** `${fecha}T06:00:00.000Z` — 00:00 hora de pared de CR. */
  readonly desde: Date;
  /** `${fecha+1}T06:00:00.000Z` — cota superior EXCLUSIVA. */
  readonly hasta: Date;
}

/**
 * La ventana del dia CR al que pertenece `now`.
 *
 * `now` es parametro OBLIGATORIO, sin default `new Date()` (R16): un default deja que un
 * test crea que controla el reloj cuando no lo hace (misma regla que `rollup-dia.ts`).
 *
 * Se apoya SOLO en `lib/utils/fecha-cr.ts`, sin reimplementar ni una hora de
 * desplazamiento. En particular:
 *
 * NO se usa `startOfDayCR` (R17). Devuelve la medianoche **UTC** de la fecha calendario CR
 * —seis horas antes del comienzo real del dia en Costa Rica— y contra columnas `timestamp`
 * produce la ventana 18:00-18:00 que hoy arrastra `RankingService` (ficha 166). Si la
 * ventana se equivoca, los contadores no cuadran con lo que ve el maestro y parece un bug
 * de la pantalla.
 */
export function ventanaDelDiaEnCursoCR(now: Date): VentanaDiaCR {
  const fecha = fechaCalendarioCR(now);
  return {
    fecha,
    desde: inicioDelDiaCREnUtc(fecha),
    hasta: inicioDelDiaSiguienteCREnUtc(fecha),
  };
}
