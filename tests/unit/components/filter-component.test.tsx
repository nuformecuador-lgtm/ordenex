// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";

// Feature 144 / TA.4 (R1-R7, R13-R20, R22, R26, R29) — orquestador GENERICO.
// BLOQUE A: los filtros son de FANTASIA (color -> talla -> material, y un periodo).
// Si para escribir un caso hiciera falta nombrar una orden, una zona o una provincia,
// la logica estaria en el lugar equivocado.

const COLOR: FilterDef = {
  key: "color",
  label: "Color",
  kind: "multi",
  options: [
    { value: "rojo", label: "Rojo" },
    { value: "azul", label: "Azul" },
  ],
};

const TALLA_DEPENDIENTE: FilterDef = {
  key: "talla",
  label: "Talla",
  kind: "multi",
  dependsOn: "color",
  options: [
    { value: "rojo-s", label: "Roja S", parentValue: "rojo" },
    { value: "azul-s", label: "Azul S", parentValue: "azul" },
  ],
};

const PERIODO: FilterDef = {
  key: "periodo",
  label: "Periodo",
  kind: "dateRange",
  options: [
    { value: "corto", label: "Plazo corto" },
    { value: "largo", label: "Plazo largo" },
  ],
};

const ACABADO_UNICO: FilterDef = {
  key: "acabado",
  label: "Acabado",
  kind: "single",
  options: [
    { value: "mate", label: "Mate" },
    { value: "brillo", label: "Brillo" },
  ],
};

function renderBarra(filters: FilterDef[], props: { showClearAll?: boolean; disabled?: boolean } = {}) {
  const onChange = vi.fn();
  render(<FilterComponent filters={filters} onChange={onChange} {...props} />);
  return onChange;
}

/** Ultima seleccion emitida. */
function ultima(onChange: ReturnType<typeof vi.fn>): FilterSelection {
  return onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FilterSelection;
}

/** Abre el panel de un filtro `multi` y devuelve su listbox. */
async function abrirMulti(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
): Promise<HTMLElement> {
  // El panel del multiple NO se cierra al marcar (seleccion encadenada): si ya
  // esta abierto, volver a pulsar el disparador lo cerraria.
  const abierto = screen.queryByRole("listbox", { name: label });
  if (abierto) return abierto;
  await user.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
  return screen.getByRole("listbox", { name: label });
}

async function marcar(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  opcion: string,
) {
  const lista = await abrirMulti(user, label);
  await user.click(within(lista).getByRole("option", { name: opcion }));
}

afterEach(() => cleanup());

describe("FilterComponent — declaracion y composicion (R1-R5)", () => {
  it("R1: monta los N filtros declarados por props", () => {
    renderBarra([COLOR, ACABADO_UNICO, PERIODO]);

    expect(screen.getByRole("button", { name: /^Color:/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Acabado" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Periodo" })).toBeInTheDocument();
  });

  it("R1: con UN solo filtro declarado tambien funciona", () => {
    renderBarra([COLOR]);
    expect(screen.getAllByRole("button", { name: /^Color:/ })).toHaveLength(1);
  });

  it("R2: cada filtro se identifica por su CLAVE en la salida y muestra su etiqueta", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR]);

    await marcar(user, "Color", "Rojo");

    expect(Object.keys(ultima(onChange))).toEqual(["color"]);
    expect(screen.getByRole("button", { name: /^Color:/ })).toBeInTheDocument();
  });

  it("R3: renderiza los filtros en el MISMO orden en que se declararon", () => {
    const { container } = render(
      <FilterComponent
        filters={[PERIODO, COLOR, ACABADO_UNICO]}
        onChange={vi.fn()}
      />,
    );
    const nombres = Array.from(container.querySelectorAll("[aria-label]"))
      .map((e) => e.getAttribute("aria-label") ?? "")
      .map((n) => n.split(":")[0]);
    const orden = nombres.filter(
      (n, i) => ["Periodo", "Color", "Acabado"].includes(n) && nombres.indexOf(n) === i,
    );
    expect(orden).toEqual(["Periodo", "Color", "Acabado"]);
  });

  it("R4: NO obtiene datos por si mismo (ninguna llamada de red)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("el bloque A no hace fetch"));
    const user = userEvent.setup();

    renderBarra([COLOR, TALLA_DEPENDIENTE, PERIODO]);
    await marcar(user, "Color", "Rojo");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("R5: emite EXACTAMENTE los valores declarados, sin transformarlos", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR]);

    await marcar(user, "Color", "Rojo");

    // El valor declarado es `rojo`, no la etiqueta `Rojo` ni una version decorada.
    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
  });
});

