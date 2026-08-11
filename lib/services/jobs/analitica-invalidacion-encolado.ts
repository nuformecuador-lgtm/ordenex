// Feature 128 (T6.2, design §7.1) — IDENTIDAD DE ENCOLADO del job puntual
// `analitica_invalidacion_cache`.
//
// Modulo PURO: sin Prisma, sin Next y sin reloj propio. Vive separado del handler por el mismo
// motivo que su hermano `analitica-rollup-diario-encolado.ts`: la clave la necesitan el script
// del backfill y los tests, y ninguno debe importar la fabrica del servicio —con su cliente
// Prisma detras— solo para construir una cadena.

/** Prefijo del `dedupe_key`. Tambien es el valor del enum `job_tipo`. */
export const DEDUPE_PREFIX_INVALIDACION = "analitica_invalidacion_cache";

/* -------------------------------------------------------------------------- */
/* Feature 179 (T3.8, D2 — R27) — EL DOMINIO VIAJA EN EL PAYLOAD               */
/* -------------------------------------------------------------------------- */
//
// D2 (humano, 2026-08-10) = (a): el backfill de tesoreria REUSA este job en vez de estrenar un
// tipo propio. `revalidateTag` LANZA fuera de un request de Next (`revalidate.js:104-107`) y
// `scripts/backfill-caja-tesoreria.ts` es un proceso `tsx`, asi que el script ENCOLA y el
// drenador —que corre dentro del request del cron, cada minuto— invalida. **Sin migracion**: el
// valor `analitica_invalidacion_cache` del enum `job_tipo` ya existe desde la 128.
//
// ⚠ `dominio` ES OPCIONAL Y SU DEFAULT ES `operativa`, Y ESO NO ES CORTESIA: ES COMPATIBILIDAD
// MEDIDA. Los jobs que la 128 encola desde `scripts/backfill-analitica.ts` llevan payload
// `{ desde, hasta }` y NO llevan `dominio`. Sin el default, esos jobs dejarian de invalidar la
// cache operativa y **nada fallaria**: la cifra recomputada se quedaria invisible hasta el TTL.
// El testigo de esa compatibilidad es `tests/unit/analytics/cache-invalidacion-backfill.test.ts`
// (feature 128), que sigue **sin modificar**: si hubiera que editarlo, seria la senal de que los
// jobs ya encolados dejaron de invalidar.

/** Los dominios de analitica que se cachean e invalidan. Cerrado, nunca `string`. */
export type DominioInvalidacion = "operativa" | "financiera";

/** El default cuando el payload no lo declara. Ver el comentario de arriba: es un requisito. */
export const DOMINIO_INVALIDACION_POR_DEFECTO: DominioInvalidacion = "operativa";

/**
 * R27 — lee el dominio de un payload de job, con `operativa` como default EXPLICITO.
 *
 * El payload llega de la base como `Record<string, unknown>` (JSON), asi que no hay tipo que
 * confiar: se comprueba el valor contra el dominio cerrado. Un `dominio` desconocido —una fila
 * vieja, un job escrito a mano— cae al default en vez de lanzar: un job que no sabe que
 * invalidar es mejor que vacie la operativa (lo que la 128 ya hacia) a que se quede en
 * dead-letter sin invalidar nada.
 */
export function dominioDelPayload(payload: unknown): DominioInvalidacion {
  if (typeof payload !== "object" || payload === null) return DOMINIO_INVALIDACION_POR_DEFECTO;
  const valor = (payload as Record<string, unknown>).dominio;
  return valor === "financiera" || valor === "operativa"
    ? valor
    : DOMINIO_INVALIDACION_POR_DEFECTO;
}

