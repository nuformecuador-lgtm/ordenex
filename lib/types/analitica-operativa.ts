// Feature 126 (T1.1, design §5.2) — CONTRATO DE SALIDA de la analitica operativa.
//
// Modulo de TIPOS y constantes. No importa Prisma, ni `next/headers`, ni repositorios, ni
// servicios: se puede importar desde un test sin base de datos y desde la UI de la 131.
//
// Tres invariantes que este archivo hace estructurales, no de buena voluntad:
//
//  1. **Nada de `BigInt` y nada de `Date` cruda en las medidas** (R30). `seg_ciclo_acum` es
//     `BigInt` en el rollup y `JSON.stringify` de un `BigInt` LANZA `TypeError`
//     (`IAnaliticaRollupService.ts:8-11`). Aqui todo valor es `number | null` y todo
//     instante es una cadena ISO. La unica `Date` que sobrevive es la del `RangoResuelto`,
//     que el design declara explicitamente y que serializa a ISO de forma estable.
//  2. **`cobertura` es OBLIGATORIA** (R34/T8.2). Declararla `cobertura?:` permitiria a la
//     131/133 ignorarla por omision, y entonces la decision T0-Q2 = B no compraria nada:
//     «cero» y «no se sabe» volverian a ser el mismo pixel.
//  3. **`valor: number | null`**, nunca `0` como sustituto de «indefinido» (R10/R14): un
//     denominador 0 devuelve `null`, no `0`.
//
// AVISO DIRIGIDO A LA 131 (tablero operativo) Y A LA 133 (recortes por rol) — D9:
// el bloque `cobertura` y el marcador `parcial: true` SE PINTAN. Si la informacion existe
// y no llega al pixel, un rango que cruza el 2026-07-13 se lee como una caida de la
// operacion que nunca ocurrio, y el dia en curso se lee como un dia cerrado.

import type { MetricaUnidad, RangoResuelto, UnidadDeConteo } from "@/lib/analytics/types";

/* -------------------------------------------------------------------------- */
/* Cobertura (D9 / R19 / R20 / R34)                                            */
/* -------------------------------------------------------------------------- */

/**
 * R20 — LA PENUMBRA, declarada como limitacion conocida y PERMANENTE.
 *
 * Las ordenes que estaban vivas el dia en que nacio `orden_historial_estado` y que nunca
 * volvieron a transicionar no tienen ninguna fila de historial anterior al corte, asi que
 * no entran en NINGUN cubo — ni el dia del horizonte ni ningun dia posterior
 * (`specs/125-analitica-backfill-historico/design.md §11`). No caduca.
 *
 * Es un literal cerrado a proposito: R20 prohibe estimarla, simularla o rellenarla. Un
 * `number` invitaria a calcularlo; una cadena fija solo se puede declarar.
 */
export const PENUMBRA = "ordenes_vivas_al_horizonte_sin_transicion_posterior" as const;

export type Penumbra = typeof PENUMBRA;

/**
 * D9/R19 — lo que la respuesta sabe sobre su propia cobertura.
 *
 * `fechasNoComparables` sale de `esNoComparable()` (feature 125,
 * `lib/analytics/backfill-rango.ts`). La 126 NO declara una segunda constante de horizonte:
 * seria la clasica cifra duplicada que un dia diverge, y el censo de R19 comprueba que la
 * fecha literal `2026-07-13` aparece en UN solo archivo del arbol de codigo.
 */
export interface Cobertura {
  /** Fechas CR del rango que caen bajo el horizonte del historial: `no_comparable`. */
  readonly fechasNoComparables: readonly string[];
  /** Limitacion permanente, nunca estimada (R20). */
  readonly penumbra: Penumbra;
}

/* -------------------------------------------------------------------------- */
/* La serie (design §5.2)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * D14/R35 — la semantica de `sin_gestionar`, escrita CON TODAS LAS LETRAS en el contrato.
 *
 * Es «sin gestionar HOY» —universo B2 de la 124: ordenes vivas en ese estado al corte, mas
 * las que llegaron a terminal ese dia— y NO «sin gestionar acumuladas». Leida como
 * acumulada es un numero muy distinto y nada en el nombre de la metrica impide esa lectura.
 *
 * FRONTERA: esta declaracion deberia estar TAMBIEN en `lib/analytics/metrics.ts`, que es
 * archivo de la 127. Queda anotada para la **ficha 175** (`design.md §9`), no se escribe
 * alli desde aqui (R3).
 */
export const NOTA_SIN_GESTIONAR = "sin_gestionar_es_del_dia_universo_b2" as const;

export type NotaSinGestionar = typeof NOTA_SIN_GESTIONAR;

/** Un punto de la serie. `dimension` ausente = la serie no esta desagregada. */
export interface PuntoSerie {
  /** `YYYY-MM-DD` calendario de Costa Rica. */
  readonly fecha: string;
  /** Estatus / causa / mensajero YA seudonimizado si la politica lo exige (R7). */
  readonly dimension?: string;
  /** `null` = indefinido (denominador 0). NUNCA `0` para decir «no se sabe» (R10/R14). */
  readonly valor: number | null;
  /** D6/R18 — el dia en curso, que por construccion no esta en el rollup. */
  readonly parcial?: true;
  /** ISO del instante usado como cota superior. Solo con `parcial: true`. */
  readonly corteAt?: string;
}

/**
 * La serie que devuelve una consulta `ok`. R30: declara la metrica, el rango usado y la
 * fecha de referencia de cada punto (la lleva el propio punto).
 */
export interface SerieOperativa {
  readonly metricaId: string;
  readonly unidad: MetricaUnidad;
  /** R9 — sale de `getMetrica(id).unidadDeConteo`, JAMAS de una tabla propia. */
  readonly unidadDeConteo: UnidadDeConteo;
  readonly rango: RangoResuelto;
  readonly puntos: readonly PuntoSerie[];
  /** R34 — OBLIGATORIO. Nunca `cobertura?`. */
  readonly cobertura: Cobertura;
  /** R35 — presente SOLO en `sin_gestionar`. Texto fijo, no comentario de codigo. */
  readonly nota?: NotaSinGestionar;
}

/* -------------------------------------------------------------------------- */
/* Resultado del borde (design §5.2)                                           */
/* -------------------------------------------------------------------------- */

/**
 * R5/R41 de la 122 — `forbidden` es un estado de PRIMERA CLASE y viaja SIN datos y SIN
 * motivo: el motivo va al log de auditoria, no al cliente. Nunca `ok` con ceros, nunca
 * lista vacia, nunca 200 con `data: []`.
 */
export type ResultadoOperativo =
  | { readonly status: "ok"; readonly datos: SerieOperativa }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> }
  | { readonly status: "forbidden" }
  | { readonly status: "unauthenticated" };
