// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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

// Los atajos del rango declaran QUE rango representan: pulsarlos no emite su valor,
// pinta ese rango en el calendario y emite sus dos extremos.
const RANGO_CORTO = { desde: "2026-07-20", hasta: "2026-07-24" };

const PERIODO: FilterDef = {
  key: "periodo",
  label: "Periodo",
  kind: "dateRange",
  options: [
    { value: "corto", label: "Plazo corto", defaultRange: RANGO_CORTO },
    {
      value: "largo",
      label: "Plazo largo",
      defaultRange: { desde: "2026-07-05", hasta: "2026-07-24" },
    },
  ],
};

const DESTACADO: FilterDef = {
  key: "destacado",
  label: "Destacado",
  kind: "boolean",
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

// `debounceMs: 0` por defecto en los tests: lo que se afirma aqui es QUE se emite, no
// CUANDO. El retardo tiene su propio bloque al final, que si lo mide.
function renderBarra(
  filters: FilterDef[],
  props: { showClearAll?: boolean; disabled?: boolean; debounceMs?: number } = {},
) {
  const onChange = vi.fn();
  render(
    <FilterComponent
      filters={filters}
      onChange={onChange}
      debounceMs={0}
      {...props}
    />,
  );
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

// El filtro `dateRange` elige sus extremos en un calendario. Aqui el orquestador no le
// pasa `defaultMonth`, asi que el calendario abre en el mes ACTUAL: los dias se eligen
// en ese mes y la fecha esperada se deriva de el (los dias 1 y 28 existen siempre).
const HOY = new Date();

function diaDelMesActual(dia: number): string {
  const mes = String(HOY.getMonth() + 1).padStart(2, "0");
  return `${HOY.getFullYear()}-${mes}-${String(dia).padStart(2, "0")}`;
}

/** Abre el calendario del filtro de rango si no lo esta (repulsar el disparador lo cerraria). */
async function abrirCalendario(user: ReturnType<typeof userEvent.setup>) {
  if (screen.queryAllByRole("grid").length === 0) {
    await user.click(screen.getByRole("button", { name: "Periodo" }));
  }
}

/** Elige `dia` del mes actual en el calendario del filtro de rango. */
async function elegirDia(user: ReturnType<typeof userEvent.setup>, dia: number) {
  await abrirCalendario(user);
  const cuadriculas = await screen.findAllByRole("grid");
  await user.click(within(cuadriculas[0]).getByText(String(dia)));
}

/** Pulsa un rango predefinido; viven dentro del propio calendario, como botones. */
async function clicAtajo(user: ReturnType<typeof userEvent.setup>, texto: string) {
  await abrirCalendario(user);
  const grupo = screen.getByRole("group", { name: "Rangos predefinidos" });
  await user.click(within(grupo).getByRole("button", { name: texto }));
}

/** Quita uno de los dos extremos ya elegidos, desde el pie del calendario. */
async function quitarExtremo(
  user: ReturnType<typeof userEvent.setup>,
  extremo: "desde" | "hasta",
) {
  await abrirCalendario(user);
  await user.click(screen.getByRole("button", { name: `Quitar ${extremo}` }));
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

    // "Todos" —el atajo del pedido humano 2026-08-19— encabeza la lista acotada.
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos",
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
    expect(screen.getByRole("button", { name: "Periodo" })).toBeDisabled();

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
    await elegirDia(user, 1);

    expect(ultima(onChange)).toEqual({
      color: ["rojo"],
      periodo: ["", diaDelMesActual(1), diaDelMesActual(1)],
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
    const user = userEvent.setup();
    const onChange = renderBarra([PERIODO]);

    await elegirDia(user, 1);
    expect(ultima(onChange)).toEqual({
      periodo: ["", diaDelMesActual(1), diaDelMesActual(1)],
    });

    // Volver a pulsar el unico dia del rango lo deselecciona por completo.
    await elegirDia(user, 1);
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
    // Rango abierto por abajo: se eligen los dos extremos y se quita el inicial.
    await elegirDia(user, 1);
    await elegirDia(user, 28);
    await quitarExtremo(user, "desde");

    const salida = ultima(onChange);
    expect(salida).toEqual({
      color: ["rojo"],
      acabado: ["mate"], // `single` = exactamente 1 valor
      periodo: ["", "", diaDelMesActual(28)], // `dateRange` = 3 posiciones, sin compactar
    });
    for (const valores of Object.values(salida)) {
      expect(Array.isArray(valores)).toBe(true);
      expect(valores.every((v) => typeof v === "string")).toBe(true);
    }
  });

  it("R19: el atajo emite el RANGO que representa, sin compactar la lista", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([PERIODO]);

    await clicAtajo(user, "Plazo corto");

    // El atajo no es un valor propio: la primera posicion sigue vacia.
    expect(ultima(onChange)).toEqual({
      periodo: ["", RANGO_CORTO.desde, RANGO_CORTO.hasta],
    });
  });

  it("R20: la salida es agnostica: no construye el objeto de consulta de nadie", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, PERIODO]);

    await marcar(user, "Color", "Rojo");
    await elegirDia(user, 1);

    const salida = ultima(onChange);
    // Ni claves de transporte, ni anidamiento, ni `filter`: solo clave declarada -> lista.
    expect(Object.keys(salida).sort()).toEqual(["color", "periodo"]);
    expect(salida).not.toHaveProperty("filter");
    expect(salida.periodo).toEqual(["", diaDelMesActual(1), diaDelMesActual(1)]);
  });
});

