// Feature 192 (B9.3, design.md §5.quater) — ADAPTADOR PASS-THROUGH DEL PUERTO DE CACHE.
//
// Cada llamada ejecuta `producir`. Es lo que usan el servicio por defecto y todo test que no
// quiera ejercitar la cache.
//
// Sin Next y sin Prisma: importarlo desde un test unitario NO arrastra `unstable_cache`, que
// lanza `Invariant: incrementalCache missing` fuera de un request de Next.

import type { ITableroDiaCache } from "@/lib/interfaces/external/ITableroDiaCache";

export class TableroDiaCacheNula implements ITableroDiaCache {
  async envolver<T>(_clave: string, producir: () => Promise<T>): Promise<T> {
    return producir();
  }
}

/** Azucar para los composition roots y los tests. */
export function tableroDiaCacheNula(): ITableroDiaCache {
  return new TableroDiaCacheNula();
}
