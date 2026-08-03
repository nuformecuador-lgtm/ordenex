// Feature 128 (T1.3) — EL CODEC DE CUBOS: el viaje por JSON (R9).
//
// ⚠ DESVIACION DECLARADA de `design.md §5`, que ponia el codec dentro de
// `lib/analytics/cache-clave.ts`. **No cabe ahi.** El codec necesita el tipo `CuboRollup`, que
// vive en `lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts`, y el guardia de
// pureza de la 122/135 (`tests/unit/analytics/modulo-puro.guardia.test.ts`) prohibe que
// CUALQUIER archivo de `lib/analytics/` importe un especificador con el segmento
// `repositories` — juzga la RUTA, no si el import es de tipo. Se movio el CODIGO, no el
// guardia: relajar aquel para colocar un archivo nuevo seria exactamente lo que no se hace.
// `claveDeConsulta` se queda en `lib/analytics/cache-clave.ts`, que sigue siendo puro.
//
// ─── POR QUE EXISTE EL CODEC ───────────────────────────────────────────────────────────────
// No es una precaucion: sin el, la escritura en cache **LANZA**. `unstable_cache` serializa el
// valor con `JSON.stringify`
// (`node_modules/next/dist/server/web/spec-extension/unstable-cache.js:23`) y
// `CuboRollup.segCicloAcum` es `bigint`
// (`lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts:64`). `JSON.stringify`
// sobre un `BigInt` lanza `TypeError: Do not know how to serialize a BigInt` — no devuelve
// `null`, no lo omite, no degrada: **lanza**. Guardar el cubo tal cual rompe la CONSULTA
// entera, no la cache.

import type { CuboRollup } from "@/lib/interfaces/repositories/IAnaliticaOperativaRollupRepository";

/**
 * El cubo tal y como sobrevive a `JSON.stringify` / `JSON.parse`.
 *
 * La UNICA diferencia con `CuboRollup` es `segCicloAcum: string` (decimal). Los dos `null` con
 * significado de dominio se conservan como `null` EXPLICITO:
 *   - `mensajeroId: null` = cubo sin asignar (D10/R8 de la 126);
 *   - `causaDevolucion: null` = devolucion sin causa tipificada (R15 de la 126).
 * Nunca `undefined` —que `JSON.stringify` BORRA de la salida— y nunca un centinela como
 * `"sin_asignar"`, que etiquetaria dos veces el cubo sin asignar.
 */
export type CuboCodificado = Omit<CuboRollup, "segCicloAcum"> & { readonly segCicloAcum: string };

/** Escritura: `bigint` -> `string` decimal. Todo lo demas viaja tal cual. */
export function codificarCubos(cubos: readonly CuboRollup[]): readonly CuboCodificado[] {
  return cubos.map((c) => ({ ...c, segCicloAcum: c.segCicloAcum.toString() }));
}

/** Lectura: `string` decimal -> `bigint`. Sin esto `tiempo_ciclo` CONCATENA en vez de sumar. */
export function decodificarCubos(cubos: readonly CuboCodificado[]): readonly CuboRollup[] {
  return cubos.map((c) => ({ ...c, segCicloAcum: BigInt(c.segCicloAcum) }));
}