describe("FilterComponent — tipos de control (R6, R7, R13, R14)", () => {
  it("R6: el filtro multiple trae buscador interno sobre SUS opciones", async () => {
    const user = userEvent.setup();
    renderBarra([COLOR]);
    const lista = await abrirMulti(user, "Color");

    await user.type(screen.getByLabelText("Buscar en Color"), "azu");

    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Azul",
    ]);
  });

  it("R6: el filtro multiple acumula varios valores", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR]);

    await marcar(user, "Color", "Rojo");
    await marcar(user, "Color", "Azul");

    expect(ultima(onChange)).toEqual({ color: ["rojo", "azul"] });
  });

  it("R7: en el filtro UNICO, elegir un valor SUSTITUYE al anterior", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([ACABADO_UNICO]);

    await user.click(screen.getByRole("combobox", { name: "Acabado" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Mate" }),
    );
    expect(ultima(onChange)).toEqual({ acabado: ["mate"] });

    await user.click(screen.getByRole("combobox", { name: "Acabado" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Brillo",
      }),
    );
    expect(ultima(onChange)).toEqual({ acabado: ["brillo"] });
  });

  it("R13: un tipo NO soportado no se renderiza ni entra en la salida, y el resto sigue vivo", async () => {
    const user = userEvent.setup();
    const desconocido = {
      key: "raro",
      label: "Raro",
      kind: "constelacion",
      options: [{ value: "x", label: "X" }],
    } as unknown as FilterDef;
    const onChange = renderBarra([desconocido, COLOR]);

    expect(screen.queryByRole("button", { name: /^Raro:/ })).toBeNull();
    await marcar(user, "Color", "Rojo");
    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
    expect(Object.keys(ultima(onChange))).not.toContain("raro");
  });

  it("R14: un filtro de opciones SIN opciones se presenta deshabilitado", () => {
    renderBarra([
      { key: "vacio", label: "Vacio", kind: "multi", options: [] },
      { key: "vacio2", label: "Vacio2", kind: "single", options: [] },
    ]);

    expect(screen.getByRole("button", { name: /^Vacio:/ })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Vacio2" })).toBeDisabled();
  });

  it("R14: un filtro dependiente cuyo padre no deja ninguna opcion queda deshabilitado", async () => {
    const user = userEvent.setup();
    const talla: FilterDef = {
      ...TALLA_DEPENDIENTE,
      options: [{ value: "rojo-s", label: "Roja S", parentValue: "rojo" }],
    };
    renderBarra([COLOR, talla]);

    await marcar(user, "Color", "Azul");

    expect(screen.getByRole("button", { name: /^Talla:/ })).toBeDisabled();
  });

  it("R15: con los filtros deshabilitados, ningun control emite", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, ACABADO_UNICO, PERIODO], {
      disabled: true,
      showClearAll: true,
    });

    expect(screen.getByRole("button", { name: /^Color:/ })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Acabado" })).toBeDisabled();
    expect(screen.getByLabelText("Desde")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Limpiar todo" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^Color:/ }));
    expect(screen.queryByRole("listbox", { name: "Color" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FilterComponent — salida agregada (R16-R20)", () => {
  it("R16: al seleccionar, emite la seleccion COMPLETA de TODOS los filtros", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, TALLA_DEPENDIENTE]);

    await marcar(user, "Color", "Rojo");
    await marcar(user, "Talla", "Roja S");

    expect(ultima(onChange)).toEqual({ color: ["rojo"], talla: ["rojo-s"] });
  });

  it("R16: fijar un extremo del rango tambien emite la seleccion agregada", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, PERIODO]);

    await marcar(user, "Color", "Rojo");
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-07-01" },
    });

    expect(ultima(onChange)).toEqual({
      color: ["rojo"],
      periodo: ["", "2026-07-01", ""],
    });
  });

  it("R17: MIENTRAS se escribe en el buscador interno, NO se emite ningun cambio", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR]);
    await abrirMulti(user, "Color");

    await user.type(screen.getByLabelText("Buscar en Color"), "rojo");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("R18: los filtros sin seleccion NO aparecen en la salida", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, ACABADO_UNICO, PERIODO]);

    await marcar(user, "Color", "Rojo");

    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
  });

  it("R18: deseleccionar el ultimo valor deja la salida VACIA (`{}`), distinguible", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR]);

    await marcar(user, "Color", "Rojo");
    await marcar(user, "Color", "Rojo");

    expect(ultima(onChange)).toEqual({});
  });

  it("R18: un rango sin atajo y sin extremos cuenta como SIN SELECCION", async () => {
    const onChange = renderBarra([PERIODO]);

    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-07-01" },
    });
    expect(ultima(onChange)).toEqual({ periodo: ["", "2026-07-01", ""] });

    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "" } });
    expect(ultima(onChange)).toEqual({});
  });

  it("R19: la salida es uniforme — una LISTA de cadenas por clave, en los tres tipos", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, ACABADO_UNICO, PERIODO]);

    await marcar(user, "Color", "Rojo");
    await user.click(screen.getByRole("combobox", { name: "Acabado" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", { name: "Mate" }),
    );
    fireEvent.change(screen.getByLabelText("Hasta"), {
      target: { value: "2026-07-28" },
    });

    const salida = ultima(onChange);
    expect(salida).toEqual({
      color: ["rojo"],
      acabado: ["mate"], // `single` = exactamente 1 valor
      periodo: ["", "", "2026-07-28"], // `dateRange` = 3 posiciones, sin compactar
    });
    for (const valores of Object.values(salida)) {
      expect(Array.isArray(valores)).toBe(true);
      expect(valores.every((v) => typeof v === "string")).toBe(true);
    }
  });

  it("R19: el atajo del rango viaja en la PRIMERA posicion, sin compactar la lista", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([PERIODO]);

    await user.click(screen.getByRole("combobox", { name: "Periodo" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Plazo corto",
      }),
    );

    expect(ultima(onChange)).toEqual({ periodo: ["corto", "", ""] });
  });

  it("R20: la salida es agnostica: no construye el objeto de consulta de nadie", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, PERIODO]);

    await marcar(user, "Color", "Rojo");
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-07-01" },
    });

    const salida = ultima(onChange);
    // Ni claves de transporte, ni anidamiento, ni `filter`: solo clave declarada -> lista.
    expect(Object.keys(salida).sort()).toEqual(["color", "periodo"]);
    expect(salida).not.toHaveProperty("filter");
    expect(salida.periodo).toEqual(["", "2026-07-01", ""]);
  });
});

