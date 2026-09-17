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
 *
 * CONSUMIDORES (para que se vea de un vistazo que columnas dependen de esta convencion):
 *   - feature 46  — `gestion_orden.fecha_reprogramacion` (`@db.Date`), el caso original;
 *   - feature 246 — `orden.fecha_reparto` (`@db.Date`): el DIA DE REPARTO de una asignacion.
 *     De aqui salen las tres cosas de esa ficha: la fecha que escribe la asignacion
 *     (`lib/utils/dia-reparto.ts`), el ancla del corte nocturno (`CorteDiarioService`
 *     .diaQueElCorteCierra`, que es esto MENOS UN DIA) y el `esParaManana` del portal del
 *     mensajero.
 *
 * ⚠️ NO la uses como cota contra columnas `timestamp` (`asignado_at`, `gestion_orden.created_at`):
 * para eso esta `inicioDelDiaCREnUtc`, seis horas mas tarde. Confundirlas es el off-by-one que
 * cerro la ficha 166, y hay guardias que lo vigilan.
 */
export function startOfDayCR(now: Date = new Date()): Date {
  // Corre el reloj -6h para que los campos UTC representen la hora de pared de CR.
  const crWall = new Date(now.getTime() - CR_OFFSET_MS);
  return new Date(
    Date.UTC(crWall.getUTCFullYear(), crWall.getUTCMonth(), crWall.getUTCDate(), 0, 0, 0, 0),
  );
}

/**
 * Fecha CALENDARIO de Costa Rica como `YYYY-MM-DD` (el formato de `<input type="date">`
 * y de `fecha_reprogramacion`). NO uses `new Date().toISOString().slice(0, 10)` para
 * esto: `toISOString` emite la fecha en UTC, asi que despues de las 18:00 de CR ya
 * devuelve el dia SIGUIENTE (off-by-one). Ejemplos (UTC-6): `2026-07-16T02:00:00Z`
 * (20:00 CR del 15) -> `"2026-07-15"`; `2026-07-15T05:59:00Z` (23:59 CR del 14) ->
 * `"2026-07-14"`.
 */
export function fechaCalendarioCR(now: Date = new Date()): string {
  const crWall = new Date(now.getTime() - CR_OFFSET_MS);
  const anio = crWall.getUTCFullYear();
  const mes = String(crWall.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(crWall.getUTCDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

/**
 * `true` si `value` es una fecha CALENDARIO `YYYY-MM-DD` que EXISTE de verdad.
 *
 * Hace falta el ROUND-TRIP —parsear y comprobar que el instante vuelve a emitir EXACTAMENTE la
 * misma cadena— porque ninguna de las dos comprobaciones "obvias" caza un dia inexistente:
 *
 * - El regex `^\d{4}-\d{2}-\d{2}$` mide la FORMA, y `2026-02-31` la cumple.
 * - `Number.isNaN(new Date(...).getTime())` NO basta: al contrario de lo que se suele suponer,
 *   V8 devuelve `Invalid Date` solo cuando el MES esta fuera de rango (`2026-13-01`). Un DIA
 *   desbordado RUEDA en silencio al mes siguiente: `new Date("2026-02-31T00:00:00.000Z")` es el
 *   **3 de marzo**. Y una fecha rodada es peor que una rechazada: el usuario pide un dia y el
 *   sistema le guarda otro sin avisar.
 *
 * Es la unica pieza de esta comprobacion en el arbol: la usan `esFechaFutura` (reprogramacion,
 * features 36/73/100) y `esFechaPagoValida` (liquidacion, feature 172). `backfill-rango.ts`
 * hace el mismo viaje por su cuenta pero contra el calendario de CR (06:00Z), que es otra
 * convencion y por eso no se colapsa con esta.
 */
export function esFechaCalendarioValida(value: string): boolean {
  const dia = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(dia.getTime())) return false;
  return dia.toISOString().slice(0, 10) === value;
}

/** Milisegundos de un dia; CR no tiene horario de verano, asi que sumar 24h == +1 dia. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Fecha CALENDARIO de Costa Rica de MAÑANA como `YYYY-MM-DD`. Default del campo
 * "Nueva fecha" al reprogramar (feature 36): la reprogramacion mas temprana posible.
 */
export function mananaCalendarioCR(now: Date = new Date()): string {
  return fechaCalendarioCR(new Date(now.getTime() + UN_DIA_MS));
}

/**
 * Feature 144 — el atajo "ultimos N dias" como RANGO de fechas calendario de Costa Rica
 * (`YYYY-MM-DD`), para pintarlo en el calendario del filtro. Cuenta `N` dias calendario
 * INCLUIDO hoy (por eso retrocede `N - 1`), la misma regla que
 * `inicioDeUltimosNDiasCREnUtc` aplica server-side para `created_preset`.
 */
export function ultimosNDiasCalendarioCR(
  dias: number,
  now: Date = new Date(),
): { desde: string; hasta: string } {
  return {
    desde: fechaCalendarioCR(new Date(now.getTime() - (dias - 1) * UN_DIA_MS)),
    hasta: fechaCalendarioCR(now),
  };
}

/**
 * Feature 144 (R41/R42/R43) — INSTANTE UTC del comienzo (00:00 hora de pared de Costa
 * Rica) de la fecha calendario `YYYY-MM-DD`. Es `${fecha}T06:00:00.000Z`.
 *
 * OJO, es la trampa del repo: `startOfDayCR` NO sirve para esto. Aquella devuelve la
 * MEDIANOCHE UTC de la fecha calendario CR (convencion `@db.Date` de la feature 46), que
 * es un instante 6 h ANTERIOR al comienzo real del dia en CR. Comparar `created_at` (un
 * `timestamp` en UTC) contra `startOfDayCR` metería en el rango las 6 primeras horas UTC
 * del dia, que en CR son todavia el dia anterior. Por eso aqui se suman las 6 h.
 *
 * `fecha` debe venir ya validada como `YYYY-MM-DD` (ver `ordenFilterSchema`).
 */
export function inicioDelDiaCREnUtc(fecha: string): Date {
  return new Date(`${fecha}T06:00:00.000Z`);
}

/**
 * Feature 144 (R42) — INSTANTE UTC del comienzo del dia SIGUIENTE a `fecha` en hora de
 * Costa Rica. Es la cota superior EXCLUSIVA que hace que `hasta` sea INCLUSIVO: con
 * `hasta = 2026-07-15` el rango debe cubrir todo el 15 en CR, es decir hasta
 * `2026-07-16T05:59:59.999Z`. El error clasico —usar `<= inicioDelDiaCREnUtc(hasta)`—
 * perderia el dia entero salvo su primer instante.
 */
export function inicioDelDiaSiguienteCREnUtc(fecha: string): Date {
  return new Date(inicioDelDiaCREnUtc(fecha).getTime() + UN_DIA_MS);
}

/**
 * Feature 144 (R41) — INSTANTE UTC desde el que empieza el atajo "ultimos N dias",
 * contado sobre la fecha calendario de Costa Rica de `now`: el comienzo del dia CR de
 * hace `N - 1` dias, de modo que "ultimos 7 dias" cubra 7 dias CALENDARIO incluido hoy.
 */
export function inicioDeUltimosNDiasCREnUtc(dias: number, now: Date = new Date()): Date {
  const fecha = fechaCalendarioCR(new Date(now.getTime() - (dias - 1) * UN_DIA_MS));
  return inicioDelDiaCREnUtc(fecha);
}

/**
 * ⭑ FICHA 431 — INSTANTE UTC en el que empezo el mes EN CURSO del calendario de Costa Rica.
 *
 * Es la cota inferior de «Recibido este mes» en `/wallet/satelites`. Se compone de las dos piezas
 * que ya existen —`periodoMensualCR` para saber QUE mes es en CR, e `inicioDelDiaCREnUtc` para
 * convertir su dia 1 al instante UTC correcto— en vez de reescribir el offset: la trampa de las
 * 6 h esta documentada en `inicioDelDiaCREnUtc` y ya se pago una vez.
 *
 * Ejemplos: `2026-09-01T06:00:00Z` (00:00 CR del 1 sep) -> `2026-09-01T06:00:00Z`;
 * `2026-09-01T05:59:00Z` (23:59 CR del 31 ago) -> `2026-08-01T06:00:00Z`.
 */
export function inicioDelMesCREnUtc(now: Date = new Date()): Date {
  return inicioDelDiaCREnUtc(`${periodoMensualCR(now)}-01`);
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

/**
 * ⭑ FICHA 431 (R21) — DIAS NATURALES transcurridos entre dos instantes, contados en el CALENDARIO
 * de Costa Rica. Es la antiguedad de la consolidacion mas vieja sin conciliar.
 *
 * SE CUENTAN DIAS DE CALENDARIO, NO PERIODOS DE 24 HORAS, y la diferencia importa: una
 * consolidacion creada ayer a las 23:50 y mirada hoy a las 00:10 lleva **1 dia** (cambio de fecha),
 * no 0. Es lo que una persona responde cuando le preguntan «¿de cuando es?», y es lo que la
 * pantalla va a ensenar.
 *
 * Se apoya en `startOfDayCR`, que ya normaliza a la medianoche de pared de CR, asi que el resultado
 * no depende de la hora ni del huso de quien lo pregunte. La resta entre dos medianoches UTC es
 * exacta en milisegundos: Costa Rica no tiene horario de verano.
 *
 * Nunca negativo: un instante futuro devuelve `0` en vez de un numero que la pantalla no sabria
 * leer. Y se deriva EN EL SERVIDOR: la pantalla no resta fechas (R20).
 */
export function diasNaturalesCRDesde(desde: Date, now: Date = new Date()): number {
  const dias = Math.round(
    (startOfDayCR(now).getTime() - startOfDayCR(desde).getTime()) / UN_DIA_MS,
  );
  return dias > 0 ? dias : 0;
}