describe("FilterComponent — limpieza y poda (R21, R22, R26)", () => {
  it("R22: 'Limpiar todo' vacia TODOS los filtros y emite `{}` una sola vez", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, PERIODO], { showClearAll: true });

    await marcar(user, "Color", "Rojo");
    await elegirDia(user, 1);
    onChange.mockClear();

    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({});
    expect(screen.getByRole("button", { name: "Periodo" })).toHaveTextContent(
      "Cualquier fecha",
    );
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
    await elegirDia(user, 1);

    // Limpieza individual del multiple: la X dentro de su propio control.
    await user.click(screen.getByRole("button", { name: "Limpiar Color" }));

    expect(ultima(onChange)).toEqual({
      periodo: ["", diaDelMesActual(1), diaDelMesActual(1)],
    });
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
      "Todos",
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

describe("FilterComponent — filtro de interruptor (`boolean`)", () => {
  it("se monta como una casilla con su etiqueta, sin opciones que elegir", () => {
    renderBarra([DESTACADO]);

    const casilla = screen.getByRole("checkbox", { name: "Destacado" });
    expect(casilla).toBeInTheDocument();
    expect(casilla).not.toBeChecked();
  });

  it("R19: marcado emite UNA lista de cadenas, como el resto de tipos", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([DESTACADO]);

    await user.click(screen.getByRole("checkbox", { name: "Destacado" }));

    expect(ultima(onChange)).toEqual({ destacado: ["true"] });
  });

  it("R18: desmarcado NO emite `false`: la clave desaparece de la salida", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([DESTACADO, COLOR]);

    await user.click(screen.getByRole("checkbox", { name: "Destacado" }));
    await marcar(user, "Color", "Rojo");
    await user.click(screen.getByRole("checkbox", { name: "Destacado" }));

    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
  });

  it("R16: convive con el resto de filtros en la MISMA salida agregada", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR, DESTACADO]);

    await marcar(user, "Color", "Rojo");
    await user.click(screen.getByRole("checkbox", { name: "Destacado" }));

    expect(ultima(onChange)).toEqual({ color: ["rojo"], destacado: ["true"] });
  });

  it("R15: deshabilitado no acepta cambios ni emite", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([DESTACADO], { disabled: true });

    // Base UI renderiza la casilla como `span[role=checkbox]`: la inhabilitacion se
    // expone en `aria-disabled`, no en el atributo `disabled` de un input nativo.
    const casilla = screen.getByRole("checkbox", { name: "Destacado" });
    expect(casilla).toHaveAttribute("aria-disabled", "true");

    await user.click(casilla);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("R22: 'Limpiar todo' tambien lo desmarca", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([DESTACADO], { showClearAll: true });

    await user.click(screen.getByRole("checkbox", { name: "Destacado" }));
    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));

    expect(ultima(onChange)).toEqual({});
    expect(screen.getByRole("checkbox", { name: "Destacado" })).not.toBeChecked();
  });
});

describe("FilterComponent — emision con debounce", () => {
  it("no avisa al consumidor en el acto: espera a que pare el manoseo", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR], { debounceMs: 150 });

    await marcar(user, "Color", "Rojo");

    // El control YA refleja la seleccion; lo que se aplaza es la emision.
    expect(onChange).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith({ color: ["rojo"] }));
  });

  it("una racha de clics colapsa en UNA sola emision, la del estado final", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR], { debounceMs: 150 });

    await marcar(user, "Color", "Rojo");
    await marcar(user, "Color", "Azul");

    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ color: ["rojo", "azul"] }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("'Limpiar todo' tambien pasa por el retardo, sin adelantarse a lo pendiente", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR], { showClearAll: true, debounceMs: 150 });

    await marcar(user, "Color", "Rojo");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));

    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith({}));
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("`debounceMs={0}` emite en el acto (sin esperar un tick)", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR], { debounceMs: 0 });

    await marcar(user, "Color", "Rojo");

    expect(onChange).toHaveBeenCalledWith({ color: ["rojo"] });
  });
});

