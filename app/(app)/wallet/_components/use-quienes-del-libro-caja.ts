"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";

import type {
  SelectorBuscableEstado,
  SelectorBuscableOpcion,
} from "@/components/shared/SelectorBuscable";
import { quienesDelLibroCajaAction } from "@/lib/actions/wallet-filtros";
import type { WalletMovimientoTipo } from "@/lib/types/wallet";

import { opcionesDeAQuien } from "./a-quien-selector";

// FICHA 458-E (TE.2, R59) — la lectura del selector «A quién» del libro de la caja, por Server Action
// (lectura interna del mismo proyecto, nunca `fetch` a `/api`). PEREZOSA, como la del cierre (458-A):
// nada se lee hasta que alguien abre el selector (`buscar("")`). La clave SWR lleva el contexto
// (dirección y periodo del borrador) y la búsqueda: cambiar cualquiera vuelve a leer.

/** Prefijo de la clave SWR de esta lectura. */
export const CLAVE_QUIENES = "wallet-filtros:quienes-caja";

/** El contexto de las opciones: la dirección y el periodo que se están eligiendo. */
export interface ContextoQuienes {
  tipo?: WalletMovimientoTipo;
  desde?: string;
  hasta?: string;
}

export interface QuienesDelLibroCaja {
  opciones: SelectorBuscableOpcion[];
  estado: SelectorBuscableEstado;
  hayMas: boolean;
  buscar: (texto: string) => void;
}

/** Sin claves vacías: `""` no es «sin filtro» para el borde, es un `validation_error`. */
function sinVacios(contexto: ContextoQuienes): ContextoQuienes {
  return Object.fromEntries(
    Object.entries(contexto).filter(([, v]) => v !== "" && v !== undefined),
  ) as ContextoQuienes;
}

export function useQuienesDelLibroCaja(contexto: ContextoQuienes): QuienesDelLibroCaja {
  /** `null` = el selector aún no se abrió: no se lee. */
  const [busqueda, setBusqueda] = useState<string | null>(null);
  const limpio = sinVacios(contexto);
  const clave = busqueda === null ? null : [CLAVE_QUIENES, JSON.stringify(limpio), busqueda];
  const { data, error, isLoading } = useSWR(clave, async () => {
    const r = await quienesDelLibroCajaAction(busqueda ? { ...limpio, busqueda } : limpio);
    if (r.status !== "ok") throw new Error(`quienes del libro de la caja: ${r.status}`);
    return r;
  });
  const buscar = useCallback((texto: string) => setBusqueda(texto), []);

  const estado: SelectorBuscableEstado = error
    ? "error"
    : isLoading || data === undefined
      ? "cargando"
      : data.opciones.length === 0
        ? "vacio"
        : "listo";
  return {
    opciones: data ? opcionesDeAQuien(data.opciones) : [],
    estado,
    hayMas: data?.hayMas ?? false,
    buscar,
  };
}
