// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// FICHA 453 / T3.2 — `siembra`: IMPONER LA SELECCION DESDE FUERA.
//
// El gemelo del hueco 1 de la 328 en el orquestador. `FilterComponent` es dueño de su seleccion
// —la inicializa desde la URL y solo la cambian `fijar` y `limpiarTodo`—, asi que hasta hoy la
// unica via desde fuera era remontarlo entero con `key`, el truco que dos pantallas del repo
// tienen escrito como bloqueo.
//
// Los filtros son de FANTASIA, como en el resto de tests de este componente: si para escribir un
// caso hiciera falta nombrar una zona o un mensajero de verdad, la logica estaria en el sitio
// equivocado.
//
// EL CASO QUE NO PUEDE FALTAR es el ultimo: un catalogo que llega DESPUES de la siembra no repone
// lo que traia la URL (R23). Sin ese cierre, el listado cambiaria solo medio segundo despues de
// aplicar una vista, y seria un fallo mudo de libro.

let parametros = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fantasia",
  useSearchParams: () => parametros,
}));

import {
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

/** El mismo filtro ANTES de que llegue su catalogo: declarado y sin una sola opcion. */
const COLOR_SIN_CATALOGO: FilterDef = { ...COLOR, options: [] };

const RANGO_CORTO = { desde: "2026-07-20", hasta: "2026-07-24" };

const PERIODO: FilterDef = {
  key: "periodo",
  label: "Periodo",
  kind: "dateRange",
  options: [{ value: "corto", label: "Plazo corto", defaultRange: RANGO_CORTO }],
};

const NOTA: FilterDef = { key: "nota", label: "Nota", kind: "text" };

const ACABADO: FilterDef = {
  key: "acabado",
  label: "Acabado",
  kind: "single",
  options: [
    { value: "mate", label: "Mate" },
    { value: "brillo", label: "Brillo" },
  ],
};

beforeEach(() => {
  parametros = new URLSearchParams();
});

afterEach(() => {
  cleanup();
});

function montar(filters: FilterDef[]) {
  const onChange = vi.fn();
  const vista = render(
    <FilterComponent
      filters={filters}
      onChange={onChange}
      debounceMs={0}
      siembra={{ senal: 0, seleccion: {} }}
    />,
  );
  const sembrar = (
    senal: number,
    seleccion: FilterSelection,
    siguientes: FilterDef[] = filters,
  ) =>
    vista.rerender(
      <FilterComponent
        filters={siguientes}
        onChange={onChange}
        debounceMs={0}
        siembra={{ senal, seleccion }}
      />,
    );
  const redeclarar = (siguientes: FilterDef[], senal: number, seleccion: FilterSelection) =>
    vista.rerender(
      <FilterComponent
        filters={siguientes}
        onChange={onChange}
        debounceMs={0}
        siembra={{ senal, seleccion }}
      />,
    );
  return { onChange, sembrar, redeclarar };
}

/** Ultima seleccion emitida (`undefined` si no hubo ninguna emision). */
function ultima(onChange: ReturnType<typeof vi.fn>): FilterSelection | undefined {
  return onChange.mock.calls.at(-1)?.[0] as FilterSelection | undefined;
}

async function marcada(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  opcion: string,
): Promise<string | null> {
  const abierto = screen.queryByRole("listbox", { name: label });
  const lista =
    abierto ??
    (await (async () => {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${label}:`) }));
      return screen.getByRole("listbox", { name: label });
    })());
  return within(lista).getByRole("option", { name: opcion }).getAttribute("aria-selected");
}

describe("FilterComponent — la siembra repone lo guardado en los controles (T3.2)", () => {
  it("deja MOSTRANDO lo sembrado tanto el `multi` (controlado) como el `dateRange` (no controlado)", async () => {
    const user = userEvent.setup();
    const { sembrar } = montar([COLOR, PERIODO]);

    sembrar(1, { color: ["rojo", "azul"], periodo: ["corto", "", ""] });

    expect(await marcada(user, "Color", "Rojo")).toBe("true");
    expect(await marcada(user, "Color", "Azul")).toBe("true");
    expect(await marcada(user, "Color", "Verde")).toBe("false");
    // El `dateRange` es dueño de lo que enseña (`defaultRange` en un inicializador): sin
    // rekearlo, el filtro quedaria aplicado y el disparador diria «Cualquier fecha», que es la
    // pantalla mintiendo sobre lo que esta puesto.
    expect(
      screen.getByRole("button", { name: "Periodo" }).textContent,
    ).toContain("Plazo corto");
  });

  it("el `text` (no controlado) tambien muestra lo sembrado", () => {
    const { sembrar } = montar([NOTA]);

    sembrar(1, { nota: ["pendiente de cobro"] });

    expect((screen.getByRole("searchbox", { name: "Nota" }) as HTMLInputElement).value).toBe(
      "pendiente de cobro",
    );
  });

  it("REEMPLAZA la seleccion vigente, no la mezcla (R19)", async () => {
    const user = userEvent.setup();
    const { sembrar } = montar([COLOR, ACABADO]);
    // Algo puesto por la persona antes de aplicar la vista.
    await user.click(screen.getByRole("button", { name: /^Color:/ }));
    await user.click(
      within(screen.getByRole("listbox", { name: "Color" })).getByRole("option", {
        name: "Verde",
      }),
    );
    expect(await marcada(user, "Color", "Verde")).toBe("true");

    sembrar(1, { acabado: ["mate"] });

    expect(await marcada(user, "Color", "Verde")).toBe("false");
    expect(
      screen.getByRole("combobox", { name: "Acabado" }).textContent,
    ).toContain("Mate");
  });

  it("la siembra NO emite `onChange`: quien la impuso ya conoce la seleccion", () => {
    const { onChange, sembrar } = montar([COLOR]);

    sembrar(1, { color: ["rojo"] });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("al MONTAR no siembra: la siembra es un CAMBIO de señal", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterComponent
        filters={[COLOR]}
        onChange={onChange}
        debounceMs={0}
        siembra={{ senal: 4, seleccion: { color: ["rojo"] } }}
      />,
    );

    expect(await marcada(user, "Color", "Rojo")).toBe("false");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FilterComponent — la siembra CIERRA la siembra de la URL (R23)", () => {
  it("un catalogo que llega DESPUES no repone el valor que traia la direccion", async () => {
    const user = userEvent.setup();
    // Se entra por `?color=rojo` con el catalogo de color todavia sin resolver: la clave queda
    // PENDIENTE y el componente la reintenta en cuanto aparecen opciones. Ese reintento es lo
    // que la siembra tiene que cerrar.
    parametros = new URLSearchParams("color=rojo");
    const { onChange, redeclarar } = montar([COLOR_SIN_CATALOGO, ACABADO]);
    expect(onChange).not.toHaveBeenCalled();

    redeclarar([COLOR_SIN_CATALOGO, ACABADO], 1, { acabado: ["mate"] });
    // Y AHORA llega el catalogo.
    redeclarar([COLOR, ACABADO], 1, { acabado: ["mate"] });

    expect(await marcada(user, "Color", "Rojo")).toBe("false");
    // Ni una emision con `color`: ni al llegar el catalogo ni despues.
    for (const [seleccion] of onChange.mock.calls as [FilterSelection][]) {
      expect(seleccion.color).toBeUndefined();
    }
  });

  it("CONTRASTE — sin siembra, ese mismo catalogo tardio SI repone lo de la URL", async () => {
    const user = userEvent.setup();
    parametros = new URLSearchParams("color=rojo");
    const onChange = vi.fn();
    const vista = render(
      <FilterComponent filters={[COLOR_SIN_CATALOGO]} onChange={onChange} debounceMs={0} />,
    );

    vista.rerender(
      <FilterComponent filters={[COLOR]} onChange={onChange} debounceMs={0} />,
    );

    // Este es el comportamiento de la ficha 339 y NO se toca: es el par que demuestra que el
    // caso de arriba mide el cierre y no la ausencia de reintento.
    expect(await marcada(user, "Color", "Rojo")).toBe("true");
    expect(ultima(onChange)).toEqual({ color: ["rojo"] });
  });
});

describe("FilterComponent — SIN la prop, el orquestador es el de antes (R31)", () => {
  it("no remonta ningun control ni cambia la seleccion al re-renderizar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const vista = render(
      <FilterComponent filters={[COLOR, NOTA]} onChange={onChange} debounceMs={0} />,
    );
    const nota = screen.getByRole("searchbox", { name: "Nota" });
    await user.type(nota, "hola");

    vista.rerender(
      <FilterComponent filters={[COLOR, NOTA]} onChange={onChange} debounceMs={0} />,
    );

    // Mismo nodo: sin la prop la `key` de los no controlados es la de siempre, literalmente la
    // misma cadena, asi que no se remonta nada.
    expect(screen.getByRole("searchbox", { name: "Nota" })).toBe(nota);
    expect((nota as HTMLInputElement).value).toBe("hola");
    expect(ultima(onChange)).toEqual({ nota: ["hola"] });
  });
});
