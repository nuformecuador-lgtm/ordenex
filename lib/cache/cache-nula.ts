// Feature 128 (T1.4, design §1) — IMPLEMENTACION PASS-THROUGH DEL PUERTO.
//
// Es lo que se usa cuando la bandera de entorno apaga la cache (R16, D5) y lo que permite
// ejercer el resto de la feature sin runtime de Next. NO guarda nada, NO lee nada y NO
// invalida nada: cada llamada ejecuta `producir`.
//
// Sin Next y sin Prisma: importarla desde un test unitario no arrastra `unstable_cache`, que
// lanza `Invariant: incrementalCache missing` fuera de un request.

import type { IAnaliticaCache, OrigenInvalidacion } from "@/lib/interfaces/external/IAnaliticaCache";

export class CacheNula implements IAnaliticaCache {
  async envolver<T>(
    _clave: string,
    _tags: readonly string[],
    producir: () => Promise<T>,
  ): Promise<T> {
    return producir();
  }

  /**
   * No-op DELIBERADO y no un `throw`: cuando la cache esta apagada no hay entrada que
   * invalidar, y hacer fallar el job diario por eso convertiria el kill-switch en una averia.
   */
  async invalidar(_origen: OrigenInvalidacion, _tags: readonly string[]): Promise<void> {
    return;
  }
}

/** Azucar para los composition roots y los tests. */
export function cacheNula(): IAnaliticaCache {
  return new CacheNula();
}
