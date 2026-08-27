// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

import { CampoVariablePicker } from "@/app/(app)/configuracion/plantillas/_components/CampoVariablePicker";
import { CAMPOS_PLANTILLA } from "@/lib/types/plantilla-datos";

afterEach(() => {
  cleanup();
});

const CAMPOS_SIN_ALIAS = CAMPOS_PLANTILLA.filter((c) => c.aliasDe === undefined);
const MONTO = CAMPOS_PLANTILLA.find((c) => c.clave === "monto");
const CLIENTE = CAMPOS_PLANTILLA.find((c) => c.clave === "cliente");
const NOTAS = CAMPOS_PLANTILLA.find((c) => c.clave === "notas");
if (MONTO === undefined || CLIENTE === undefined || NOTAS === undefined) {
  throw new Error("Fixture inválido: el catálogo cambió las claves usadas por este test.");
}
// Precondición del test R9: `notas` es sensible y `cliente` no lo es, en el catálogo real.
if (NOTAS.sensible !== true || CLIENTE.sensible === true) {
  throw new Error(
    "R9 asume notas.sensible === true y cliente.sensible !== true; el catálogo cambió.",
  );
}

function abrirLista() {
  const combobox = screen.getByRole("combobox", { name: /campo/i });
  fireEvent.focus(combobox);
  return combobox;
}

