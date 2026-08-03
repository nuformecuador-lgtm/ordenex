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

/* -------------------------------------------------------------------------- */
/* Feature 176 — MODO AGREGADO (design §3). ADITIVO: nada de arriba cambia.    */
/* -------------------------------------------------------------------------- */

// Por que existe este bloque, en una frase: la serie de la 126 divide POR DIA, y sumar
// despues esos cocientes es media de medias — que pondera igual un dia de 1 gestion y un
// dia de 1.000. El modo agregado devuelve los COMPONENTES antes de dividir, para que la
// division ocurra una sola vez sobre todo el cubo temporal.
//
// D1 — se anade JUNTO a `PuntoSerie`/`SerieOperativa`, sin tocarlos: la 131 y la 132 los
// consumen en produccion. Un campo `agregado?` dentro de la serie habria cambiado el
// payload de dos consumidores vivos y obligado a calcular el agregado incluso cuando solo
// se quiere la serie.

/** Cubo temporal del modo agregado: los componentes ANTES de dividir. */
export interface CuboAgregado {
  /**
   * Ancla del cubo, `YYYY-MM-DD` CR: `desdeFecha` del rango con grano `periodo`, el lunes
   * ISO con grano `semana`, la fecha del corte en `aging_por_estado`.
   */
  readonly fecha: string;
  /** Extremos INCLUSIVOS del cubo, `YYYY-MM-DD` CR. Con grano `periodo`, los del rango. */
  readonly desdeFecha: string;
  readonly hastaFecha: string;
  /** Dimension del desglose, YA seudonimizada si la politica lo exige (R15). */
  readonly dimension?: string;
  /** R1/R5 — SIEMPRE `number`, nunca `bigint`, nunca ausente. */
  readonly numerador: number;
  readonly denominador: number;
  /**
   * R4 — `numerador / denominador`, o `null` si `denominador === 0`. NUNCA `0` para decir
   * «no se sabe»: una tasa de cero es un dato real, y falso. Con el denominador a la vista
   * el consumidor SI distingue «no hubo gestiones» de «no hay dato», cosa que con el `null`
   * a secas de la 126 era el mismo pixel (D2).
   */
  readonly valor: number | null;
  /** R10/D4 — el cubo contiene el dia en curso. */
  readonly parcial?: true;
  /** ISO del corte usado. Solo con `parcial: true`. */
  readonly corteAt?: string;
}

/** R19/D6 — los DOS granos: todo el rango de una pieza, o un cubo por semana ISO. */
export type GranoAgregado = "periodo" | "semana";

export interface AgregadoOperativo {
  readonly metricaId: string;
  /** R12 — solo `porcentaje` o `segundos`. Un `conteo` no llega hasta aqui. */
  readonly unidad: MetricaUnidad;
  readonly unidadDeConteo: UnidadDeConteo;
  readonly grano: GranoAgregado;
  readonly rango: RangoResuelto;
  readonly cubos: readonly CuboAgregado[];
  /** R9 — OBLIGATORIO. Nunca `cobertura?`. Mismo tipo y mismo calculo que la 126. */
  readonly cobertura: Cobertura;
}

export type ResultadoAgregado =
  | { readonly status: "ok"; readonly datos: AgregadoOperativo }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> }
  | { readonly status: "forbidden" }
  | { readonly status: "unauthenticated" };

/**
 * R12 — las unidades que el modo agregado admite, declaradas UNA vez.
 *
 * El modo agregado existe para lo que NO es sumable. Servir aqui una metrica de `conteo`
 * —`ordenes_por_estado`, por ejemplo— sumaria un STOCK entre fechas, que R12 de la 126 y
 * el comentario de `db/schema.prisma:1886` prohiben expresamente: `analytics_daily` no
 * tiene forma de decir que esa columna no se suma.
 */
export const UNIDADES_AGREGABLES: readonly MetricaUnidad[] = ["porcentaje", "segundos"];

/** El mensaje del `validation_error` de R12. Se escribe una vez, y el borde lo reusa. */
export const ERROR_UNIDAD_NO_AGREGABLE =
  "el modo agregado solo aplica a metricas de porcentaje o segundos";

export function esUnidadAgregable(unidad: MetricaUnidad): boolean {
  return UNIDADES_AGREGABLES.includes(unidad);
}
