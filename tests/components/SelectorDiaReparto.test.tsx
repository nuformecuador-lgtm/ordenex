// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SelectorDiaReparto } from "@/components/shared/SelectorDiaReparto";

// Feature 246 (T4.1) — el selector «Hoy / Mañana» que las DOS superficies de asignación montan
// (bodega central y bodega satélite, decisión D4).
//
// LOS LITERALES VAN ESCRITOS A MANO en cada aserción, nunca importados del módulo de textos que
// el componente usa. Un test que compara el texto contra la constante que lo produce está verde
// por construcción: afirma «la función devuelve lo que devuelve» y deja pasar cualquier cambio
// del texto visible. Si estas cadenas dejan de casar, es que alguien cambió lo que el operador
// lee, y eso tiene que doler.

const FECHAS = { hoy: "2026-08-20", manana: "2026-08-21" };

function renderSelector(
  props?: Partial<Parameters<typeof SelectorDiaReparto>[0]>,
) {
  const onValorChange = props?.onValorChange ?? vi.fn();
  render(
    <SelectorDiaReparto
      valor={props?.valor ?? "hoy"}
      onValorChange={onValorChange}
      fechas={props?.fechas ?? FECHAS}
      // Feature 262: `titulo` y `ayuda` se pasan SOLO si el caso los da. Con `undefined` el
      // componente cae a los suyos, que son los de la asignación — y ése es justamente el caso
      // que un test comprueba.
      titulo={props?.titulo}
      ayuda={props?.ayuda}
    />,
  );
  return { onValorChange };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SelectorDiaReparto — las dos opciones y el defecto (R27)", () => {
  it("R27: «Hoy» sale MARCADA y «Mañana» NO", () => {
    renderSelector({ valor: "hoy" });

    const hoy = screen.getByRole("radio", { name: "Hoy · 20 de agosto" });
    const manana = screen.getByRole("radio", { name: "Mañana · 21 de agosto" });

    // La presencia y la ausencia, emparejadas: que «Mañana» no esté marcada no significaría
    // nada si el radio no se hubiera renderizado, así que se afirma el estado de LOS DOS.
    expect(hoy).toBeChecked();
    expect(manana).not.toBeChecked();
  });

  it("el grupo es un `radiogroup` con nombre accesible y expone EXACTAMENTE dos opciones", () => {
    renderSelector();

    expect(
      screen.getByRole("radiogroup", { name: "Día de reparto" }),
    ).toBeInTheDocument();
    // Dos, ni una más: el alcance del producto es «hoy o mañana», no una fecha cualquiera.
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("R6: al elegir «Mañana» emite el TOKEN `manana`, nunca una fecha", async () => {
    const user = userEvent.setup();
    const { onValorChange } = renderSelector({ valor: "hoy" });

    await user.click(screen.getByRole("radio", { name: "Mañana · 21 de agosto" }));

    expect(onValorChange).toHaveBeenCalledTimes(1);
    // El valor emitido es el token del enum, con el que el servidor resuelve la fecha. Si algún
    // día esto emitiera un "2026-08-21", el día de reparto lo estaría decidiendo el navegador.
    expect(onValorChange).toHaveBeenCalledWith("manana");
  });

  it("con `valor='manana'` la marcada es «Mañana» y no «Hoy» (el padre manda)", () => {
    renderSelector({ valor: "manana" });

    expect(
      screen.getByRole("radio", { name: "Mañana · 21 de agosto" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Hoy · 20 de agosto" }),
    ).not.toBeChecked();
  });
});

// ---------------------------------------------------------------------------------------------
// ⬛ FEATURE 262 (F1, design §7.2) — EL MODO CORRECCIÓN: sin opción marcada y con su propio
// título. Al ASIGNAR «Hoy» viene preseleccionado a propósito (246/R27); al CORREGIR no, porque la
// mitad de las correcciones son «hoy → mañana» y la otra mitad «mañana → hoy».
//
// Los casos de arriba NO cubren esto: los dos valores que probaban eran siempre uno de los dos
// tokens, así que el componente podría no haber sabido nunca representar «todavía no se ha
// elegido» y todos habrían pasado igual.
// ---------------------------------------------------------------------------------------------
describe("SelectorDiaReparto — «sin elegir» es un estado representable (262/§7.2)", () => {
  it("con `valor=''` NINGUNA de las dos opciones sale marcada", () => {
    renderSelector({ valor: "" });

    // Las DOS, emparejadas: que «Hoy» no esté marcada no significaría nada si el radio no se
    // hubiera renderizado.
    expect(screen.getByRole("radio", { name: "Hoy · 20 de agosto" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Mañana · 21 de agosto" })).not.toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("desde «sin elegir» se puede elegir, y lo que emite sigue siendo el TOKEN", async () => {
    const user = userEvent.setup();
    const { onValorChange } = renderSelector({ valor: "" });

    await user.click(screen.getByRole("radio", { name: "Hoy · 20 de agosto" }));

    expect(onValorChange).toHaveBeenCalledTimes(1);
    expect(onValorChange).toHaveBeenCalledWith("hoy");
  });

  it("el título y la ayuda se pueden sustituir, y el nombre accesible los SIGUE", () => {
    // El nombre accesible del `radiogroup` sale del mismo texto que el título visible: quien
    // oye el control y quien lo lee tienen que estar oyendo el mismo nombre. Si el título
    // fuera prop y el `aria-label` se quedara fijo, esto se romperían por la mitad.
    renderSelector({ titulo: "Nuevo día de reparto", ayuda: "Ayuda propia de la corrección" });

    expect(
      screen.getByRole("radiogroup", { name: "Nuevo día de reparto" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Nuevo día de reparto")).toBeInTheDocument();
    expect(screen.getByText("Ayuda propia de la corrección")).toBeInTheDocument();
    // Y el de la asignación DEJA de estar: la ausencia emparejada con su presencia.
    expect(screen.queryByRole("radiogroup", { name: "Día de reparto" })).toBeNull();
  });

  it("sin esas props, el título y la ayuda siguen siendo los de ASIGNAR (nada cambia para la 246)", () => {
    renderSelector();

    expect(screen.getByRole("radiogroup", { name: "Día de reparto" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Todo el lote queda para el día que elijas. Puedes cambiarlo antes de asignar.",
      ),
    ).toBeInTheDocument();
  });
});

describe("SelectorDiaReparto — las etiquetas llegan por props (R29)", () => {
  it("R29: pinta LAS FECHAS QUE RECIBE, no las de ningún reloj", () => {
    // Fechas deliberadamente lejanas al día en que corre la suite: si el componente leyera el
    // reloj, estos literales no aparecerían.
    renderSelector({ fechas: { hoy: "2026-12-31", manana: "2027-01-01" } });

    expect(
      screen.getByRole("radio", { name: "Hoy · 31 de diciembre" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Mañana · 1 de enero" }),
    ).toBeInTheDocument();
  });

  it("R29: cambiar las props cambia las etiquetas — y las anteriores DEJAN de estar", () => {
    renderSelector({ fechas: { hoy: "2026-08-20", manana: "2026-08-21" } });
    expect(
      screen.getByRole("radio", { name: "Hoy · 20 de agosto" }),
    ).toBeInTheDocument();

    cleanup();
    renderSelector({ fechas: { hoy: "2026-03-04", manana: "2026-03-05" } });

    // La ausencia, EMPAREJADA con su presencia: sola pasaría en verde aunque no se hubiera
    // renderizado nada.
    expect(
      screen.getByRole("radio", { name: "Hoy · 4 de marzo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", { name: "Hoy · 20 de agosto" }),
    ).toBeNull();
  });

  it("sin fechas a mano las opciones se leen sólo con su nombre — nunca con una fecha inventada", () => {
    renderSelector({ fechas: { hoy: "", manana: "" } });

    expect(screen.getByRole("radio", { name: "Hoy" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mañana" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------
// CENSO DEL PROPIO ARCHIVO (R29). Los casos de arriba prueban que el componente USA las props;
// no pueden probar que NO lea el reloj: un `new Date()` que sólo afectara al orden de las
// opciones los dejaría a todos en verde. Esto lee el fuente y lo afirma directamente.
//
// Con ANTI-VACUIDAD: si el archivo no se puede leer o llega vacío, el censo REVIENTA en vez de
// dar por buena una lectura de cero bytes (molde de `carga-del-mensajero.guardia.test.ts`).
// ---------------------------------------------------------------------------------------------
describe("SelectorDiaReparto — censo: el componente no lee el reloj del navegador (R29)", () => {
  const RUTA = path.join(
    process.cwd(),
    "components",
    "shared",
    "SelectorDiaReparto.tsx",
  );

  function fuente(): string {
    const texto = readFileSync(RUTA, "utf8");
    if (texto.trim().length === 0) {
      throw new Error(`el censo no pudo leer ${RUTA}: archivo vacío`);
    }
    return texto;
  }

  /** Quita comentarios de línea y de bloque: el porqué del reloj SE EXPLICA en la prosa. */
  function codigo(texto: string): string {
    return texto
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n\r]*/g, "$1");
  }

  it("anti-vacuidad: el censo lee el archivo de verdad y encuentra el componente", () => {
    const texto = fuente();
    expect(texto.length).toBeGreaterThan(500);
    expect(texto).toContain("export function SelectorDiaReparto");
  });

  it("R29: el fuente no contiene ninguna lectura del reloj", () => {
    const sinComentarios = codigo(fuente());

    for (const prohibido of [
      "new Date(",
      "Date.now(",
      "toLocaleDateString",
      "toLocaleString",
      "Intl.DateTimeFormat",
    ]) {
      expect(
        sinComentarios.includes(prohibido),
        `«${prohibido}» aparece en SelectorDiaReparto.tsx: la etiqueta del día dejaría de venir del servidor (R29)`,
      ).toBe(false);
    }
  });

  it("el censo sabría verlo: la misma comprobación sobre un fuente con `new Date()` da positivo", () => {
    // Autocomprobación. Sin esto, un `codigo()` que borrara el archivo entero dejaría el caso
    // anterior verde para siempre y el censo sería decorativo.
    const falso = "const hoy = new Date();\n";
    expect(codigo(falso).includes("new Date(")).toBe(true);
  });
});