describe("FilterComponent — limpieza y poda (R21, R22, R26)", () => {
  it("R22: 'Limpiar todo' vacia TODOS los filtros y emite `{}` una sola vez", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, PERIODO], { showClearAll: true });

    await marcar(user, "Color", "Rojo");
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-07-01" },
    });
    onChange.mockClear();

    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({});
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Color: Todos" })).toBeInTheDocument();
  });

  it("R22: 'Limpiar todo' NO se ofrece si el consumidor no lo habilita", () => {
    renderBarra([COLOR]);
    expect(screen.queryByRole("button", { name: "Limpiar todo" })).toBeNull();
  });

  it("R21: cada filtro se limpia individualmente sin tocar a los demas", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, PERIODO]);

    await marcar(user, "Color", "Rojo");
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-07-01" },
    });

    // Limpieza individual del multiple (su propio boton "Limpiar").
    const limpiadores = screen.getAllByRole("button", { name: /limpiar/i });
    await user.click(limpiadores[0]);

    expect(ultima(onChange)).toEqual({ periodo: ["", "2026-07-01", ""] });
  });

  it("R26: al cambiar el padre, el hijo huerfano YA NO aparece en lo emitido", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, TALLA_DEPENDIENTE]);

    await marcar(user, "Color", "Rojo");
    await marcar(user, "Talla", "Roja S");
    expect(ultima(onChange)).toEqual({ color: ["rojo"], talla: ["rojo-s"] });

    // Se marca azul y se desmarca rojo: `rojo-s` deja de estar ofrecido.
    await marcar(user, "Color", "Azul");
    await marcar(user, "Color", "Rojo");

    expect(ultima(onChange)).toEqual({ color: ["azul"] });
  });

  it("R24: el filtro dependiente solo OFRECE las opciones de la seleccion del padre", async () => {
    const user = userEvent.setup();
    renderBarra([COLOR, TALLA_DEPENDIENTE]);

    await marcar(user, "Color", "Rojo");
    const lista = await abrirMulti(user, "Talla");

    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Roja S",
    ]);
  });
});

describe("FilterComponent — accesibilidad (R29)", () => {
  it("R29: cada filtro montado expone un nombre accesible propio", () => {
    renderBarra([COLOR, ACABADO_UNICO, PERIODO]);

    expect(screen.getByRole("button", { name: /^Color:/ })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Acabado" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Periodo" })).toBeInTheDocument();
  });

  it("R29: en el multiple, el estado seleccionado/no seleccionado es legible por opcion", async () => {
    const user = userEvent.setup();
    renderBarra([COLOR]);

    await marcar(user, "Color", "Rojo");
    const lista = await abrirMulti(user, "Color");

    expect(within(lista).getByRole("option", { name: "Rojo" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(lista).getByRole("option", { name: "Azul" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});
