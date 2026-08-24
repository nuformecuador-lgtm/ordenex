// Feature 271 (bloque K, R57-R61) — EL DERIVADOR UNICO DE LA JORNADA DE UN CIERRE.
//
// POR QUE EXISTE, con el numero delante. La fecha de NACIMIENTO de un cierre `vencido` NO es la
// jornada que ese cierre cierra: va un dia POR DELANTE. Medido contra produccion sobre el cierre
// `79cb2c0f`: `created_at` en hora de Costa Rica = 2026-08-22; la jornada real —la fecha de sus 3
// gestiones vinculadas— = 2026-08-21. Y no es una anomalia de esa fila: el corte corre a las 00:0x
// de la madrugada SIGUIENTE a la jornada que cierra, asi que TODO `vencido` nace fechado un dia por
// delante del dia que el mensajero trabajo. Decirle «resuelve el cierre del 22» a quien trabajo el
// 21 es exactamente el aviso confuso que la ficha 271 viene a evitar.
//
// Y NO HAY COLUMNA DE JORNADA: el humano descarto el modelo de `fecha_jornada` fija (ver
// `specs/271-segundo-cierre-y-bloqueo/requirements.md`), asi que la fecha hay que DERIVARLA.
//
// UN SOLO DERIVADOR PARA LOS AVISOS Y PARA LA PANTALLA (R61). Ninguna superficie la calcula por su
// cuenta: dos derivaciones del mismo dato es como se desincronizan.
//
// Helper PURO: sin Prisma, sin `Date` de reloj, sin borde. Recibe fechas calendario de Costa Rica
// ya convertidas (`fechaCalendarioCR`, `lib/utils/fecha-cr.ts`) y devuelve una fecha calendario.

/** `YYYY-MM-DD`, la misma forma que emite `fechaCalendarioCR`. */
const FECHA_CALENDARIO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** CR es UTC-6 FIJO (sin horario de verano): restar 24 h ES restar un dia calendario. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;

export interface EntradaJornadaCierre {
  /**
   * Fechas de Costa Rica (`YYYY-MM-DD`) de las gestiones VINCULADAS al cierre y NO anuladas.
   * Vacio = cierre sin ninguna gestion. Puede traer repetidos: el derivador los colapsa.
   */
  diasCRDeGestiones: readonly string[];
  /** Fecha de Costa Rica (`YYYY-MM-DD`) de `cierre_dia.created_at`. */
  diaCRDeCreacion: string;
}

/**
 * R57/R58/R60 — la JORNADA que un cierre cierra, en fecha calendario de Costa Rica.
 * `null` = no hay jornada fiable; el texto que la consuma DEBE OMITIR la fecha, nunca inventarla.
 *
 * FUENTE A (primaria, R57) — LAS GESTIONES VINCULADAS. `gestion_orden.created_at` es el instante
 * en que el MENSAJERO registro la gestion, existe y esta indexado (`schema.prisma:884`, `:915`).
 *   · todas en el MISMO dia CR -> ese es la jornada. Es el caso normal, y lo es aun mas desde la
 *     271: `cierre_id IS NULL` reparte el trabajo por dia porque el corte corre cada noche.
 *   · en MAS DE UN dia CR -> `null` (R60). No hay *una* jornada, y elegir una de las dos seria
 *     decidir por el mensajero cual de sus dos dias le estamos nombrando.
 *
 * FUENTE B (fallback, R58) — CIERRE SIN NINGUNA GESTION: `created_at` en CR MENOS UN DIA.
 *
 * Y no es una heuristica: es LA MISMA FORMULA QUE USA EL CORTE. `diaQueElCorteCierra(now)`
 * (`CorteDiarioService`) es exactamente `startOfDayCR(now) − 1 dia`, y `created_at ≈ now` en esa
 * misma transaccion. Reproduce el ancla del corte para CUALQUIER hora de disparo, incluido el caso
 * del cron ADELANTADO que ese mismo archivo documenta: si dispara a las 23:5x CR del dia D, el
 * corte cierra `D−1` y `created_at` CR es `D`, asi que `D − 1 dia = D−1`. Coincide.
 *
 * POR QUE EL FALLBACK ESTA BIEN ACOTADO — invariante derivado: un cierre SIN ninguna gestion
 * vinculada SOLO puede haberlo creado el corte.
 *   1. La via de creacion exige gestiones: `findGestionesPendientes` vacio -> `MSG_VACIO`
 *      (`CierreDiaService`), y aun pasando, la guarda «algo paso» hace rollback
 *      (`CierreDiaRepository.crearCierre`).
 *   2. El corte SI puede crear uno money-neutral: 0 gestiones + >=1 orden barrida a
 *      `sin_gestionar` (feature 109/R8). Es exactamente el caso del fallback.
 *   3. Una gestion ya vinculada NO puede desaparecer: la ventana de deshacer muere en cuanto
 *      `gestion.cierreId !== null` (guarda 4 de `deshacerGestion`).
 * Asi que la rama B no necesita preguntar «¿lo creo el corte?»: CERO GESTIONES YA LO RESPONDE.
 *
 * ⚠️ LO QUE NO SE USA COMO FUENTE, Y ES LA TRAMPA DE ESTA FICHA (R59): `orden.fecha_reparto`. Es el
 * modelo que el humano descarto, y falla por partida doble: una orden reprogramada se libera con
 * `fecha_reparto = null` (`LiberacionReprogramadaRepository`) y se reasigna a otro dia; y el propio
 * barrido del corte ADMITE `fecha_reparto IS NULL` en su predicado (`CierreDiaRepository`), asi que
 * las ordenes de un cierre money-neutral pueden no tener ninguna fecha que leer. Una fuente que a
 * veces es `null` y a veces cambia sola no puede fechar un aviso.
 *
 * ⚠️ TAMPOCO SIRVE `cierre_sin_gestion` (feature 264), que era el candidato obvio para el caso sin
 * gestiones: su `created_at` es el instante del BARRIDO —el mismo `now` ya desfasado— y sus
 * columnas congeladas son guia, remision, destinatario, producto, tienda, zona y estatus de origen.
 * NINGUNA fecha de la jornada. Comprobado antes de elegir el fallback.
 */
