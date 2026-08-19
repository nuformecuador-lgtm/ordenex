// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  MultiSelectFilter,
  type MultiSelectOption,
} from "@/components/shared/MultiSelectFilter";

// Feature 144 / TA.2 (R28, R29, R65) — agrupado de opciones en `MultiSelectFilter`.
// BLOQUE A: sin dominio. Las opciones son de FANTASIA (colores y acabados); el
// control no sabe que significa un grupo, solo lo pinta con su cabecera accesible.

const PLANAS: MultiSelectOption[] = [
  { value: "rojo", label: "Rojo" },
  { value: "azul", label: "Azul" },
];

const AGRUPADAS: MultiSelectOption[] = [
  { value: "rojo", label: "Rojo", group: "Calidos" },
  { value: "naranja", label: "Naranja", group: "Calidos" },
  { value: "azul", label: "Azul", group: "Frios" },
];

async function abrir(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Color:/ }));
  return screen.getByRole("listbox", { name: "Color" });
}

afterEach(() => cleanup());

describe("MultiSelectFilter — agrupado de opciones (R28)", () => {
  it("R28: MIENTRAS ninguna opcion declare grupo, la lista es PLANA (sin cabeceras)", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter
        label="Color"
        options={PLANAS}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    const lista = await abrir(user);

    expect(within(lista).queryAllByRole("group")).toHaveLength(0);
    // "Todos" encabeza la lista (pedido humano 2026-08-19) y no pertenece a ningun grupo.
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos",
      "Rojo",
      "Azul",
    ]);
  });

  it("R28: con grupos, cada opcion se presenta bajo la cabecera de SU grupo", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    const lista = await abrir(user);

    const calidos = within(lista).getByRole("group", { name: "Calidos" });
    const frios = within(lista).getByRole("group", { name: "Frios" });
    expect(within(calidos).getAllByRole("option").map((o) => o.textContent)).toEqual(
      ["Rojo", "Naranja"],
    );
    expect(within(frios).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Azul",
    ]);
  });

  it("R28: el nombre del grupo queda expuesto de forma accesible", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    const lista = await abrir(user);

    expect(
      within(lista)
        .getAllByRole("group")
        .map((g) => g.getAttribute("aria-label")),
    ).toEqual(["Calidos", "Frios"]);
  });

  it("R28: se preserva el ORDEN DE APARICION de los grupos, aunque las opciones vengan intercaladas", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter
        label="Color"
        options={[
          { value: "azul", label: "Azul", group: "Frios" },
          { value: "rojo", label: "Rojo", group: "Calidos" },
          { value: "celeste", label: "Celeste", group: "Frios" },
        ]}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    const lista = await abrir(user);

    expect(
      within(lista)
        .getAllByRole("group")
        .map((g) => g.getAttribute("aria-label")),
    ).toEqual(["Frios", "Calidos"]);
    // Todas las opciones siguen presentes y en el orden declarado dentro de su grupo.
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos",
      "Azul",
      "Celeste",
      "Rojo",
    ]);
  });

  it("R29: dentro de los grupos, cada opcion conserva `aria-selected` legible", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={["naranja"]}
        onChange={vi.fn()}
      />,
    );
    const lista = await abrir(user);

    expect(
      within(lista).getByRole("option", { name: "Naranja" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(within(lista).getByRole("option", { name: "Rojo" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("R28: marcar una opcion agrupada emite su valor igual que en la lista plana", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={[]}
        onChange={onChange}
      />,
    );
    const lista = await abrir(user);

    await user.click(within(lista).getByRole("option", { name: "Azul" }));
    expect(onChange).toHaveBeenCalledWith(["azul"]);
  });

  it("R28: el buscador interno sigue acotando y los grupos vacios desaparecen", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    const lista = await abrir(user);

    await user.type(screen.getByLabelText("Buscar en Color"), "azul");
    expect(
      within(lista)
        .getAllByRole("group")
        .map((g) => g.getAttribute("aria-label")),
    ).toEqual(["Frios"]);
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos",
      "Azul",
    ]);
  });

  it("R28: las opciones SIN grupo conviven con las agrupadas, sin cabecera propia", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter
        label="Color"
        options={[
          { value: "suelto", label: "Suelto" },
          { value: "rojo", label: "Rojo", group: "Calidos" },
        ]}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    const lista = await abrir(user);

    expect(within(lista).getAllByRole("group")).toHaveLength(1);
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos",
      "Suelto",
      "Rojo",
    ]);
  });
});

// Pedido humano del 2026-08-19 — la opcion "Todos" que marca y desmarca de una vez.
// Lo que se afirma no es el boton, es la REGLA: actua sobre lo que se esta viendo y
// no toca lo marcado que el buscador dejo fuera.
describe("MultiSelectFilter — opcion 'Todos' (pedido humano 2026-08-19)", () => {
  it("sin nada marcado, 'Todos' emite TODOS los valores", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={[]}
        onChange={onChange}
      />,
    );
    const lista = await abrir(user);

    await user.click(within(lista).getByRole("option", { name: "Todos" }));
    expect(onChange).toHaveBeenCalledWith(["rojo", "naranja", "azul"]);
  });

  it("con TODAS marcadas, 'Todos' aparece seleccionado y el clic las desmarca", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={["rojo", "naranja", "azul"]}
        onChange={onChange}
      />,
    );
    const lista = await abrir(user);

    const todos = within(lista).getByRole("option", { name: "Todos" });
    expect(todos).toHaveAttribute("aria-selected", "true");
    await user.click(todos);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("con ALGUNAS marcadas NO figura como seleccionado, y el clic completa la seleccion", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={["azul"]}
        onChange={onChange}
      />,
    );
    const lista = await abrir(user);

    const todos = within(lista).getByRole("option", { name: "Todos" });
    // Parcial NO es "todas": anunciarlo como marcado haria que el clic siguiente
    // desmarcara cuando el usuario espera lo contrario.
    expect(todos).toHaveAttribute("aria-selected", "false");
    await user.click(todos);
    expect(onChange).toHaveBeenCalledWith(["azul", "rojo", "naranja"]);
  });

  it("con el buscador puesto, 'Todos' solo alcanza lo VISIBLE y respeta el resto", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={["rojo"]}
        onChange={onChange}
      />,
    );
    const lista = await abrir(user);

    await user.type(screen.getByLabelText("Buscar en Color"), "azul");
    await user.click(within(lista).getByRole("option", { name: "Todos" }));
    // "rojo" no estaba en pantalla: se conserva. Solo se suma lo que el buscador dejo ver.
    expect(onChange).toHaveBeenCalledWith(["rojo", "azul"]);
  });

  it("sin coincidencias en la busqueda no se ofrece 'Todos' (no habria que marcar)", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter
        label="Color"
        options={AGRUPADAS}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    const lista = await abrir(user);

    await user.type(screen.getByLabelText("Buscar en Color"), "verde");
    expect(within(lista).queryAllByRole("option")).toHaveLength(0);
  });

  it("con `todosLabel={null}` el atajo no se ofrece", async () => {
    const user = userEvent.setup();
    render(
      <MultiSelectFilter
        label="Color"
        options={PLANAS}
        value={[]}
        onChange={vi.fn()}
        todosLabel={null}
      />,
    );
    const lista = await abrir(user);

    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Rojo",
      "Azul",
    ]);
  });
});
