"use client";

import useSWR from "swr";

import { conceptosConMovimientosAction } from "@/lib/actions/wallet-filtros";
import type { z } from "zod";

import type {
  ConceptoConMovimientosDTO,
  conceptosConMovimientosSchema,
} from "@/lib/types/wallet-filtros";

// Ficha 458-A (TA.3, R13–R15) — la lectura de los conceptos con movimientos para un filtro de la
// wallet, por Server Action (lectura interna del mismo proyecto, nunca `fetch` a `/api`). La clave SWR
// lleva el input entero: cambiar el periodo, el tipo, la tienda o el cierre vuelve a contar.

/** Prefijo de la clave SWR de esta lectura. */
export const CLAVE_CONCEPTOS = "wallet-filtros:conceptos";

export interface ConceptosConMovimientos {
  conceptos: ConceptoConMovimientosDTO[] | undefined;
  cargando: boolean;
  error: boolean;
}

/** Quita las claves vacias: `""` no es «sin filtro» para el borde, es un `validation_error`. */
function sinVacios<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== "" && v !== undefined)) as T;
}

/** Lo que el borde RECIBE (dias `YYYY-MM-DD`), no lo que el schema produce. */
export type ConceptosFiltroInput = z.input<typeof conceptosConMovimientosSchema>;

export function useConceptosConMovimientos(
  input: ConceptosFiltroInput,
): ConceptosConMovimientos {
  const limpio = sinVacios(input);
  const { data, error, isLoading } = useSWR([CLAVE_CONCEPTOS, JSON.stringify(limpio)], async () => {
    const r = await conceptosConMovimientosAction(limpio);
    if (r.status !== "ok") throw new Error(r.status);
    return r.conceptos;
  });
  return { conceptos: data, cargando: isLoading, error: Boolean(error) };
}
