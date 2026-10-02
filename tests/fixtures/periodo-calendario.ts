import { screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

// FICHA 463 — el periodo de la ZONA DE LA WALLET es el `dateRange` de `FilterComponent` (un calendario
// en un popover) en modo «Aplicar». El calendario abre en el MES ACTUAL (no se le pasa `defaultMonth`),
// así que los días se eligen en ese mes y la fecha esperada se deriva de él: los días 1 y 28 existen
// siempre. Mismo criterio que `tests/unit/components/filter-component.test.tsx`.

type Usuario = ReturnType<typeof userEvent.setup>;

const HOY = new Date();

/** `YYYY-MM-DD` del día `dia` del mes actual (fecha local, como la emite el calendario). */
export function diaDelMesActual(dia: number): string {
  const mes = String(HOY.getMonth() + 1).padStart(2, "0");
  return `${HOY.getFullYear()}-${mes}-${String(dia).padStart(2, "0")}`;
}

/** Elige en el calendario del periodo de `zona` el rango `[desde, hasta]` (días del mes actual). */
export async function elegirPeriodo(user: Usuario, zona: HTMLElement, desde: number, hasta: number) {
  if (screen.queryAllByRole("grid").length === 0) {
    await user.click(within(zona).getByRole("button", { name: "Periodo" }));
  }
  const cuadriculas = await screen.findAllByRole("grid");
  await user.click(within(cuadriculas[0]).getByText(String(desde)));
  await user.click(within(cuadriculas[0]).getByText(String(hasta)));
  // El popover se cierra con Escape: el foco vuelve a la barra, como al terminar de elegir.
  await user.keyboard("{Escape}");
}

/** Elige el periodo y pulsa «Aplicar» de la zona. */
export async function aplicarPeriodo(user: Usuario, zona: HTMLElement, desde: number, hasta: number) {
  await elegirPeriodo(user, zona, desde, hasta);
  await user.click(within(zona).getByRole("button", { name: "Aplicar" }));
}
