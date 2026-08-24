// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Select, type SelectOption } from "@/components/ui/select";

afterEach(() => {
  cleanup();
});

const OPTIONS: SelectOption[] = [
  { value: "m1", label: "Ana Mensajera" },
  { value: "m2", label: "Beto Mensajero" },
];

/** Renderiza un `Select` controlado, con `onValueChange` capturado por spy. */
function renderSelect(overrides: Partial<Parameters<typeof Select>[0]> = {}) {
  const onValueChange = vi.fn();
  const utils = render(
    <Select
      value=""
      onValueChange={onValueChange}
      options={OPTIONS}
      aria-label="Mensajero"
      {...overrides}
    />,
  );
  return { onValueChange, ...utils };
}

// ---------------------------------------------------------------------------
// R32 — Accesible: rol/nombre accesible
// ---------------------------------------------------------------------------
describe("Select — accesible (R32)", () => {
  it("expone rol combobox con nombre accesible", () => {
    renderSelect();
    expect(
      screen.getByRole("combobox", { name: "Mensajero" }),
    ).toBeInTheDocument();
  });

  it("muestra el placeholder cuando no hay valor seleccionado", () => {
    renderSelect({ placeholder: "Elige un mensajero" });
    expect(screen.getByText("Elige un mensajero")).toBeInTheDocument();
  });

  it("deshabilitado: el trigger queda inhabilitado", () => {
    renderSelect({ disabled: true });
    const trigger = screen.getByRole("combobox", { name: "Mensajero" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("tabindex", "-1");
  });
});

// ---------------------------------------------------------------------------
// R32 — Abre la lista y selecciona una opción emitiendo onValueChange
// ---------------------------------------------------------------------------
describe("Select — abre y selecciona por mouse (R32)", () => {
  it("clic en el trigger abre la lista de opciones", async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.click(screen.getByRole("combobox", { name: "Mensajero" }));

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ana Mensajera" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beto Mensajero" })).toBeInTheDocument();
  });

  it("clic en una opción emite onValueChange con su value", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderSelect();

    await user.click(screen.getByRole("combobox", { name: "Mensajero" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Beto Mensajero" }));

    expect(onValueChange).toHaveBeenCalledWith("m2");
  });
});

// ---------------------------------------------------------------------------
// R32 — Operable por teclado
// ---------------------------------------------------------------------------
describe("Select — operable por teclado (R32)", () => {
  it("Enter abre la lista con la primera opción resaltada y Enter la selecciona", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderSelect();

    const trigger = screen.getByRole("combobox", { name: "Mensajero" });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(onValueChange).toHaveBeenCalledWith("m1");
  });

  it("Enter abre la lista y ArrowDown+Enter selecciona la segunda opción", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderSelect();

    const trigger = screen.getByRole("combobox", { name: "Mensajero" });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(onValueChange).toHaveBeenCalledWith("m2");
  });
});

// ---------------------------------------------------------------------------
// Valor controlado refleja el label seleccionado
// ---------------------------------------------------------------------------
describe("Select — valor controlado", () => {
  it("con value='m2' el trigger muestra el label correspondiente", () => {
    renderSelect({ value: "m2" });
    expect(screen.getByText("Beto Mensajero")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Agrupación: el `group` de cada opción se renderiza como encabezado, que es lo
// que diferencia opciones de distinta procedencia (adminTienda vs API key).
// ---------------------------------------------------------------------------
describe("Select — grupos", () => {
  const AGRUPADAS: SelectOption[] = [
    { value: "t1", label: "Tienda Uno", group: "Administradores de tienda" },
    { value: "k1", label: "Integración Shopify", group: "API keys" },
  ];

  it("muestra un encabezado por grupo junto a sus opciones", async () => {
    const user = userEvent.setup();
    renderSelect({ options: AGRUPADAS });

    await user.click(screen.getByRole("combobox", { name: "Mensajero" }));
    const lista = await screen.findByRole("listbox");

    // Los dos encabezados están presentes...
    expect(within(lista).getByText("Administradores de tienda")).toBeInTheDocument();
    expect(within(lista).getByText("API keys")).toBeInTheDocument();
    // ...y cada grupo contiene su propia opción, no la del otro.
    const grupos = within(lista).getAllByRole("group");
    expect(grupos).toHaveLength(2);
    expect(within(grupos[0]).getByText("Tienda Uno")).toBeInTheDocument();
    expect(within(grupos[1]).getByText("Integración Shopify")).toBeInTheDocument();
  });

  it("seleccionar dentro de un grupo emite el value de esa opción", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderSelect({ options: AGRUPADAS });

    await user.click(screen.getByRole("combobox", { name: "Mensajero" }));
    await user.click(await screen.findByRole("option", { name: /Integración Shopify/ }));

    expect(onValueChange).toHaveBeenCalledWith("k1");
  });

  it("sin `group` no se renderiza ningún encabezado (lista plana de siempre)", async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.click(screen.getByRole("combobox", { name: "Mensajero" }));
    const lista = await screen.findByRole("listbox");

    expect(within(lista).queryAllByRole("group")).toHaveLength(0);
    expect(within(lista).getAllByRole("option")).toHaveLength(2);
  });
});
