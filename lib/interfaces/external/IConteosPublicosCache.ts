// Feature 198 — puerto de cache de los conteos publicos.
//
// Misma forma que `ITableroDiaCache` (feature 192) y por el mismo motivo: `unstable_cache`
// lanza `Invariant: incrementalCache missing` fuera de un request de Next, asi que el codigo
// que se prueba en unitario NO puede importarlo. Con un puerto, el test inyecta la version
// nula y el runtime de Next se queda en un unico archivo, aislado.
//
// NO se reutiliza `ITableroDiaCache` tal cual aunque la firma coincida: es el puerto de OTRA
// feature, con su propio TTL y su propia decision de invalidacion. Compartirlo ataria dos
// cosas que solo se parecen hoy.

export interface IConteosPublicosCache {
  /**
   * Devuelve el valor cacheado de `clave`, o ejecuta `producir` y lo guarda.
   *
   * La entrada expira UNICAMENTE por tiempo: aqui no hay invalidacion por evento, igual que
   * en la 192. Un conteo historico que se mueve despacio no la necesita, y anadirla obligaria
   * a decidir QUE eventos la disparan —cada orden creada, cada gestion— que es justo el
   * trafico que la cache viene a evitar.
   */
  envolver<T>(clave: string, producir: () => Promise<T>): Promise<T>;
}