export function derivarJornada(entrada: EntradaJornadaCierre): string | null {
  const dias = new Set<string>();
  for (const dia of entrada.diasCRDeGestiones) {
    if (esFechaCalendario(dia)) dias.add(dia);
  }

  // FUENTE A: hay gestiones vinculadas.
  if (dias.size === 1) return [...dias][0] as string;
  // Mas de un dia CR -> no hay UNA jornada. R60: se omite la fecha, no se elige una.
  if (dias.size > 1) return null;

  // Si venian gestiones pero NINGUNA con fecha legible, tampoco se cae al fallback del corte: ese
  // fallback vale para el cierre que NO TIENE gestiones, no para el que las tiene y no se leen.
  if (entrada.diasCRDeGestiones.length > 0) return null;

  // FUENTE B: cierre sin gestiones -> el dia CR de su creacion MENOS UN DIA.
  return diaAnterior(entrada.diaCRDeCreacion);
}

/**
 * R61 — la JORNADA que una corrida del corte cierra, como fecha calendario de Costa Rica, a partir
 * del ancla que esa corrida ya calculo (`diaQueElCorteCierra(now)`, `CorteDiarioService`).
 *
 * POR QUE EXISTE, en vez de que el corte haga la conversion por su cuenta: R61 exige UN derivador.
 * El corte es el unico sitio del arbol que SABE su jornada sin derivarla —es el parametro con el que
 * selecciona y escribe—, pero convertir ese `Date` a `YYYY-MM-DD` tiene la trampa de este repo
 * delante: `diaCerrado` viene en la convencion `@db.Date` (MEDIANOCHE UTC de la fecha CR), asi que
 * `fechaCalendarioCR(diaCerrado)` le restaria OTRAS seis horas y devolveria el DIA ANTERIOR. Es el
 * off-by-one que cerro la ficha 166, y por eso la conversion vive aqui y no alli.
 *
 * DEBE COINCIDIR CON LA RAMA B de `derivarJornada` para el mismo instante —las dos son
 * `startOfDayCR(now) − 1 dia`—, y eso NO se supone: se afirma en test, incluido el caso del cron
 * ADELANTADO (23:5x CR).
 */
export function jornadaDelCorte(diaCerrado: Date): string {
  return diaCerrado.toISOString().slice(0, 10);
}

/** `true` si `value` tiene la forma `YYYY-MM-DD` y es un dia que existe de verdad. */
function esFechaCalendario(value: string): boolean {
  if (!FECHA_CALENDARIO.test(value)) return false;
  const dia = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(dia.getTime())) return false;
  // Round-trip: `2026-02-31` pasa el regex y V8 lo RUEDA al 3 de marzo en silencio (ver
  // `esFechaCalendarioValida` en `lib/utils/fecha-cr.ts`, misma leccion).
  return dia.toISOString().slice(0, 10) === value;
}

/**
 * El dia calendario ANTERIOR a `fecha` (`YYYY-MM-DD`), o `null` si `fecha` no es una fecha
 * calendario valida. Aritmetica sobre medianoche UTC: la convencion `@db.Date` de este repo, sin
 * horas y por tanto sin ningun desfase de zona que aplicar dos veces.
 */
function diaAnterior(fecha: string): string | null {
  if (!esFechaCalendario(fecha)) return null;
  const anterior = new Date(new Date(`${fecha}T00:00:00.000Z`).getTime() - UN_DIA_MS);
  return anterior.toISOString().slice(0, 10);
}
