// Feature 192 (B9.3, design.md §5.quater) — EL UNICO ARCHIVO DE ESTA FEATURE QUE IMPORTA
// `next/cache`.
//
// R71 lo hace cumplir `tests/unit/tablero-dia/cache-sin-invalidacion.guardia.test.ts`, que
// censa el arbol y sobrevive al merge. No es higiene: `unstable_cache` lanza `Invariant:
// incrementalCache missing` fuera de un request de Next, asi que un import mal colocado
// tumbaria la suite unitaria del servicio —que corre sin runtime de Next y sin
// `DATABASE_URL`—. Es la leccion ya pagada por la 128.
//
// ⛔ Aqui NO hay `revalidateTag`, `revalidatePath` ni `updateTag`, y no es un olvido: la
// entrada expira UNICAMENTE por tiempo (R71). Si algun dia esto se ve tentado de invalidacion
// por evento, la señal correcta no es añadirla: es que el indice era la respuesta y hay que
// reabrir `design.md §5.ter`.
//
// ⚠ LIMITE DECLARADO: este archivo NO es testeable en unitario. Por eso se diseña para que
// sea lo mas fino posible — una delegacion, sin ramas y sin logica.

import { unstable_cache } from "next/cache";

import { TABLERO_DIA_CACHE_TTL_SEGUNDOS } from "@/lib/config/tablero-dia-cache";
import type { ITableroDiaCache } from "@/lib/interfaces/external/ITableroDiaCache";

export class NextTableroDiaCache implements ITableroDiaCache {
  async envolver<T>(clave: string, producir: () => Promise<T>): Promise<T> {
    return unstable_cache(producir, [clave], {
      revalidate: TABLERO_DIA_CACHE_TTL_SEGUNDOS,
    })();
  }
}

/** El puerto que se cablea en produccion (lo llama la Server Action). */
export function crearTableroDiaCacheDeNext(): ITableroDiaCache {
  return new NextTableroDiaCache();
}