describe("CampoVariablePicker", () => {
  it("R1: pinta el nombre y la descripción de cada opción", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    abrirLista();

    const opcionMonto = screen.getByRole("option", { name: new RegExp(MONTO.nombre) });
    expect(within(opcionMonto).getByText(MONTO.nombre)).toBeInTheDocument();
    expect(within(opcionMonto).getByText(MONTO.descripcion)).toBeInTheDocument();

    const opcionCliente = screen.getByRole("option", {
      name: new RegExp(CLIENTE.nombre),
    });
    expect(within(opcionCliente).getByText(CLIENTE.nombre)).toBeInTheDocument();
    expect(within(opcionCliente).getByText(CLIENTE.descripcion)).toBeInTheDocument();
  });

  it("R2: teclear una clave inventada + Enter no llama a onSeleccionar ni crea opción", () => {
    const onSeleccionar = vi.fn();
    render(<CampoVariablePicker onSeleccionar={onSeleccionar} />);
    const combobox = abrirLista();

    fireEvent.change(combobox, { target: { value: "sucursal" } });
    fireEvent.keyDown(combobox, { key: "Enter" });

    expect(onSeleccionar).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it('R3: filtro "monto" deja solo campos de monto; "GUIA" y "guía" dan el mismo conjunto', () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const combobox = abrirLista();

    fireEvent.change(combobox, { target: { value: "monto" } });
    const opcionesMonto = screen.getAllByRole("option").map((o) => o.id);
    expect(opcionesMonto.length).toBeGreaterThan(0);
    expect(
      opcionesMonto.every((id) => id.includes("monto") || id.includes("total")),
    ).toBe(true);

    fireEvent.change(combobox, { target: { value: "GUIA" } });
    const idsMayus = screen.getAllByRole("option").map((o) => o.id);

    fireEvent.change(combobox, { target: { value: "guía" } });
    const idsAcento = screen.getAllByRole("option").map((o) => o.id);

    expect(idsMayus.length).toBeGreaterThan(0);
    expect(idsAcento).toEqual(idsMayus);
  });

  it("R4: filtro vacío muestra todas las opciones del catálogo sin alias, en su orden", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    abrirLista();

    const opciones = screen.getAllByRole("option");
    expect(opciones).toHaveLength(CAMPOS_SIN_ALIAS.length);
    expect(opciones.map((o) => o.id)).toEqual(
      CAMPOS_SIN_ALIAS.map((c) => `campo-opcion-${c.clave}`),
    );

    const clavesExcluidas = ["num_guia", "nombre", "destinatario", "num_remision", "total"];
    for (const clave of clavesExcluidas) {
      expect(document.getElementById(`campo-opcion-${clave}`)).toBeNull();
    }
  });

  it('R6: filtro "zzz" no deja ninguna opción y muestra un aviso de vacío', () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const combobox = abrirLista();

    fireEvent.change(combobox, { target: { value: "zzz" } });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      screen.getByText(/ningún campo coincide con la búsqueda/i),
    ).toBeInTheDocument();
  });

  it('R7: elegir «Monto a cobrar» llama a onSeleccionar con "monto" una sola vez', () => {
    const onSeleccionar = vi.fn();
    render(<CampoVariablePicker onSeleccionar={onSeleccionar} />);
    const combobox = abrirLista();
    fireEvent.change(combobox, { target: { value: "Monto a cobrar" } });

    fireEvent.click(screen.getByRole("option", { name: new RegExp(MONTO.nombre) }));

    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    expect(onSeleccionar).toHaveBeenCalledWith("monto");
  });

  it("R8: tras elegir, el filtro queda vacío y la lista cierra (aria-expanded=false)", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const combobox = abrirLista() as HTMLInputElement;
    fireEvent.change(combobox, { target: { value: "monto" } });
    fireEvent.click(screen.getByRole("option", { name: new RegExp(MONTO.nombre) }));

    expect(combobox.value).toBe("");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
  });

  it("R9: la opción de notas trae el distintivo de sensible; la de cliente no", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    abrirLista();

    const opcionNotas = document.getElementById(`campo-opcion-${NOTAS.clave}`);
    const opcionCliente = document.getElementById(`campo-opcion-${CLIENTE.clave}`);
    expect(opcionNotas).not.toBeNull();
    expect(opcionCliente).not.toBeNull();

    expect(within(opcionNotas as HTMLElement).getByText(/dato sensible/i)).toBeInTheDocument();
    expect(
      within(opcionCliente as HTMLElement).queryByText(/dato sensible/i),
    ).not.toBeInTheDocument();
  });

  it("R29: ArrowDown/ArrowUp mueven aria-activedescendant, Enter selecciona la activa, Escape cierra", () => {
    const onSeleccionar = vi.fn();
    render(<CampoVariablePicker onSeleccionar={onSeleccionar} />);
    const combobox = abrirLista();

    const primeraId = `campo-opcion-${CAMPOS_SIN_ALIAS[0].clave}`;
    const segundaId = `campo-opcion-${CAMPOS_SIN_ALIAS[1].clave}`;

    expect(combobox).toHaveAttribute("aria-activedescendant", primeraId);

    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    expect(combobox).toHaveAttribute("aria-activedescendant", segundaId);

    fireEvent.keyDown(combobox, { key: "ArrowUp" });
    expect(combobox).toHaveAttribute("aria-activedescendant", primeraId);

    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(onSeleccionar).toHaveBeenCalledTimes(1);
    expect(onSeleccionar).toHaveBeenCalledWith(CAMPOS_SIN_ALIAS[0].clave);

    // Reabre para probar Escape.
    fireEvent.focus(combobox);
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(combobox, { key: "Escape" });
    expect(combobox).toHaveAttribute("aria-expanded", "false");
  });

  it("R30: el combobox se encuentra por nombre accesible, la lista es un listbox, y aria-activedescendant coincide con la opción activa", () => {
    render(<CampoVariablePicker onSeleccionar={vi.fn()} />);
    const combobox = screen.getByRole("combobox", { name: /campo/i });
    fireEvent.focus(combobox);

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();

    const activeId = combobox.getAttribute("aria-activedescendant");
    expect(activeId).not.toBeNull();
    const opcionActiva = document.getElementById(activeId as string);
    expect(opcionActiva).not.toBeNull();
    expect(opcionActiva).toHaveAttribute("role", "option");
    expect(opcionActiva).toHaveAttribute("aria-selected", "true");
  });
});
