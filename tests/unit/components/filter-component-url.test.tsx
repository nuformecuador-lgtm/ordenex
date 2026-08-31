// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Feature 335 / T4.1-T4.3 — `FilterComponent` sembrando su seleccion desde la URL.
//
// El mock de `next/navigation` copia el patron ya escrito del repo
// (`tests/unit/components/buscador-filtros-url.test.tsx`, a su vez tomado de
// `tests/components/CierresAdminDeepLink.test.tsx`): un `let` reasignable con la query de
// cada caso.
//
// Los filtros son de FANTASIA (color -> talla, un acabado, un periodo, una nota y un
// destacado), como en `tests/unit/components/filter-component.test.tsx`: si para escribir
// un caso hiciera falta nombrar una zona o un mensajero de verdad, la logica estaria en el
// lugar equivocado. Por eso el `?zona=A,B` del enunciado se escribe aqui como
// `?color=rojo,azul`: el requisito no habla de zonas, habla de una clave declarada.

const replaceMock = vi.fn();
const pushMock = vi.fn();

/** La URL de la prueba. `let` porque cada caso entra por una direccion distinta. */
let parametros = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, refresh: vi.fn() }),
  usePathname: () => "/fantasia",
  useSearchParams: () => parametros,
}));

import {
  BOOLEAN_MARCADO,
  FilterComponent,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";

const COLOR: FilterDef = {
  key: "color",
  label: "Color",
  kind: "multi",
  options: [
    { value: "rojo", label: "Rojo" },
    { value: "azul", label: "Azul" },
    { value: "verde", label: "Verde" },
  ],
};

const ACABADO: FilterDef = {
  key: "acabado",
  label: "Acabado",
  kind: "single",
  options: [
    { value: "mate", label: "Mate" },
    { value: "brillo", label: "Brillo" },
  ],
};

const RANGO_CORTO = { desde: "2026-07-20", hasta: "2026-07-24" };

const PERIODO: FilterDef = {
  key: "periodo",
  label: "Periodo",
  kind: "dateRange",
  options: [{ value: "corto", label: "Plazo corto", defaultRange: RANGO_CORTO }],
};

const NOTA: FilterDef = { key: "nota", label: "Nota", kind: "text" };

const DESTACADO: FilterDef = {
  key: "destacado",
  label: "Destacado",
  kind: "boolean",
};

beforeEach(() => {
  replaceMock.mockClear();
  pushMock.mockClear();
  parametros = new URLSearchParams();
});

afterEach(() => {
  cleanup();
});

/**
 * `debounceMs: 0` en todos los casos: lo que se afirma aqui es QUE se emite y con que, no
 * CUANDO; el retardo ya tiene su propio bloque en `filter-component.test.tsx`.
 */
function montar(filters: FilterDef[], props: { leerDeUrl?: boolean } = {}) {
  const onChange = vi.fn();
  const vista = render(
    <FilterComponent
      filters={filters}
      onChange={onChange}
      debounceMs={0}
      {...props}
    />,
  );
  const volverAMontar = (siguientes: FilterDef[]) =>
    vista.rerender(
      <FilterComponent
        filters={siguientes}
        onChange={onChange}
        debounceMs={0}
        {...props}
      />,
    );
  return { onChange, volverAMontar };
}

/** Ultima seleccion emitida (`undefined` si no hubo ninguna emision). */
function ultima(onChange: ReturnType<typeof vi.fn>): FilterSelection | undefined {
  return onChange.mock.calls.at(-1)?.[0] as FilterSelection | undefined;
}

/** Abre el panel de un filtro `multi` (repulsar el disparador lo cerraria). */
async function abrirMulti(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
): Promise<HTMLElement> {
  const abierto = screen.queryByRole("listbox", { name: label });
  if (abierto) return abierto;
  await user.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
  return screen.getByRole("listbox", { name: label });
}

/** ¿Esta marcada esa opcion en el panel del `multi`? */
async function marcada(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  opcion: string,
): Promise<string | null> {
  const lista = await abrirMulti(user, label);
  return within(lista)
    .getByRole("option", { name: opcion })
    .getAttribute("aria-selected");
}

describe("FilterComponent — siembra de la seleccion desde la URL (R3, R6, R23)", () => {
  it("R3 — con `?color=rojo,azul` el control aparece con las dos marcadas y la seleccion se emite", async () => {
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=rojo,azul");

    const { onChange } = montar([COLOR]);

    expect(ultima(onChange)).toEqual({ color: ["rojo", "azul"] });
    expect(
      screen.getByRole("button", { name: "Color: 2 seleccionados" }),
    ).toBeInTheDocument();
    expect(await marcada(user, "Color", "Rojo")).toBe("true");
    expect(await marcada(user, "Color", "Azul")).toBe("true");
    expect(await marcada(user, "Color", "Verde")).toBe("false");
  });

  it("R6 — sin params no se emite NADA al montar y la seleccion esta vacia", async () => {
    const user = userEvent.setup();

    const { onChange } = montar([COLOR, ACABADO, NOTA, DESTACADO]);

    expect(onChange).not.toHaveBeenCalled();
    expect(await marcada(user, "Color", "Rojo")).toBe("false");
    expect(
      (screen.getByRole("searchbox", { name: "Nota" }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("R23 — con `leerDeUrl={false}` los params se ignoran y no hay emision", async () => {
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=rojo&nota=texto&destacado=true");

    const { onChange } = montar([COLOR, NOTA, DESTACADO], { leerDeUrl: false });

    expect(onChange).not.toHaveBeenCalled();
    expect(await marcada(user, "Color", "Rojo")).toBe("false");
    expect(
      (screen.getByRole("searchbox", { name: "Nota" }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("R3 — un `boolean` y un `single` sembrados llegan a la seleccion", () => {
    parametros = new URLSearchParams("destacado=true&acabado=brillo");

    const { onChange } = montar([DESTACADO, ACABADO]);

    expect(ultima(onChange)).toEqual({
      destacado: [BOOLEAN_MARCADO],
      acabado: ["brillo"],
    });
    // El `Checkbox` de base-ui vive dentro de un `<label>`, asi que su nombre accesible
    // es el texto visible; y marcado se anuncia con `aria-checked`, no con `checked`.
    expect(screen.getByRole("checkbox", { name: "Destacado" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("FilterComponent — el orden de montaje no decide el resultado (R2, R3, R7)", () => {
  it("R2/R3 — declarar el filtro DESPUES del montaje siembra igual su valor de la URL", async () => {
    // El caso REAL de `/ordenes`: el orquestador se monta con `filters=[]` y solo despues
    // la barra activa la clave que traia la URL.
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=rojo");

    const { onChange, volverAMontar } = montar([]);
    expect(onChange).not.toHaveBeenCalled();

    volverAMontar([COLOR]);

    await waitFor(() => expect(ultima(onChange)).toEqual({ color: ["rojo"] }));
    expect(await marcada(user, "Color", "Rojo")).toBe("true");
  });

  it("R7 — quitar el valor a mano y volver a declarar el filtro NO lo resucita", async () => {
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=rojo");

    const { onChange, volverAMontar } = montar([COLOR]);
    expect(ultima(onChange)).toEqual({ color: ["rojo"] });

    // Gesto del usuario: desmarca lo que traia la URL. Eso cierra la siembra.
    const lista = await abrirMulti(user, "Color");
    await user.click(within(lista).getByRole("option", { name: "Rojo" }));
    expect(ultima(onChange)).toEqual({});

    // Retira el control y vuelve a pedirlo.
    volverAMontar([]);
    volverAMontar([COLOR]);

    await waitFor(() => expect(ultima(onChange)).toEqual({}));
    expect(await marcada(user, "Color", "Rojo")).toBe("false");
  });

  it("R7 — cambiar los params DESPUES del montaje no cambia la seleccion", async () => {
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=rojo");

    const { onChange, volverAMontar } = montar([COLOR]);
    expect(ultima(onChange)).toEqual({ color: ["rojo"] });

    parametros = new URLSearchParams("color=azul");
    volverAMontar([COLOR]);

    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await marcada(user, "Color", "Azul")).toBe("false");
  });

  it("R16 — un valor que no esta en el catalogo no siembra nada", async () => {
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=fucsia&acabado=inexistente");

    const { onChange } = montar([COLOR, ACABADO]);

    expect(onChange).not.toHaveBeenCalled();
    expect(await marcada(user, "Color", "Rojo")).toBe("false");
    const acabado = screen.getByRole("combobox", { name: "Acabado" });
    expect(acabado).not.toHaveTextContent("Mate");
    expect(acabado).not.toHaveTextContent("Brillo");
  });
});

/**
 * EL CATALOGO QUE LLEGA TARDE, Y LA FOTO DE LA URL AL ENTRAR.
 *
 * Los dos fallos que el revisor demostro son el mismo nudo visto por sus dos extremos:
 *
 *  - **B2**: la siembra por crecimiento leia la URL DE AHORA (una ref reescrita en cada
 *    render), asi que un cambio posterior de los params SI entraba. R7 era falso.
 *  - **B1**: una clave declarada con `options: []` —el caso real de `/novedades`, cuyo
 *    catalogo se pide de forma perezosa— quedaba marcada como sembrada aunque su valor se
 *    hubiera descartado por R14, y al llegar el catalogo ya no se reintentaba. El enlace
 *    compartido no acotaba nada.
 *
 * Los casos de aqui abajo separan las dos mitades que hay que distinguir: **releer** la URL
 * esta prohibido (R7), **terminar de aplicar lo que ya se leyo** no lo esta (R3/R5).
 */
describe("FilterComponent — la foto de la URL al entrar manda (R3, R5, R7)", () => {
  it("R7 — cambiar los params ANTES de declarar el filtro no siembra el valor nuevo", async () => {
    // Contraejemplo de B2: el caso hermano que ya existia cambiaba los params SIN cambiar
    // `filters`, asi que el efecto de siembra ni corria. Aqui el juego de claves CRECE, que
    // es justo el disparador que volvia a leer la URL.
    const user = userEvent.setup();

    const { onChange, volverAMontar } = montar([]);

    parametros = new URLSearchParams("color=azul");
    volverAMontar([COLOR]);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Color:/ })).toBeInTheDocument(),
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(await marcada(user, "Color", "Azul")).toBe("false");
  });

  it("R3/R5 — un catalogo que llega DESPUES del montaje siembra la clave que quedo pendiente", async () => {
    // Contraejemplo de B1, con el orden de montaje real de `/novedades`: el control se
    // declara sin opciones (el conjunto se pide perezosamente) y solo despues llega el
    // catalogo. Si la clave se diera por sembrada al declararla, aqui no pasaria nada.
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=rojo");

    const { onChange, volverAMontar } = montar([{ ...COLOR, options: [] }]);
    expect(onChange).not.toHaveBeenCalled();

    volverAMontar([COLOR]);

    await waitFor(() => expect(ultima(onChange)).toEqual({ color: ["rojo"] }));
    expect(await marcada(user, "Color", "Rojo")).toBe("true");
  });

  it("R3/R7 — al llegar el catalogo se siembra la URL DE ENTRADA, nunca la de ahora", async () => {
    // El caso mas afilado, y el unico que distingue «terminar de aplicar lo ya leido» de
    // «releer»: la URL cambia mientras el catalogo viaja. Gana la foto de entrada.
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=rojo");

    const { onChange, volverAMontar } = montar([{ ...COLOR, options: [] }]);

    parametros = new URLSearchParams("color=azul");
    volverAMontar([COLOR]);

    await waitFor(() => expect(ultima(onChange)).toEqual({ color: ["rojo"] }));
    expect(
      onChange.mock.calls.map(([seleccion]) => seleccion as FilterSelection),
    ).not.toContainEqual({ color: ["azul"] });
    expect(await marcada(user, "Color", "Azul")).toBe("false");
  });

  it("R7 — el gesto del usuario cierra la siembra: el catalogo que llega tarde no le pisa la seleccion", async () => {
    // El catalogo empieza incompleto (solo «Verde»), asi que «rojo» se descarta por R14 y la
    // clave queda PENDIENTE. El usuario elige a mano antes de que llegue el resto: cuando
    // llegue, la siembra ya esta cerrada y no puede resucitar nada.
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=rojo");

    const soloVerde: FilterDef = {
      ...COLOR,
      options: [{ value: "verde", label: "Verde" }],
    };
    const { onChange, volverAMontar } = montar([soloVerde]);
    expect(onChange).not.toHaveBeenCalled();

    const lista = await abrirMulti(user, "Color");
    await user.click(within(lista).getByRole("option", { name: "Verde" }));
    expect(ultima(onChange)).toEqual({ color: ["verde"] });

    volverAMontar([COLOR]);

    await waitFor(() => expect(ultima(onChange)).toEqual({ color: ["verde"] }));
    expect(await marcada(user, "Color", "Rojo")).toBe("false");
  });
});

describe("FilterComponent — la precarga sobrevive a la poda (R17)", () => {
  it("R17 — tras el ciclo completo de efectos no llega ninguna emision que borre la clave sembrada", async () => {
    parametros = new URLSearchParams("color=rojo");

    // Se declara MAS de un filtro a proposito: la poda recorre las claves de la seleccion
    // contra las declaradas, y con dos controles el efecto tiene mas de una ocasion de
    // equivocarse.
    const { onChange, volverAMontar } = montar([COLOR, ACABADO]);

    // Deja correr el ciclo entero: un render mas del consumidor vuelve a pasar por el
    // efecto que poda y siembra.
    volverAMontar([COLOR, ACABADO]);
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    const seleccionesSinColor = onChange.mock.calls
      .map(([seleccion]) => seleccion as FilterSelection)
      .filter((seleccion) => seleccion.color === undefined);
    expect(seleccionesSinColor).toEqual([]);
    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
  });
});

describe("FilterComponent — el control muestra lo que se sembro (R10, R13)", () => {
  it("R10/R3 — un `dateRange` sembrado por ATAJO se pinta con la etiqueta de ese atajo", () => {
    parametros = new URLSearchParams("periodo=corto,,");

    const { onChange } = montar([PERIODO]);

    expect(ultima(onChange)).toEqual({ periodo: ["corto", "", ""] });
    const grupo = screen.getByRole("group", { name: "Periodo" });
    expect(within(grupo).getByRole("button", { name: "Periodo" })).toHaveTextContent(
      "Plazo corto",
    );
  });

  it("R10/R3 — un `dateRange` sembrado por RANGO se pinta con ese rango, no vacio", () => {
    parametros = new URLSearchParams("periodo=,2026-07-01,2026-07-28");

    const { onChange } = montar([PERIODO]);

    expect(ultima(onChange)).toEqual({ periodo: ["", "2026-07-01", "2026-07-28"] });
    const grupo = screen.getByRole("group", { name: "Periodo" });
    // La X de limpiar solo existe cuando el control TIENE un rango elegido, asi que su
    // presencia dice que el control no se pinto vacio sin depender del formato de fecha.
    expect(
      within(grupo).getByRole("button", { name: "Limpiar Periodo" }),
    ).toBeInTheDocument();
    expect(
      within(grupo).getByRole("button", { name: "Periodo" }),
    ).not.toHaveTextContent("Cualquier fecha");
  });

  it("R13/R3 — un `text` sembrado aparece ESCRITO en el campo", () => {
    parametros = new URLSearchParams("nota=hola, mundo");

    const { onChange } = montar([NOTA]);

    expect(ultima(onChange)).toEqual({ nota: ["hola, mundo"] });
    expect(
      (screen.getByRole("searchbox", { name: "Nota" }) as HTMLInputElement).value,
    ).toBe("hola, mundo");
  });

  it("R13/R3 — un `text` declarado DESPUES del montaje tambien aparece escrito", async () => {
    parametros = new URLSearchParams("nota=llego tarde");

    const { onChange, volverAMontar } = montar([]);
    volverAMontar([NOTA]);

    await waitFor(() => expect(ultima(onChange)).toEqual({ nota: ["llego tarde"] }));
    expect(
      (screen.getByRole("searchbox", { name: "Nota" }) as HTMLInputElement).value,
    ).toBe("llego tarde");
  });
});
