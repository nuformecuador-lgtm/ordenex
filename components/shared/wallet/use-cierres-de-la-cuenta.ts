"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";

import type {
  SelectorBuscableEstado,
  SelectorBuscableOpcion,
} from "@/components/shared/SelectorBuscable";
import { cierresDeLaCuentaAction } from "@/lib/actions/wallet-filtros";
import type { CierresDeLaCuentaInput } from "@/lib/types/wallet-filtros";

import { opcionesDeCierreDeCuenta } from "./cierres-selector";

// Ficha 458-A (TA.4, R10–R12) — la lectura del selector de cierre de UNA cuenta, por Server Action.
// PEREZOSA: no se lee nada hasta que alguien abre el selector (`buscar("")`), asi desplegar una
// fila del listado sigue costando solo su desglose. Cada busqueda es su propia clave SWR.

/** Prefijo de la clave SWR de esta lectura. */
export const CLAVE_CIERRES = "wallet-filtros:cierres";

/** La cuenta cuyo selector se llena: la misma forma que el borde (`busqueda` la pone el hook). */
export type CuentaDelSelector = CierresDeLaCuentaInput;

export interface CierresDeLaCuenta {
  opciones: SelectorBuscableOpcion[];
  estado: SelectorBuscableEstado;
  hayMas: boolean;
  buscar: (texto: string) => void;
}

export function useCierresDeLaCuenta(cuenta: CuentaDelSelector): CierresDeLaCuenta {
  /** `null` = el selector aun no se abrio: no se lee. */
  const [busqueda, setBusqueda] = useState<string | null>(null);
  const clave = busqueda === null ? null : [CLAVE_CIERRES, JSON.stringify(cuenta), busqueda];
  const { data, error, isLoading } = useSWR(clave, async () => {
    const input = busqueda ? { ...cuenta, busqueda } : cuenta;
    const r = await cierresDeLaCuentaAction(input);
    if (r.status !== "ok") throw new Error(r.status);
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
    opciones: data ? opcionesDeCierreDeCuenta(data.opciones) : [],
    estado,
    hayMas: data?.hayMas ?? false,
    buscar,
  };
}
