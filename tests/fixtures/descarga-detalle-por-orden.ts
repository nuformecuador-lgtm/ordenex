import { screen, waitFor } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { expect } from "vitest";

/**
 * Ficha 464 — el selector de la descarga de una superficie CON hoja de detalle arranca en
 * «Movimientos y detalle por orden» (R8). Las pruebas de antes de la 464 miden la descarga de SIEMPRE
 * (una hoja, la acción del completo de siempre), que ahora es la opción «Solo los movimientos» (R9):
 * este ayudante la elige y cierra el selector, sin descargar nada.
 *
 * Los textos se escriben A MANO: son el contrato visible (R6), no se leen de la fuente.
 */
export const DISPARADOR_DETALLE = "Elegir qué se descarga y sus columnas";
export const OPCION_SOLO_MOVIMIENTOS = "Solo los movimientos · una hoja";
/** Ficha 468 (R24) — la hoja 2 pasa a llamarse «Detalle por guía». */
export const OPCION_CON_DETALLE = "Movimientos y detalle por guía · dos hojas";
export const GRUPO_HOJAS = "Hojas del archivo";
export const GRUPO_COLUMNAS_DE_LA_HOJA = "Columnas de la hoja";

type Usuario = ReturnType<typeof userEvent.setup>;

export async function abrirSelectorDetalle(user: Usuario): Promise<void> {
  await user.click(screen.getByRole("button", { name: DISPARADOR_DETALLE }));
  await screen.findByRole("radiogroup", { name: GRUPO_HOJAS });
}

export async function cerrarSelectorDetalle(user: Usuario): Promise<void> {
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("radiogroup", { name: GRUPO_HOJAS })).toBeNull());
}

/** Elige «Solo los movimientos» y cierra el selector. */
export async function elegirSoloLosMovimientos(user: Usuario): Promise<void> {
  await abrirSelectorDetalle(user);
  await user.click(screen.getByRole("radio", { name: OPCION_SOLO_MOVIMIENTOS }));
  await cerrarSelectorDetalle(user);
}
