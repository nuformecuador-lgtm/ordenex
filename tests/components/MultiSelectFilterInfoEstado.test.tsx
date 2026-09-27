// @vitest-environment jsdom
// FICHA 456 (T3.11, design §4.4/§8; R13, R31, R34) — el filtro de estado: cada opción con
// `codigoEstado` lleva su botón de información como HERMANO; pulsarlo, o pulsar y usar Escape dentro
// de la explicación, no marca ni desmarca, no cambia el filtro y no cierra el panel. El filtro
// aplicado con UN estado lleva su botón junto a la X; con varios, ninguno.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MultiSelectFilter } from "@/components/shared/MultiSelectFilter";
import { opcionesEstado } from "@/app/(app)/ordenes/_components/filtro-estado-def";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { textoAprobadoDe } from "../fixtures/textos-aprobados-456";

afterEach(() => cleanup());

const CATALOGO = ORDER_STATUS_SEED.map((value, i) => ({ id: `id-${i}`, value }));
const OPCIONES = opcionesEstado(CATALOGO, { valor: "value" });

function pintar(value: string[] = [], onChange = vi.fn()) {
  render(<MultiSelectFilter label="Estado" options={OPCIONES} value={value} onChange={onChange} />);
  return onChange;
}

const abrirPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /^Estado: / }));
  return screen.getByRole("listbox", { name: "Estado" });
};

describe("456 · filtro de estado — opciones (R13, R31, R34)", () => {
  it("R34 — mismas opciones, mismos nombres y mismo orden (el botón no es una opción)", async () => {
    const user = userEvent.setup();
    pintar();
    const lista = await abrirPanel(user);
    const opciones = within(lista)
      .getAllByRole("option")
      .filter((o) => o.getAttribute("data-todos") !== "true")
      .map((o) => o.textContent?.trim());
    expect(opciones).toEqual(OPCIONES.map((o) => o.label));
    expect(OPCIONES.every((o) => o.codigoEstado !== undefined)).toBe(true);
  });

  it("R13 — cada opción de estado lleva su botón, como hermano (no dentro de la opción)", async () => {
    const user = userEvent.setup();
    pintar();
    const lista = await abrirPanel(user);
    for (const o of OPCIONES) {
      const b = within(lista).getByRole("button", { name: `Qué significa «${o.label}»` });
      expect(b.closest('[role="option"]')).toBeNull();
    }
  });

  it("R31 — pulsar el botón no marca, no llama a onChange y no cierra el panel; la explicación es la aprobada", async () => {
    const user = userEvent.setup();
    const onChange = pintar();
    const lista = await abrirPanel(user);
    await user.click(within(lista).getByRole("button", { name: "Qué significa «Novedad»" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveAccessibleDescription(textoAprobadoDe("Novedad"));
    expect(onChange).not.toHaveBeenCalled();
    expect(within(lista).getByRole("option", { name: "Novedad" })).toHaveAttribute("aria-selected", "false");
    // Pulsar DENTRO de la explicación (portaleada fuera del panel) tampoco cierra el panel.
    await user.click(within(dlg).getByText(textoAprobadoDe("Novedad")));
    expect(screen.getByRole("listbox", { name: "Estado" })).toBeTruthy();
    // Escape cierra SOLO la explicación.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("listbox", { name: "Estado" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    // Y la opción sigue marcando como siempre.
    await user.click(within(lista).getByRole("option", { name: "Novedad" }));
    expect(onChange).toHaveBeenCalledWith(["novedad"]);
  });

  it("una opción sin `codigoEstado` no lleva botón (el filtro genérico no cambia)", async () => {
    const user = userEvent.setup();
    render(<MultiSelectFilter label="Zona" options={[{ value: "a", label: "GAM" }]} value={[]} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^Zona: / }));
    expect(screen.queryByRole("button", { name: /Qué significa/ })).toBeNull();
  });
});

describe("456 · filtro de estado — filtro aplicado (R13)", () => {
  it("con UN estado: botón junto a la X, y la X sigue limpiando", async () => {
    const user = userEvent.setup();
    const onChange = pintar(["entregado"]);
    expect(screen.getByRole("button", { name: "Estado: Entregado" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Qué significa «Entregado»" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Entregado");
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Limpiar Estado" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("con VARIOS estados: «N seleccionados» y ningún botón de información", () => {
    pintar(["entregado", "novedad"]);
    expect(screen.getByRole("button", { name: "Estado: 2 seleccionados" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Qué significa/ })).toBeNull();
  });
});
