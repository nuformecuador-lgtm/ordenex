// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  FilterComponent,
  avisoMinimoCaracteres,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";

// Feature 169 / T3.1 (R33, R34, R35, R36, R37, R41, R42) — el `kind: "text"` del
// componente GENERICO.
//
// Misma regla dura que el bloque A de la 144: los filtros son de FANTASIA. Aqui no se
// nombra una orden, ni una guia, ni un destinatario; si para escribir un caso hiciera
// falta, la logica estaria en el lugar equivocado (R33). El filtro es "Apodo", con un
// minimo de 3 caracteres que este archivo NO importa de dominio: lo declara el caso.

const MINIMO = 3;

const APODO: FilterDef = {
  key: "apodo",
  label: "Apodo",
  kind: "text",
  minChars: MINIMO,
  placeholder: "Como le dicen",
};

const COLOR: FilterDef = {
  key: "color",
  label: "Color",
  kind: "multi",
  options: [
    { value: "rojo", label: "Rojo" },
    { value: "azul", label: "Azul" },
  ],
};

// `debounceMs: 0` por defecto: lo que se afirma casi siempre es QUE se emite, no
// CUANDO. El retardo tiene su propio bloque, que si lo mide.
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

/** El campo de texto de un filtro `text`, por su nombre accesible. */
function campo(label = "Apodo"): HTMLInputElement {
  return screen.getByRole("searchbox", { name: label });
}

afterEach(() => cleanup());

describe("FilterComponent — filtro de texto: montaje y accesibilidad (R33, R41)", () => {
  it("R41: se monta como campo de busqueda con nombre accesible propio y su placeholder", () => {
    renderBarra([APODO]);

    const input = campo();
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "Como le dicen");
  });

  it("R33: es GENERICO — funciona con una clave y una etiqueta que no son de dominio", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO]);

    await user.type(campo(), "pepe");

    // La clave emitida es la declarada, y el valor es lo tecleado tal cual.
    expect(ultima(onChange)).toEqual({ apodo: ["pepe"] });
  });

  it("R33: no obtiene datos por si mismo (ninguna llamada de red al teclear)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("el filtro de texto no hace fetch"));
    const user = userEvent.setup();
    renderBarra([APODO]);

    await user.type(campo(), "pepe");

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("R16: convive con el resto de filtros en la MISMA salida agregada", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO, COLOR]);

    await user.type(campo(), "pepe");
    await user.click(screen.getByRole("button", { name: /^Color:/ }));
    await user.click(screen.getByRole("option", { name: "Rojo" }));

    expect(ultima(onChange)).toEqual({ apodo: ["pepe"], color: ["rojo"] });
  });

  it("R15: deshabilitado no acepta texto ni emite", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO], { disabled: true });

    expect(campo()).toBeDisabled();
    await user.type(campo(), "pepe");

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FilterComponent — filtro de texto: minimo de caracteres (R35)", () => {
  it("R35: por debajo del minimo NO emite nada (la busqueda no llega al servidor)", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO]);

    await user.type(campo(), "pe");

    expect(onChange).not.toHaveBeenCalled();
    expect(campo()).toHaveValue("pe"); // el campo SI responde al instante
  });

  it("R35: por debajo del minimo avisa de cuantos caracteres hacen falta, sin error", async () => {
    const user = userEvent.setup();
    renderBarra([APODO]);

    await user.type(campo(), "pe");

    expect(screen.getByRole("status")).toHaveTextContent(
      avisoMinimoCaracteres(MINIMO),
    );
    // No es un error de validacion: el campo no se marca invalido.
    expect(campo()).not.toHaveAttribute("aria-invalid", "true");
  });

  it("R41: el aviso es una region `status` a la que el campo APUNTA (`aria-describedby`)", async () => {
    const user = userEvent.setup();
    renderBarra([APODO]);

    await user.type(campo(), "pe");

    const aviso = screen.getByRole("status");
    expect(campo()).toHaveAttribute("aria-describedby", aviso.id);
  });

  it("R35: con el campo vacio no hay aviso (no se regaña a quien no ha escrito)", () => {
    renderBarra([APODO]);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("R35: alcanzado el minimo, el aviso desaparece", async () => {
    const user = userEvent.setup();
    renderBarra([APODO]);

    await user.type(campo(), "pep");

    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(campo()).not.toHaveAttribute("aria-describedby");
  });

  it("R35: los espacios NO cuentan para el minimo (mismo criterio que el borde)", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO]);

    await user.type(campo(), "  a  ");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      avisoMinimoCaracteres(MINIMO),
    );
  });

  it("emite el termino RECORTADO: los espacios de los extremos no viajan", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO]);

    await user.type(campo(), "  pepe  ");

    expect(ultima(onChange)).toEqual({ apodo: ["pepe"] });
  });

  it("sin `minChars` declarado, un solo caracter ya viaja (default sin minimo)", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([{ key: "apodo", label: "Apodo", kind: "text" }]);

    await user.type(campo(), "p");

    expect(ultima(onChange)).toEqual({ apodo: ["p"] });
    // Y sin minimo no hay nada de lo que avisar.
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

describe("FilterComponent — filtro de texto: la clave aparece y desaparece (R36)", () => {
  it("R36: vaciar el campo emite la seleccion SIN la clave", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO]);

    await user.type(campo(), "pepe");
    expect(ultima(onChange)).toEqual({ apodo: ["pepe"] });

    await user.clear(campo());

    expect(ultima(onChange)).toEqual({});
    expect(Object.keys(ultima(onChange))).not.toContain("apodo");
  });

  it("R36: bajar del minimo borrando tambien retira la clave (no queda el termino viejo)", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO]);

    await user.type(campo(), "pepe");
    await user.type(campo(), "{Backspace}{Backspace}");

    expect(campo()).toHaveValue("pe");
    expect(ultima(onChange)).toEqual({});
  });

  it("R36: al vaciarlo, el resto de filtros de la barra sigue en la salida", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO, COLOR]);

    await user.click(screen.getByRole("button", { name: /^Color:/ }));
    await user.click(screen.getByRole("option", { name: "Rojo" }));
    await user.type(campo(), "pepe");
    await user.clear(campo());

    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
  });

  it("teclear por debajo del minimo NO avisa al consumidor una y otra vez", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO]);

    await user.type(campo(), "pe");
    await user.type(campo(), "{Backspace}");

    // Nada cambio para el consumidor: la clave nunca estuvo puesta.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("añadir un espacio a un termino ya aplicado no emite otra vez (misma consulta)", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO]);

    await user.type(campo(), "pepe");
    // Con `debounceMs: 0` cada pulsacion a partir del minimo emite; lo que se afirma es
    // que el espacio del final NO añade una emision mas.
    const emisiones = onChange.mock.calls.length;

    await user.type(campo(), " ");

    expect(campo()).toHaveValue("pepe ");
    expect(onChange).toHaveBeenCalledTimes(emisiones);
    expect(ultima(onChange)).toEqual({ apodo: ["pepe"] });
  });
});

