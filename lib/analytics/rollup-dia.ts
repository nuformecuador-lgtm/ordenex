import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";

// Feature 124 (design §3) — el dia CR del rollup y sus cotas. Modulo PURO: sin Prisma, sin
// Next.js, sin `new Date()` ni `Date.now()` propios (R8: el reloj SIEMPRE se inyecta).
//
// Es el UNICO sitio del que sale la fecha objetivo y la unica aritmetica de dia del job
// (R6): todo se apoya en `lib/utils/fecha-cr.ts` y no se reimplementa ni una hora de
// desplazamiento.
//
// ⛔ `startOfDayCR` NO se importa aqui y no debe importarse en ningun modulo del escritor.
// Devuelve la MEDIANOCHE UTC de la fecha calendario CR (convencion `@db.Date` de la feature
// 46), seis horas ANTES del comienzo real del dia en Costa Rica. Usarla contra columnas
// `timestamp` produce la ventana 18:00-18:00 que hoy arrastra `RankingService` (ficha 166).
// Es la trampa documentada del repo y esta feature no la repite.

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Ventana del dia CR, semiabierta `[desde, hasta)`. `hasta` es ademas el CORTE (cota
 * superior ESTRICTA, R24).
 *
 * POR QUE VIVE AQUI y no en `lib/interfaces/repositories/IAnaliticaRollupRepository.ts`,
 * que es donde nacio: `lib/analytics/` es un modulo PURO y su guardia
 * (`tests/unit/analytics/modulo-puro.guardia.test.ts`, feature 135 / R1) prohibe que
 * cualquier archivo de este directorio nombre la capa `repositories` en un import. El
 * guardia juzga el ESPECIFICADOR del modulo, no si el import desaparece al compilar: un
 * `import type` de `@/lib/interfaces/repositories/...` cae igual, y esta bien que caiga —
 * ensenarle a ignorar los `import type` abriria una rendija permanente por la que despues
 * entra acoplamiento real.
 *
 * La direccion correcta de la dependencia es la contraria y es la que queda: el tipo es
 * DOMINIO PURO (dos instantes), lo construye `ventanaDelDia` aqui mismo, y la interfaz del
 * repositorio lo IMPORTA de `lib/analytics/`. `interfaces` puede depender de tipos de
 * dominio; `lib/analytics/` no puede depender de infraestructura.
 *
 * Se queda en `rollup-dia.ts` y no en `lib/analytics/types.ts` porque ese archivo es uno de
 * los cuatro modulos del CONTRATO de la 135 (el catalogo de metricas y sus rangos), ajeno al
 * escritor de la 124. `rollup-dia.ts` es quien CONSTRUYE la ventana y ya figura en las listas
 * de modulos vigilados del escritor (`rollup-guards`, `analytics-daily-guards`): el tipo y su
 * unico constructor quedan en el mismo archivo y bajo la misma vigilancia.
 */
export interface VentanaDia {
  readonly desde: Date;
  readonly hasta: Date;
}

/**
 * D3 — la corrida programada agrega LA FECHA QUE ACABA DE CERRAR, es decir D−1 respecto del
 * instante de la corrida. El tablero del dia en curso no tiene rollup: lo sirve la 126 en
 * vivo. Con el reloj congelado a las 00:30 CR del dia D+1 (06:30 UTC) esto devuelve `D`.
 *
 * `now` es OBLIGATORIO (R8): no hay default `new Date()` que permita que un test crea que
 * controla el reloj cuando no lo hace.
 */
export function fechaObjetivo(now: Date): string {
  return fechaCalendarioCR(new Date(now.getTime() - UN_DIA_MS));
}

/**
 * R5 — la ventana del dia, semiabierta `[desde, hasta)`:
 *   desde = `${fecha}T06:00:00.000Z`  (00:00:00 hora de pared CR)
 *   hasta = desde + 24 h              (00:00:00 CR del dia siguiente) == el CORTE
 *
 * `hasta` es cota superior ESTRICTA en las dos lecturas que la usan (ventana y corte). Eso
 * no es cosmetico: las transiciones `corte_sin_gestionar` que el corte diario escribe a las
 * 00:00:00 CR del dia D+1 caen EXACTAMENTE en `hasta` y por tanto NO entran en el estado de
 * cierre de D (R24). Cambiar `<` por `<=` mueve el embudo de un dia entero.
 */
export function ventanaDelDia(fecha: string): VentanaDia {
  return {
    desde: inicioDelDiaCREnUtc(fecha),
    hasta: inicioDelDiaSiguienteCREnUtc(fecha),
  };
}

/**
 * `analytics_daily.fecha` es `@db.Date`, y la convencion del repo (feature 46) para esa
 * columna es la MEDIANOCHE UTC de la fecha calendario. NO es `ventana.desde`, que lleva las
 * 06:00 dentro: confundir las dos convenciones es el off-by-one clasico de esta tabla.
 */
export function fechaComoDate(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000Z`);
}

/** Forma de una fecha calendario: `YYYY-MM-DD`. Nada de `Date.parse` permisivo. */
const FECHA_CALENDARIO = /^\d{4}-\d{2}-\d{2}$/;

/** Resultado de la guarda de antiguedad de la invocacion manual (R39). */
export type FechaManualAdmitida =
  | { readonly ok: true; readonly fecha: string }
  | { readonly ok: false; readonly motivo: string };

/**
 * R39 — la INVOCACION MANUAL admite SOLO el dia en curso y el que acaba de cerrar. Cualquier
 * fecha mas antigua se rechaza remitiendo al backfill de la feature 125.
 *
 * Es la contrapartida operativa de R35 estricto (D3/D8): sin esta guarda, la 124 se convierte
 * en la 125 por la puerta de atras —recomputo de fechas pasadas, invisible y no auditado—,
 * que es exactamente lo que R35 prohibe. Funcion PURA y reutilizable: la consume el script de
 * invocacion manual, y el reloj se inyecta (R8).
 *
 * Una fecha FUTURA tambien se rechaza: no es «hoy o ayer», y un dia que no ha cerrado no
 * tiene rollup (D3 — el dia en curso lo sirve la 126 en vivo).
 */
export function validarFechaInvocacionManual(fecha: string, now: Date): FechaManualAdmitida {
  if (!FECHA_CALENDARIO.test(fecha)) {
    return { ok: false, motivo: `fecha invalida: se espera YYYY-MM-DD y llego "${fecha}"` };
  }
  const hoy = fechaCalendarioCR(now);
  const ayer = fechaObjetivo(now);
  if (fecha === hoy || fecha === ayer) return { ok: true, fecha };
  if (fecha > hoy) {
    return { ok: false, motivo: `la fecha ${fecha} es futura: el rollup solo agrega dias cerrados` };
  }
  return {
    ok: false,
    motivo:
      `la fecha ${fecha} es anterior a ${ayer}: el job diario NUNCA recomputa fechas pasadas ` +
      `(R35). Recomputar un rango explicito es el backfill de la feature 125.`,
  };
}
