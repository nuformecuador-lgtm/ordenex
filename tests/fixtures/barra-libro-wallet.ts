import { screen, waitFor, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { expect } from "vitest";

// FICHA 467 — cómo se maneja la BARRA ÚNICA del libro de las wallets (la caja y los estados de cuenta)
// desde un test: cada filtro se PIDE en el selector «Filtros» (una casilla) y su control se monta en la
// barra, como en `/ordenes`. Los tests de otras fichas que antes pulsaban un conmutador a la vista
// («Sale», un chip) o abrían la tarjeta de arriba pasan por aquí: cambia el LOCALIZADOR, no el contrato.

type Usuario = ReturnType<typeof userEvent.setup>;

/** El botón que abre el selector de casillas de la barra de `contenedor` («Filtros» o «Filtros (n)»). */
export function botonFiltros(contenedor: HTMLElement): HTMLElement {
  return within(contenedor).getByRole("button", { name: /^Filtros/ });
}

/** Alterna (marca o desmarca) las casillas `etiquetas` del selector «Filtros» y lo cierra. */
export async function alternarCasillas(user: Usuario, contenedor: HTMLElement, ...etiquetas: string[]) {
  await user.click(botonFiltros(contenedor));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  for (const etiqueta of etiquetas) {
    await user.click(within(selector).getByRole("option", { name: etiqueta }));
  }
  // Marcar NO cierra el selector (se piden varios del tirón); se cierra a mano para que su panel no
  // tape los controles recién montados.
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull());
}

/** Marca las casillas que aún no estén marcadas (las ya marcadas no se tocan). */
export async function ponerCasillas(user: Usuario, contenedor: HTMLElement, ...etiquetas: string[]) {
  await user.click(botonFiltros(contenedor));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  for (const etiqueta of etiquetas) {
    const opcion = within(selector).getByRole("option", { name: etiqueta });
    if (opcion.getAttribute("aria-selected") !== "true") await user.click(opcion);
  }
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull());
}

/** Las etiquetas de las casillas que ofrece «Filtros», en su orden, y cuáles están marcadas. */
export async function casillasOfrecidas(
  user: Usuario,
  contenedor: HTMLElement,
): Promise<{ etiquetas: string[]; marcadas: string[] }> {
  await user.click(botonFiltros(contenedor));
  const selector = await screen.findByRole("listbox", { name: "Filtros" });
  const opciones = within(selector).getAllByRole("option");
  const etiquetas = opciones.map((o) => o.textContent ?? "");
  const marcadas = opciones.filter((o) => o.getAttribute("aria-selected") === "true").map((o) => o.textContent ?? "");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox", { name: "Filtros" })).toBeNull());
  return { etiquetas, marcadas };
}

/**
 * Elige `opcion` en el `single` de la barra cuyo nombre es `nombre` («Entra/Sale», «Concepto», «Tipo de
 * movimiento»), marcando antes su casilla si hace falta.
 */
export async function elegirEnBarra(user: Usuario, contenedor: HTMLElement, nombre: string, opcion: string) {
  if (within(contenedor).queryByRole("combobox", { name: nombre }) === null) {
    await ponerCasillas(user, contenedor, nombre);
  }
  await user.click(within(contenedor).getByRole("combobox", { name: nombre }));
  await user.click(await screen.findByRole("option", { name: opcion }));
}

/**
 * Las opciones del `single` `nombre` de la barra (marcando antes su casilla si hace falta), en su
 * orden. Cierra la lista con Escape.
 */
export async function opcionesDelControl(user: Usuario, contenedor: HTMLElement, nombre: string): Promise<string[]> {
  if (within(contenedor).queryByRole("combobox", { name: nombre }) === null) {
    await ponerCasillas(user, contenedor, nombre);
  }
  await user.click(within(contenedor).getByRole("combobox", { name: nombre }));
  const lista = await screen.findByRole("listbox");
  const opciones = within(lista)
    .getAllByRole("option")
    .map((o) => o.textContent?.trim() ?? "");
  await user.keyboard("{Escape}");
  return opciones;
}

/** Lo que dice el disparador del `single` `nombre`, o `null` si su casilla no está marcada. */
export function textoDelControl(contenedor: HTMLElement, nombre: string): string | null {
  return within(contenedor).queryByRole("combobox", { name: nombre })?.textContent ?? null;
}