describe("FilterComponent — filtro de texto: limpieza (R37)", () => {
  it("R37: se limpia individualmente con su propia accion, sin tocar a los demas", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO, COLOR]);

    await user.click(screen.getByRole("button", { name: /^Color:/ }));
    await user.click(screen.getByRole("option", { name: "Rojo" }));
    await user.type(campo(), "pepe");

    await user.click(screen.getByRole("button", { name: "Limpiar Apodo" }));

    expect(campo()).toHaveValue("");
    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
  });

  it("R37: la accion de limpiar solo existe cuando hay algo escrito", async () => {
    const user = userEvent.setup();
    renderBarra([APODO]);

    expect(screen.queryByRole("button", { name: "Limpiar Apodo" })).toBeNull();

    await user.type(campo(), "pe"); // aun por debajo del minimo, pero hay texto
    expect(screen.getByRole("button", { name: "Limpiar Apodo" })).toBeInTheDocument();
  });

  it("R37: 'Limpiar todo' vacia el campo y lo saca de la salida", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO], { showClearAll: true });

    await user.type(campo(), "pepe");
    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));

    expect(campo()).toHaveValue("");
    expect(ultima(onChange)).toEqual({});
  });

  it("R37: 'Limpiar todo' emite UNA sola vez, tambien con el campo por debajo del minimo", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO, COLOR], { showClearAll: true });

    await user.click(screen.getByRole("button", { name: /^Color:/ }));
    await user.click(screen.getByRole("option", { name: "Rojo" }));
    await user.type(campo(), "pe");
    onChange.mockClear();

    await user.click(screen.getByRole("button", { name: "Limpiar todo" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({});
    expect(campo()).toHaveValue("");
  });
});

describe("FilterComponent — filtro de texto: una consulta por rafaga (R34)", () => {
  it("R34: no avisa en el acto — espera a que el usuario deje de escribir", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO], { debounceMs: 150 });

    await user.type(campo(), "pepe");

    // El campo YA muestra lo tecleado; lo que se aplaza es la emision.
    expect(campo()).toHaveValue("pepe");
    expect(onChange).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith({ apodo: ["pepe"] }));
  });

  it("R34: una rafaga de DIEZ pulsaciones produce UNA sola emision, la del texto final", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([APODO], { debounceMs: 150 });

    await user.type(campo(), "pepeluis1x"); // 10 pulsaciones

    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ apodo: ["pepeluis1x"] }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("R34: usa el debounce del orquestador, no uno propio (no suma dos esperas)", async () => {
    const user = userEvent.setup();
    // Con `debounceMs: 0` la emision es inmediata: si el control tuviera su propio
    // temporizador, esta asercion sincrona fallaria.
    const onChange = renderBarra([APODO], { debounceMs: 0 });

    await user.type(campo(), "pepe");

    expect(onChange).toHaveBeenLastCalledWith({ apodo: ["pepe"] });
  });
});

describe("FilterComponent — sin filtro de texto declarado (R42)", () => {
  it("R42: una barra sin `kind: \"text\"` no monta ningun campo de busqueda ni aviso", async () => {
    const user = userEvent.setup();
    const onChange = renderBarra([COLOR]);

    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Color:/ }));
    await user.click(screen.getByRole("option", { name: "Rojo" }));

    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
  });
});
