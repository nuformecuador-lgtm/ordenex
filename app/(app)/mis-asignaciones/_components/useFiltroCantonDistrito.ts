"use client";

import { useCallback, useMemo, useState } from "react";

import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import {
  derivarCantones,
  derivarDistritos,
  filtrarAsignaciones,
  type OpcionFiltro,
} from "@/lib/utils/filtro-canton-distrito";

// Feature 117 — estado y orquestación del filtro cantón/distrito del portal del
// mensajero. Encapsula el estado encadenado (elegir cantón resetea distrito, R5), la
// derivación memoizada de opciones (R2/R4/R13) y el helper `aplicar` que envuelve la
// lógica pura. 100% cliente, sin fetch ni Server Actions (R12).

export interface UseFiltroCantonDistrito {
  /** Cantón elegido; `""` = "todos" (sin filtro de cantón). */
  canton: string;
  /** Distrito elegido; `""` = "todos" (sin filtro de distrito). */
  distrito: string;
  /** R2/R13: opciones de cantón derivadas del conjunto COMPLETO cargado. */
  cantones: OpcionFiltro[];
  /** R3/R4: opciones de distrito del cantón elegido; `[]` mientras no haya cantón. */
  distritos: OpcionFiltro[];
  /** R5: fija el cantón y resetea el distrito a "todos". */
  setCantonYReset: (value: string) => void;
  /** Fija el distrito (solo tiene efecto con un cantón elegido). */
  setDistrito: (value: string) => void;
  /** R9: `true` si hay al menos un filtro activo (cantón o distrito). */
  hayFiltro: boolean;
  /** R8: limpia AMBOS selects a la vez. */
  limpiar: () => void;
  /** R6/R7: aplica el filtro combinado a una lista, preservando su orden. */
  aplicar: (lista: MiAsignacionDTO[]) => MiAsignacionDTO[];
}

/**
 * Hook del filtro cantón/distrito. `ordenes` es la UNIÓN de los grupos cargados
 * (`porRecoger` + `porGestionar`), de la que se derivan las opciones (R13: conjunto
 * completo, no filtrado). El llamador memoiza esa unión para estabilizar las opciones.
 */
export function useFiltroCantonDistrito(
  ordenes: MiAsignacionDTO[],
): UseFiltroCantonDistrito {
  const [canton, setCanton] = useState("");
  const [distrito, setDistrito] = useState("");

  const cantones = useMemo(() => derivarCantones(ordenes), [ordenes]);
  const distritos = useMemo(
    () => (canton ? derivarDistritos(ordenes, canton) : []),
    [ordenes, canton],
  );

  const setCantonYReset = useCallback((value: string) => {
    setCanton(value);
    setDistrito(""); // R5: cambiar de cantón limpia el distrito.
  }, []);

  const limpiar = useCallback(() => {
    setCanton("");
    setDistrito("");
  }, []);

  const aplicar = useCallback(
    (lista: MiAsignacionDTO[]) =>
      filtrarAsignaciones(lista, { canton, distrito }),
    [canton, distrito],
  );

  const hayFiltro = canton !== "" || distrito !== "";

  return {
    canton,
    distrito,
    cantones,
    distritos,
    setCantonYReset,
    setDistrito,
    hayFiltro,
    limpiar,
    aplicar,
  };
}