/**
 * `analitica_invalidacion_cache:<desde>..<hasta>:<epoch>`.
 *
 * ⚠ EL `epoch` NO ES RUIDO: es lo que hace que la clave NO deduplique entre corridas.
 *
 * `IJobRepository.enqueue` inserta con `ON CONFLICT ("dedupe_key") DO NOTHING`. La clave del
 * rollup diario (`analitica_rollup_diario:<fecha>`) quiere deduplicar: dos siembras del mismo
 * dia son el MISMO trabajo. Aqui es al reves. Dos backfills del mismo rango en el mismo dia
 * son dos recomputos DISTINTOS, y el segundo tiene que invalidar igual que el primero: si la
 * clave los fundiera, el segundo encolado se descartaria en silencio y la cache serviria las
 * cifras del primer recomputo. Es exactamente el modo de fallo que R12 evita.
 *
 * Lo que el `dedupe_key` si sigue dando es la idempotencia dentro de UNA corrida: el script
 * calcula la clave una vez y un reintento del mismo proceso no encola dos veces.
 *
 * ⚠ FEATURE 179 (T3.8) — ESTA FUNCION NO CAMBIA, Y ESO ES UNA DECISION MEDIDA.
 * `design.md §2` de la 179 anticipaba meterle el dominio dentro. No hizo falta y habria costado
 * caro: `tests/unit/scripts/backfill-analitica-invalidacion.test.ts` (feature 128) fija el
 * FORMATO exacto de esta clave con un `^...$`, y ese archivo esta fuera de la frontera de
 * archivos de la 179 (R25). Lo que la decision perseguia —que dos corridas de dominios distintos
 * en la misma ventana no se deduplicaran entre si (`ON CONFLICT (dedupe_key) DO NOTHING`)— se
 * consigue igual y de forma ESTRUCTURAL: la clave de la financiera la emite
 * `dedupeKeyInvalidacionSinRango`, cuyo segundo segmento es el dominio y el tercero la marca
 * literal `sin-rango`; una clave con un `YYYY-MM-DD..YYYY-MM-DD` ahi no puede coincidir con ella
 * nunca. Lo mide `cache-financiera-invalidacion-backfill.test.ts`.
 *
 * @param desde fecha CR `YYYY-MM-DD`, inclusive, del rango recomputado.
 * @param hasta fecha CR `YYYY-MM-DD`, inclusive.
 * @param instante momento de la corrida (inyectado: nada de `Date.now()` escondido).
 */
export function dedupeKeyInvalidacion(desde: string, hasta: string, instante: Date): string {
  return `${DEDUPE_PREFIX_INVALIDACION}:${desde}..${hasta}:${instante.getTime()}`;
}

/**
 * Feature 179 (T3.9) — la clave de una corrida SIN RANGO.
 *
 * El backfill de tesoreria no recomputa un rango de fechas: barre los documentos que no tienen
 * su fila de caja, esten donde esten. Meterle un `desde..hasta` inventado seria escribir un dato
 * falso en la clave y en el registro solo para encajar en una firma. El `epoch` sigue siendo lo
 * que impide deduplicar entre corridas distintas, igual que arriba.
 */
export function dedupeKeyInvalidacionSinRango(
  dominio: DominioInvalidacion,
  instante: Date,
): string {
  return `${DEDUPE_PREFIX_INVALIDACION}:${dominio}:sin-rango:${instante.getTime()}`;
}

/** Payload del job. Solo para el registro (R23): la invalidacion es POR DOMINIO, no por fecha. */
export interface PayloadInvalidacionCache extends Record<string, unknown> {
  readonly desde?: string;
  readonly hasta?: string;
  /** Feature 179/R27. AUSENTE = `operativa`: los jobs de la 128 no lo llevan y deben seguir. */
  readonly dominio?: DominioInvalidacion;
}

/**
 * Payload del backfill OPERATIVO (128). **NO lleva `dominio` a proposito**: es el mismo payload
 * que la 128 encola hoy, y su ausencia es lo que ejercita el default de R27 en produccion, no
 * solo en un test.
 */
export function payloadInvalidacion(desde: string, hasta: string): PayloadInvalidacionCache {
  return { desde, hasta };
}

/** Feature 179 (T3.9) — payload de una invalidacion de dominio, sin rango. */
export function payloadInvalidacionDeDominio(
  dominio: DominioInvalidacion,
): PayloadInvalidacionCache {
  return { dominio };
}
