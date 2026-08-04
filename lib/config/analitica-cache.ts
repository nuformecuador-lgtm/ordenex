// Feature 128 (T4.1, design §8) — CONFIGURACION DE LA CACHE DE ANALITICA.
//
// Dos cosas y nada mas: el kill-switch (D5) y el TTL (D4). Criterio calcado de
// `lib/config/analitica-financiera.ts` y de R47 de la 124: los numeros sin medicion detras
// viven en UNA constante que lo declara, no repartidos por el codigo.

/**
 * D4 (humano, 2026-08-03) — TTL maximo de una entrada, en segundos.
 *
 * **RED DE SEGURIDAD, NO MECANISMO.** Quien hace el trabajo es la invalidacion explicita
 * (R10/R12/R14); el TTL solo acota el daño de un invalidador que no llegue.
 *
 * ⚠ **PROVISIONAL Y NO MEDIDA**: no hay medicion de trafico ni del coste del `GROUP BY` sobre
 * `analytics_daily` en este repo. 3600 s es un valor elegido por prudencia, no por evidencia.
 *
 * R17 — vive SOLO aqui. El censo del literal esta acotado al ambito de la analitica
 * (`lib/analytics/`, `lib/cache/` y los archivos de la feature) a proposito: `3600` ya aparece
 * cuatro veces en `lib/` por motivos ajenos a esta feature —`lib/auth/google-sa-token.ts:42`,
 * `lib/auth/google-adc-token.ts:28`, `lib/config/etiquetas.ts:52` y `:69`— y un censo global
 * naceria rojo por literales ajenos y se desarmaria a la primera, dejando de proteger nada
 * (leccion de la 125).
 */
export const ANALITICA_CACHE_TTL_SEGUNDOS = 3600;

/** Nombre de la variable de entorno del kill-switch. Se exporta para que el test no lo copie. */
export const ANALITICA_CACHE_DISABLED_ENV = "ANALITICA_CACHE_DISABLED";

/** Los valores que APAGAN la cache. Cualquier otra cosa —incluida la ausencia— la deja ON. */
const VALORES_APAGADO = new Set(["1", "true", "TRUE", "yes", "on"]);

/**
 * D5 (humano, 2026-08-03) = (a) — kill-switch por variable de entorno, **ENCENDIDA por
 * defecto**.
 *
 * Ausencia de la variable = habilitada. Invertir el default dejaria la feature inservible en
 * produccion hasta que alguien hiciera un deploy para encenderla; y si la cache sirviera algo
 * raro, apagarla NO debe requerir un PR.
 *
 * `env` entra por parametro (patron de `resolverRango` y de `lib/config/etiquetas.ts:7-12`)
 * para que el test no tenga que mutar `process.env` global.
 */
export function analiticaCacheHabilitada(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const crudo = env[ANALITICA_CACHE_DISABLED_ENV];
  if (crudo === undefined) return true;
  return !VALORES_APAGADO.has(crudo.trim());
}
