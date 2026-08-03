// Feature 128 (T1.2/T1.3, design §5) — LA CLAVE DE CACHE Y EL CODEC DE CUBOS.
//
// Modulo PURO: sin Next, sin Prisma, sin `process.env` y sin efectos al importarse. Lo que
// entra es una `ConsultaAnalitica` ya preparada por la 122 y lo que sale es una cadena.
//
// ─── Por que el ALCANCE va en la clave, y por que eso es SEGURIDAD (R6) ─────────────────────
// `recortarFiltro` (`lib/analytics/consulta.ts:144`) escribe el recorte DENTRO del filtro, asi
// que HOY dos consultas con el mismo filtro dan las mismas filas. Pero el `where` real se
// compone de TRES piezas con `AND`
// (`AnaliticaOperativaRollupRepository.whereDeConsulta:159-170`) y el propio archivo de la 126
// dice por que no se apoya en esa coincidencia: «apoyarse en esa coincidencia es apoyarse en
// una feature ajena para sostener la frontera multi-tenant». La cache hereda ese criterio.
// Una clave que no distingue el alcance NO da una cifra equivocada: **filtra datos entre
// roles** — un mensajero recibiria lo que se cacheo para un admin.
//
// El `switch` sobre `alcance.tipo` es EXHAUSTIVO y sin rama `default`: una quinta variante de
// `AlcanceDatos` no compila. Ademas lo vigila estaticamente
// `tests/unit/analytics/cache-clave-alcance.guardia.test.ts`, que sobrevive al merge.
//
// ─── Por que hay CODEC (R9) ────────────────────────────────────────────────────────────────
// No es una precaucion: sin el, la escritura en cache **LANZA**. `unstable_cache` serializa el
// valor con `JSON.stringify`
// (`node_modules/next/dist/server/web/spec-extension/unstable-cache.js:23`) y
// `CuboRollup.segCicloAcum` es `bigint`
// (`lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts:64`). `JSON.stringify`
// sobre un `BigInt` lanza `TypeError: Do not know how to serialize a BigInt` — no devuelve
// `null`, no lo omite, no degrada: **lanza**. Guardar el cubo tal cual rompe la CONSULTA
// entera, no la cache.

import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { AlcanceDatos } from "@/lib/analytics/alcance";
import { DIMENSIONES } from "@/lib/analytics/types";
import type { DimensionAnalitica } from "@/lib/analytics/types";

/* -------------------------------------------------------------------------- */
/* 1. La clave                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Separador de componentes: `US` (unit separator, U+001F). No puede aparecer dentro de un
 * uuid, de una fecha `YYYY-MM-DD` ni de un `metricaId`, asi que dos claves distintas no
 * pueden colapsar en una por concatenacion ambigua.
 */
const SEP = "\u001f";

/** Separador dentro de una lista de ids. Mismo motivo, un nivel mas abajo. */
const SEP_LISTA = ",";

/**
 * La clave de una consulta al rollup.
 *
 * Componentes, en orden FIJO:
 *   1. `metricaId`                                     (R8)
 *   2. granos, en el orden canonico de `DIMENSIONES`   (R8)
 *   3. `desdeFecha` / `hastaFecha` **resueltos**       (R5 — NUNCA el preset)
 *   4. alcance (`tipo` + su id)                        (R6 — seguridad)
 *   5. filtro ya recortado, cada lista ordenada y deduplicada (R7)
 *
 * R5 — el preset NO entra: `rango: "dia"` significa un dia distinto cada dia. Si el preset
 * fuera la clave, la consulta de hoy devolveria los cubos de ayer.
 */
export function claveDeConsulta(
  c: ConsultaAnalitica,
  granos: readonly DimensionAnalitica[],
): string {
  return [
    `m=${c.metrica.id}`,
    `g=${granosNormalizados(granos).join(SEP_LISTA)}`,
    `d=${c.rango.desdeFecha}`,
    `h=${c.rango.hastaFecha}`,
    `a=${claveDeAlcance(c.alcance)}`,
    `z=${idsNormalizados(c.filtro.zona_id)}`,
    `t=${idsNormalizados(c.filtro.tienda_id)}`,
    `x=${idsNormalizados(c.filtro.mensajero_id)}`,
  ].join(SEP);
}

/**
 * R6 — el alcance resuelto, como cadena. `switch` EXHAUSTIVO sobre las CUATRO variantes de
 * `AlcanceDatos` (`lib/analytics/alcance.ts:65-69`) y sin rama `default`: una quinta variante
 * no compilaria, y el guardia estatico la caza incluso antes.
 *
 * El id va SIEMPRE: `zona:z1` y `zona:z2` no pueden compartir entrada.
 */
export function claveDeAlcance(alcance: AlcanceDatos): string {
  switch (alcance.tipo) {
    case "global":
      return "global";
    case "zona":
      return `zona:${alcance.zonaId}`;
    case "tienda":
      return `tienda:${alcance.tiendaId}`;
    case "mensajero":
      return `mensajero:${alcance.mensajeroId}`;
  }
}

/**
 * R8 — los granos, en el orden canonico del catalogo y sin repetidos. Ordenar por el orden de
 * `DIMENSIONES` (y no alfabeticamente) hace que `["estatus","zona"]` y `["zona","estatus"]`
 * compartan entrada, que es lo correcto: piden la misma agregacion.
 */
function granosNormalizados(granos: readonly DimensionAnalitica[]): readonly DimensionAnalitica[] {
  const pedidos = new Set(granos);
  return DIMENSIONES.filter((d) => pedidos.has(d));
}

/**
 * R7 — una lista de ids, ORDENADA y DEDUPLICADA: insensible al orden, sensible al contenido.
 * `[a,b]` y `[b,a]` dan la misma cadena; `[a]` y `[a,b]` no.
 *
 * `undefined` (la dimension no se filtra) se distingue de la lista VACIA con un centinela: no
 * son lo mismo y fundirlos compartiria entrada entre dos consultas distintas.
 */
function idsNormalizados(ids: readonly string[] | undefined): string {
  if (ids === undefined) return "*";
  return [...new Set(ids)].sort().join(SEP_LISTA);
}
