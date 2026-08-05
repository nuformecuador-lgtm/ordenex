// Feature 135 (T4.1) — resolucion de los rangos temporales de la analitica.
//
// `resolverRango(entrada, now?)` traduce un preset (o un par de fechas calendario)
// a la ventana SEMIABIERTA `[desde, hasta)` de instantes UTC mas las fechas
// calendario de Costa Rica correspondientes (R13). Es el unico sitio del lote
// 122-134 donde se decide que significa "hoy", "esta semana" o "este mes".
//
// R1 (modulo puro): sin `'use server'`, sin `next/headers`, sin `@/lib/db`, sin
// repositorios ni servicios, sin `@prisma/client`, sin efectos al importarse.
// R14 (reutiliza, no reimplementa): TODA la aritmetica de fecha sale de
// `@/lib/utils/fecha-cr`; aqui no hay ninguna constante de desfase propia — ni
// siquiera la duracion de un dia, que se DERIVA de los propios helpers (ver
// `UN_DIA_MS` abajo).
//
// ---------------------------------------------------------------------------
// (a) DOS CONVENCIONES CONVIVEN A PROPOSITO — NO SE HOMOGENEIZAN
// ---------------------------------------------------------------------------
// `semana` tiene borde de CALENDARIO: empieza el LUNES de la semana CR que
// contiene a `now` (decision D2 del humano, 2026-07-30). `mes` NO tiene borde de
// calendario: es una ventana MOVIL de exactamente 30 dias que termina en el dia
// CR de `now` (decision D3, «ultimos 30»), NO el mes calendario de
// `periodoMensualCR`. Consecuencia visible y aceptada: `semana` dura entre 1 y 7
// dias segun el dia en que se consulte, mientras `mes` dura SIEMPRE 30.
// Esto NO es una inconsistencia que arreglar: esta escrito en
// `specs/135-analitica-catalogo-kpis-rangos/design.md §4.3` y en `requirements.md > D3`
// precisamente para que "homogeneizar" ambos presets exija una decision humana
// nueva y fechada, no un refactor de pasada.
//
// ---------------------------------------------------------------------------
// (b) EL PERIODO ES EL "EN CURSO" — Y ESO ES UN SUPUESTO DEL SPEC_AUTHOR
// ---------------------------------------------------------------------------
// Los tres presets devuelven el periodo EN CURSO hasta ahora
// (`hasta = inicioDelDiaSiguienteCREnUtc(fecha CR de now)`), no el ultimo periodo
// COMPLETO. La segunda mitad de la pregunta Q3 (*en curso o completo*) NO fue
// respondida por el humano: es un SUPUESTO del spec_author, declarado como tal en
// `requirements.md > D3 (⚠ SUPUESTO...)`. Si el humano lo contradice cambian R15,
// R27 y R28 y sus tests, y nada mas del contrato.
//
// ---------------------------------------------------------------------------
// (c) LA TRAMPA `startOfDayCR` — VIVA; LA DIVERGENCIA CON EL RANKING — CERRADA (166)
// ---------------------------------------------------------------------------
// El dia operativo de la analitica es el dia NATURAL de Costa Rica 00:00-24:00,
// resuelto con `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc` (convencion
// de la feature 144): todo borde cae en `...T06:00:00.000Z`.
//
// La trampa que este bloque existe para nombrar SIGUE VIVA: el repo exporta
// tambien `startOfDayCR`, que devuelve la MEDIANOCHE UTC de la fecha calendario
// CR. Esa es la convencion CORRECTA para columnas `@db.Date` (feature 46, p.ej.
// `fecha_reprogramacion`) y por eso la funcion se conserva; pero como cota contra
// columnas `timestamp` esta 6 h por debajo del inicio real del dia en CR, asi que
// `[startOfDayCR(now), +24 h)` es en realidad la ventana 18:00-18:00 hora CR. NO
// la importes aqui ni "corrijas" la analitica con ella: propagaria el error a un
// rollup persistido.
//
// La divergencia que este bloque declaraba ACEPTADA (D6 / R31) esta CERRADA: la
// feature **166** paso `RankingService` a esta misma convencion, asi que analitica
// y ranking resuelven "hoy" con cotas identicas al milisegundo. Ya no hay dos
// verdades sobre el dia; lo que queda es la eleccion de helper segun el TIPO de
// columna, que es lo que documenta el parrafo anterior.

import {
  fechaCalendarioCR,
  inicioDelDiaCREnUtc,
  inicioDelDiaSiguienteCREnUtc,
} from "@/lib/utils/fecha-cr";
import type { EntradaRango, RangoResuelto } from "@/lib/analytics/types";

