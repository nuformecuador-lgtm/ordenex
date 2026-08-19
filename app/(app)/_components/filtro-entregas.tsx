"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import {
  FILTRO_ENTREGAS_INICIAL,
  type RawFiltroConteoEntregas,
} from "./entregas-filtro-analitica";

/**
 * El filtro de la seccion ENTREGAS, compartido entre quien lo teclea (`FiltrosEntregas`) y
 * quien lo consulta (el anillo de conteo, y manana el resto de la seccion).
 *
 * Por que un contexto y no la URL, que es lo que usa el tablero operativo
 * (`operativo/filtro-tablero.ts`): esta pagina monta DOS barras con dos alcances distintos
 * —la de entregas y `FiltrosOperativos`— y las dos escribirian los mismos parametros
 * (`rango`, `zona`, `tienda`, `mensajero`). Compartir la URL las funde sin haberlo decidido:
 * mover el rango de una moveria la otra. Fundirlas es una decision aparte; mientras no se
 * tome, cada barra manda sobre lo suyo.
 *
 * Sin proveedor el contexto vale «sin filtrar» (el preset inicial y nada mas), igual que
 * `filtro-secciones`: una seccion montada fuera del proveedor —otra pantalla, un test— pide
 * su cifra por defecto en vez de romperse.
 */
interface FiltroEntregasValor {
  readonly filtro: RawFiltroConteoEntregas;
  readonly setFiltro: (filtro: RawFiltroConteoEntregas) => void;
}

const SIN_PROVEEDOR: FiltroEntregasValor = {
  filtro: FILTRO_ENTREGAS_INICIAL,
  setFiltro: () => {},
};

const FiltroEntregasContexto = createContext<FiltroEntregasValor>(SIN_PROVEEDOR);

export function useFiltroEntregas(): FiltroEntregasValor {
  return useContext(FiltroEntregasContexto);
}

/**
 * Dueño del filtro de entregas. Envuelve el arbol ENTERO, no solo la barra: quien filtra y
 * quien consulta cuelgan de slots hermanos del shell, asi que un proveedor pegado a la barra
 * no seria ancestro de nadie a quien filtrar.
 */
export function FiltroEntregasProvider({ children }: { readonly children: ReactNode }) {
  const [filtro, setFiltro] = useState<RawFiltroConteoEntregas>(FILTRO_ENTREGAS_INICIAL);

  const valor = useMemo<FiltroEntregasValor>(() => ({ filtro, setFiltro }), [filtro]);

  return (
    <FiltroEntregasContexto.Provider value={valor}>{children}</FiltroEntregasContexto.Provider>
  );
}
