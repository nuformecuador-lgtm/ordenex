// Feature 128 (T1.4, design §8) — EL PUERTO DE CACHE DE LA ANALITICA.
//
// Contrato NEUTRAL: sin Next, sin Prisma y sin `process.env`. Los dos adaptadores que lo
// implementan son `lib/cache/next-analitica-cache.ts` (produccion) y `lib/cache/cache-nula.ts`
// (bandera apagada y tests). El decorador del repositorio y los handlers de job dependen de
// ESTA interfaz y de nada mas: por eso `unstable_cache`, que lanza fuera de un request de
// Next, no contamina ni la suite unitaria del servicio ni el script CLI del backfill.

/**
 * Quien disparo una invalidacion. Dominio CERRADO y sin datos dentro: R23 exige registrar el
 * ORIGEN, y un origen no es un texto libre donde alguien acabe metiendo un id.
 *
 * - `job_rollup_diario` — el job de la 124 acaba de reescribir el rollup de una fecha.
 * - `backfill` — el backfill de la 125 recomputo un rango (llega por job encolado, §7.1).
 * - `manual` — invocacion humana de mantenimiento.
 */
export type OrigenInvalidacion = "job_rollup_diario" | "backfill" | "manual";

export interface IAnaliticaCache {
  /**
   * Devuelve el valor cacheado bajo `clave` o ejecuta `producir`, lo guarda con `tags` y lo
   * devuelve.
   *
   * `T` DEBE ser JSON-safe: el adaptador de produccion serializa con `JSON.stringify`. Un
   * `bigint` o un `Map` aqui dentro no degradan, LANZAN. Por eso el decorador mete el codec
   * (`lib/analytics/cache-clave.ts`) entre el repositorio y este puerto.
   */
  envolver<T>(clave: string, tags: readonly string[], producir: () => Promise<T>): Promise<T>;

  /**
   * Invalida todas las entradas que lleven alguno de `tags`.
   *
   * R11 — si falla, LANZA. Nunca se traga el error: una invalidacion que falla en silencio
   * deja la cifra congelada para siempre y SIN SENAL, que es el modo de fallo mas caro de
   * esta feature. El llamador (el handler del job) deja que se propague para que
   * `JobQueueService` lo cuente como fallo y aplique su backoff.
   */
  invalidar(origen: OrigenInvalidacion, tags: readonly string[]): Promise<void>;
}
