// Feature 267 / P4-bis (2026-08-23) — LA LISTA DE METRICAS DE LA QUERY, resuelta.
//
// POR QUE VIVE EN `lib/api/` Y NO EN EL CASCARON HTTP, y no es estilo: la guardia de frontera de
// 134/R3 (`export-csv-frontera.guardia.test.ts`) prohibe que un archivo de `app/api` importe de
// `@/lib/analytics/**` —incluido el camino nominalmente autorizado de esta feature—, para que un
// route handler no acabe siendo una segunda puerta a la analitica con su propio gating. Expandir
// `all` exige leer la lista blanca, que es de `lib/analytics`; asi que la lectura pasa por aqui,
// igual que la consulta pasa por `analitica-integrador.ts`. El cascaron sigue sin nombrar ni un
// modulo de analitica.
//
// Modulo puro: sin `next/*`, sin Prisma, sin `process.env`, sin efectos al importarse.

import { METRICAS_API_KEY, METRICAS_TODAS } from "@/lib/analytics/publicacion-api-key";

/** Lo que sale de leer `metricas`: la lista ya resuelta, o el motivo publico del 422. */
export type ResolucionMetricas =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false; readonly mensaje: string };

/**
 * R45/R46/R47 — LEE `metricas` Y DEVUELVE LA LISTA QUE SE VA A SERVIR.
 *
 * Es una funcion pura y separada del schema a proposito: aqui hay CUATRO reglas de contrato que
 * un `z.string()` no expresa, y cada una tiene su motivo escrito.
 *
 *  1. **CSV, no clave repetida.** `metricas=a,b,c` mantiene la lectura CLAVE POR CLAVE del canal
 *     (106/R8): `sp.get` sigue devolviendo un `string` y no hay que abrir la puerta al multivalor
 *     para una sola clave.
 *  2. **`all` no se mezcla** (R46). `metricas=all,entregas` es ambiguo —¿todo, o solo esa?— y un
 *     contrato publico no adivina: es 422. `all` va solo o no va.
 *  3. **Los duplicados se colapsan** (R47), conservando la PRIMERA aparicion. Devolver dos veces
 *     la misma serie no le sirve a nadie y duplicaria el trabajo contra el rollup; rechazarlo con
 *     un 422 seria antipatico sin ganar nada.
 *  4. **El tope es el tamano de la lista blanca**, y no es un numero inventado: tras deduplicar
 *     NUNCA puede haber mas ids validos que metricas publicables, asi que una lista mas larga
 *     contiene necesariamente algo que no se publica. Se corta aqui para no preparar cien
 *     consultas antes de denegar. No revela nada nuevo: el tamano de la lista blanca ya se publica
 *     como `enum` en el OpenAPI.
 *
 * Lo que esta funcion NO hace, y es la mitad del punto: **no comprueba que los ids existan ni que
 * sean publicables** (solo usa la lista para expandir `all` y para el tope). Un id desconocido o
 * no publicable sale de aqui como un id cualquiera y muere despues en el 403 mudo del borde,
 * indistinguible de los demas (R16). Si validara aqui, el 422 y el 403 dirian cosas distintas y
 * la lista blanca se podria reconstruir desde fuera.
 */
export function resolverMetricasPedidas(valor: string): ResolucionMetricas {
  const tokens = valor.split(",").map((t) => t.trim());
  if (tokens.some((t) => t.length === 0)) {
    return { ok: false, mensaje: "`metricas` no admite elementos vacios." };
  }
  if (tokens.includes(METRICAS_TODAS)) {
    if (tokens.length > 1) {
      return {
        ok: false,
        mensaje: "`all` no se combina con ids: pide `all` o la lista, no las dos cosas.",
      };
    }
    return { ok: true, ids: [...METRICAS_API_KEY] };
  }
  if (tokens.length > METRICAS_API_KEY.length) {
    return {
      ok: false,
      mensaje: `\`metricas\` admite como maximo ${METRICAS_API_KEY.length} ids, o \`all\`.`,
    };
  }
  // `Set` conserva el orden de primera aparicion: el que se publicara (R47).
  return { ok: true, ids: [...new Set(tokens)] };
}
