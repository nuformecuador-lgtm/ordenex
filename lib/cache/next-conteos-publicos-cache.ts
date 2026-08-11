// Feature 198 — EL UNICO ARCHIVO DE ESTA FEATURE QUE IMPORTA `next/cache`.
//
// Mismo aislamiento que `next-tablero-dia-cache.ts` (feature 192), y por la misma razon ya
// pagada: `unstable_cache` lanza `Invariant: incrementalCache missing` fuera de un request de
// Next, asi que un import mal colocado tumbaria la suite unitaria, que corre sin runtime de
// Next y sin `DATABASE_URL`.
//
// ⛔ Aqui NO hay `revalidateTag` ni `revalidatePath`, y no es un olvido: la entrada expira
// solo por tiempo (6 h). Ver el porque en `lib/interfaces/external/IConteosPublicosCache.ts`.
//
// ⚠ LIMITE DECLARADO: este archivo NO es testeable en unitario. Por eso se diseña para que sea
// lo mas fino posible — una delegacion, sin ramas y sin logica.

import { unstable_cache } from "next/cache";

import { CONTEOS_PUBLICOS_CACHE_TTL_SEGUNDOS } from "@/lib/config/conteos-publicos-cache";
import type { IConteosPublicosCache } from "@/lib/interfaces/external/IConteosPublicosCache";

export class NextConteosPublicosCache implements IConteosPublicosCache {
  async envolver<T>(clave: string, producir: () => Promise<T>): Promise<T> {
    return unstable_cache(producir, [clave], {
      revalidate: CONTEOS_PUBLICOS_CACHE_TTL_SEGUNDOS,
    })();
  }
}

/** El puerto que se cablea en produccion (lo llama la Server Action). */
export function crearConteosPublicosCacheDeNext(): IConteosPublicosCache {
  return new NextConteosPublicosCache();
}
