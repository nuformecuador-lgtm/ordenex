// Feature 128 (T2.1, D1) — EL UNICO ARCHIVO DEL ARBOL DE ANALITICA QUE IMPORTA `next/cache`.
//
// R21 lo hace cumplir con `tests/unit/analytics/cache-aislamiento.guardia.test.ts`, que
// SOBREVIVE al merge. No es higiene: `unstable_cache` lanza `Invariant: incrementalCache
// missing` fuera de un request de Next (`unstable-cache.js:59-67`) y `revalidateTag` lanza
// `Invariant: static generation store missing` (`revalidate.js:104-107`), asi que un import
// mal colocado tumbaria la suite unitaria del servicio —que hoy corre sin runtime de Next y
// sin `DATABASE_URL`— y el script CLI del backfill.
//
// D1 (humano, 2026-08-03) = (a) — `unstable_cache({ tags })` + `revalidateTag`, y
// **`next.config.ts` NO se toca**. `cacheTag()` lanza «`cacheTag()` is only available with the
// `cacheComponents` config» (`node_modules/next/dist/server/use-cache/cache-tag.js:15`) y
// activar `cacheComponents` es una bandera GLOBAL que cambia el modelo de renderizado de toda
// la aplicacion; ningun gate de este repo corre `next build`, asi que esa regresion no la
// veria nadie hasta produccion.
//
// ⚠ LIMITE DECLARADO, SIN MAQUILLAJE (`design.md §11`): este archivo **no es testeable en
// unitario**. Es la pulgada no cubierta de la feature, y por eso se disena para que sea lo mas
// fina posible: dos delegaciones, sin ramas y sin logica. Todo lo demas —clave, codec,
// decorador, handlers, script— corre sin Next.

import { revalidateTag, unstable_cache } from "next/cache";
import { ANALITICA_CACHE_TTL_SEGUNDOS, analiticaCacheHabilitada } from "@/lib/config/analitica-cache";
import { cacheNula } from "@/lib/cache/cache-nula";
import { conRegistroDeInvalidacion } from "@/lib/cache/registro-invalidacion";
import type { IAnaliticaCache, OrigenInvalidacion } from "@/lib/interfaces/external/IAnaliticaCache";

export class NextAnaliticaCache implements IAnaliticaCache {
  /**
   * `revalidate` va SIEMPRE con el TTL de `lib/config/analitica-cache.ts` y NUNCA `false`
   * (R17): sin TTL, un invalidador que no llegue congela la cifra para siempre.
   */
  async envolver<T>(
    clave: string,
    tags: readonly string[],
    producir: () => Promise<T>,
  ): Promise<T> {
    return unstable_cache(producir, [clave], {
      tags: [...tags],
      revalidate: ANALITICA_CACHE_TTL_SEGUNDOS,
    })();
  }

  /** R11 — sin `try/catch`: lo que lance `revalidateTag` sube al llamador. */
  async invalidar(_origen: OrigenInvalidacion, tags: readonly string[]): Promise<void> {
    for (const tag of tags) revalidateTag(tag);
  }
}

/**
 * El puerto que se cablea en produccion: adaptador de Next + registro (R23), o la cache nula
 * si la bandera de entorno la apago (R16/D5).
 */
export function crearAnaliticaCacheDeNext(
  env: Readonly<Record<string, string | undefined>> = process.env,
): IAnaliticaCache {
  if (!analiticaCacheHabilitada(env)) return cacheNula();
  return conRegistroDeInvalidacion(new NextAnaliticaCache());
}
