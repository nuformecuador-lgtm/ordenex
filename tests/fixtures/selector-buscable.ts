// Ficha 458-A (TA.4) — elegir una opcion de un `SelectorBuscable` desde un test, como lo hace una
// persona: abrir el disparador, esperar la lista y pulsar la opcion por su ROTULO (nunca por su valor).
import { fireEvent, screen, within } from "@testing-library/react";

import type { CierresDeLaCuentaResult } from "@/lib/types/wallet-filtros";

export async function elegirEnSelector(disparador: HTMLElement, opcion: string | RegExp): Promise<void> {
  fireEvent.click(disparador);
  const lista = await screen.findByRole("listbox");
  fireEvent.click(await within(lista).findByRole("option", { name: opcion }));
}

/** Lo que devuelve `cierresDeLaCuentaAction` en los tests de las pantallas: UN cierre, `c1`. */
export const CIERRES_C1: CierresDeLaCuentaResult = {
  status: "ok",
  opciones: [{ cierreId: "c1", dia: "2026-07-12", hora: "08:00", mensajero: "Juan Pérez Mora", movimientos: 3 }],
  hayMas: false,
};

/** El rotulo con que el selector ofrece el cierre `c1` de `CIERRES_C1`. */
export const ROTULO_C1 = "Cierre del 2026-07-12 · Juan Pérez Mora · 3 movimientos";

/** Elige el cierre `c1` en el selector cuyo disparador se pasa. */
export function elegirCierreC1(disparador: HTMLElement): Promise<void> {
  return elegirEnSelector(disparador, ROTULO_C1);
}