/**
 * Duracion de un dia, DERIVADA de los propios helpers en vez de escrita a mano:
 * `inicioDelDiaSiguienteCREnUtc(f) - inicioDelDiaCREnUtc(f)` es, por definicion,
 * un dia. Se deriva a proposito para que este archivo no contenga NINGUNA
 * constante temporal propia (R14) y para que, si algun dia Costa Rica adoptase
 * horario de verano, solo haya que tocar `lib/utils/fecha-cr.ts`.
 */
const FECHA_ANCLA = "2000-01-01";
const UN_DIA_MS =
  inicioDelDiaSiguienteCREnUtc(FECHA_ANCLA).getTime() - inicioDelDiaCREnUtc(FECHA_ANCLA).getTime();

/** Dias de la ventana movil del preset `mes` (D3: «ultimos 30», contando hoy). */
const MES_MOVIL_DIAS = 30;

/**
 * Fecha calendario CR `dias` dias ANTES de `fecha`, sin aritmetica de calendario
 * propia: se ancla la fecha a su instante real de las 00:00 CR, se retrocede y se
 * vuelve a leer la fecha calendario CR. Cruza fin de mes y fin de anio solo.
 */
function restarDiasCalendarioCR(fecha: string, dias: number): string {
  return fechaCalendarioCR(new Date(inicioDelDiaCREnUtc(fecha).getTime() - dias * UN_DIA_MS));
}

/**
 * Fecha calendario CR del LUNES de la semana que contiene a `fecha` (D2).
 * El dia de la semana se lee sobre el instante `...T06:00:00.000Z`, que cae en la
 * MISMA fecha en UTC, asi que `getUTCDay()` da el dia de la semana de la fecha CR
 * sin depender del huso del proceso (R18). `getUTCDay()`: 0 = domingo ... 6 = sabado,
 * luego `(dow + 6) % 7` son los dias a retroceder hasta el lunes (0 si ya es lunes).
 */
function lunesDeLaSemanaCR(fecha: string): string {
  const diaDeLaSemana = inicioDelDiaCREnUtc(fecha).getUTCDay();
  return restarDiasCalendarioCR(fecha, (diaDeLaSemana + 6) % 7);
}

/**
 * Resuelve una entrada de rango a la ventana semiabierta `[desde, hasta)` en
 * instantes UTC + las fechas calendario CR inclusivas (R13).
 *
 * - `dia`: el dia CR de `now`.
 * - `semana`: desde el LUNES de la semana CR de `now` hasta el dia CR de `now` (D2).
 * - `mes`: ventana MOVIL de 30 dias que termina en el dia CR de `now` (D3).
 * - `personalizado`: las dos fechas las fija el cliente (D4); su validacion
 *   (formato, orden y tope `RANGO_TOPE_DIAS`) es del esquema zod de `filters.ts`,
 *   no de aqui.
 *
 * `now` es inyectable con default `new Date()` (R17): ningun `Date.now()` escondido,
 * ningun test necesita falsear el reloj global.
 */
export function resolverRango(entrada: EntradaRango, now: Date = new Date()): RangoResuelto {
  const { desdeFecha, hastaFecha } = fechasCalendarioDelRango(entrada, now);

  return {
    preset: entrada.preset,
    // INCLUSIVO: 00:00 hora de pared de Costa Rica = `...T06:00:00.000Z`.
    desde: inicioDelDiaCREnUtc(desdeFecha),
    // EXCLUSIVO: 00:00 CR del dia SIGUIENTE, para que `hastaFecha` sea inclusiva.
    hasta: inicioDelDiaSiguienteCREnUtc(hastaFecha),
    desdeFecha,
    hastaFecha,
  };
}

function fechasCalendarioDelRango(
  entrada: EntradaRango,
  now: Date,
): { desdeFecha: string; hastaFecha: string } {
  if (entrada.preset === "personalizado") {
    return { desdeFecha: entrada.desde, hastaFecha: entrada.hasta };
  }

  const hoyCR = fechaCalendarioCR(now);

  switch (entrada.preset) {
    case "dia":
      return { desdeFecha: hoyCR, hastaFecha: hoyCR };
    case "semana":
      return { desdeFecha: lunesDeLaSemanaCR(hoyCR), hastaFecha: hoyCR };
    case "mes":
      return {
        desdeFecha: restarDiasCalendarioCR(hoyCR, MES_MOVIL_DIAS - 1),
        hastaFecha: hoyCR,
      };
  }
}
