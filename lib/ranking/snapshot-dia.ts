import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";

// Feature 196 (design §3) — la fecha que congela el cron y sus cotas. Modulo PURO: sin
// Prisma, sin `next/*` y sin reloj propio; el instante SIEMPRE se inyecta.
//
// Es el UNICO sitio del que sale la fecha objetivo del snapshot: toda la aritmetica de dia
// se apoya en `lib/utils/fecha-cr.ts` y aqui no se reimplementa ni una hora de desplazamiento.
//
// NO importa nada de `lib/analytics/`: aquel modulo resuelve el mismo problema para el
// rollup, pero acoplar ranking a analitica para ahorrar cuatro lineas es peor negocio que
// apoyarse los dos en el mismo helper de fechas, que es lo que ya ocurre.
//
// ⛔ `startOfDayCR` NO se importa aqui y no debe importarse. Devuelve la MEDIANOCHE UTC de
// la fecha calendario CR (convencion `@db.Date` de la feature 46), seis horas ANTES del
// comienzo real del dia en Costa Rica. Usarla como cota contra columnas `timestamp`
// (`gestion_orden.created_at`, `orden.asignado_at`) produce la ventana 18:00-18:00 hora CR
// que cerro la ficha 166. Es la trampa documentada del repo.
//
// ⛔ Derivar el dia serializando el instante a ISO en UTC tampoco vale: emite la fecha en
// UTC, asi que despues de las 18:00 CR ya devuelve el dia siguiente. Por eso el unico camino
// a la fecha calendario es `fechaCalendarioCR`.

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** Ventana del dia CR, semiabierta `[desde, hasta)`. `hasta` es cota superior ESTRICTA. */
export interface VentanaDiaCR {
  readonly desde: Date;
  readonly hasta: Date;
}

/**
 * R2 — la corrida congela LA FECHA QUE ACABA DE CERRAR, es decir D−1 respecto del instante
 * de la corrida, y ninguna otra. El dia en curso no tiene snapshot: lo sirve el ranking en
 * vivo. Con el cron a las 02:00 CR del dia D+1 (`08:00Z`) esto devuelve `D`.
 *
 * `now` es OBLIGATORIO, sin default: un reloj por defecto deja que un test crea que controla
 * el tiempo cuando no lo hace.
 */
export function fechaObjetivo(now: Date): string {
  return fechaCalendarioCR(new Date(now.getTime() - UN_DIA_MS));
}

/**
 * Ventana del dia congelado, semiabierta `[desde, hasta)`:
 *   desde = `${fecha}T06:00:00.000Z`  (00:00:00 hora de pared CR)
 *   hasta = desde + 24 h              (00:00:00 CR del dia siguiente)
 *
 * Es EXACTAMENTE la ventana que usa el ranking en vivo para «hoy» (feature 166), que es lo
 * que hace comparables las dos cifras. Cambiar `<` por `<=` en el consumidor mueve un dia
 * entero de gestiones.
 */
export function ventanaDelDia(fecha: string): VentanaDiaCR {
  return {
    desde: inicioDelDiaCREnUtc(fecha),
    hasta: inicioDelDiaSiguienteCREnUtc(fecha),
  };
}

/**
 * `ranking_snapshot_dia.fecha` es `@db.Date`, y la convencion del repo (feature 46) para esa
 * columna es la MEDIANOCHE UTC de la fecha calendario. NO es `ventana.desde`, que lleva las
 * 06:00 dentro: confundir las dos convenciones es el off-by-one clasico de estas columnas.
 */
export function fechaComoDate(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000Z`);
}
