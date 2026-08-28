// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";

import { DEBOUNCE_MS_DEFAULT } from "@/components/shared/FilterComponent";
import { BUSQUEDA_MIN_CHARS } from "@/lib/types/orden";
import { HistoricoConversacionesModule } from "@/app/(app)/historico/conversaciones/_components/HistoricoConversacionesModule";
import {
  ETIQUETA_BUSCADOR,
  HistoricoFiltrosBar,
} from "@/app/(app)/historico/conversaciones/_components/HistoricoFiltrosBar";
import { PLACEHOLDER_BUSQUEDA } from "@/app/(app)/historico/conversaciones/_components/historico-filtros-def";

import {
  AHORA,
  hilo,
  instalarObservador,
  okHilos,
  okMensajes,
  renderHistorico,
} from "./_historico-harness";

// Feature 321 / T5.3 (R32/R37) — la BARRA DE FILTROS, montada en la pantalla.
//
// Lo que estos casos protegen no es que la barra exista, sino que sea LA MISMA barra del resto
// del repo: `BuscadorFiltros` como contenedor (campo + selector «Filtros») y `FilterComponent`
// para los controles que se piden. Una barra propia habría pasado un test de «hay un input»;
// aquí se afirma el ARIA que sólo produce esa pareja: `role="searchbox"` con el nombre
// accesible del contenedor y un `role="listbox"` con las opciones del selector.
//
// Y R37 se afirma por COMPORTAMIENTO, no leyendo `minChars`: se teclea por debajo del mínimo y
// se comprueba que NO se emite nada y que el aviso aparece. Cambiar el `3` por otro número
// rompe el caso; reescribir el comentario que lo explica, no.

const MENSAJEROS = [
  { id: "m1", nombre: "Ana Mora", zonaId: null },
  { id: "m2", nombre: "Luis Vargas", zonaId: null },
];

const listarHilos = vi.fn(async () => okHilos([hilo()]));
const listarMensajes = vi.fn(async () => okMensajes([]));

beforeEach(() => {
  instalarObservador();
  listarHilos.mockClear();
  listarMensajes.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPantalla() {
  return renderHistorico(
    <HistoricoConversacionesModule
      mensajeros={MENSAJEROS}
      acciones={{ listarHilos, listarMensajes }}
      ahora={AHORA}
    />,
  );
}

describe("T5.3 — la barra de filtros del histórico está montada en la pantalla (R32)", () => {
  it("monta el campo de búsqueda de `BuscadorFiltros`, con su nombre accesible y su placeholder", async () => {
    renderPantalla();

    const campo = await screen.findByRole("searchbox", { name: ETIQUETA_BUSCADOR });
    expect(campo).toBeInTheDocument();
    expect(campo).toHaveAttribute("placeholder", PLACEHOLDER_BUSQUEDA);
  });

  it("el selector «Filtros» ofrece Mensajero, Fecha y Orden en un listbox", async () => {
    renderPantalla();

    fireEvent.click(await screen.findByRole("button", { name: /filtros/i }));

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: /mensajero/i })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /fecha/i })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /orden/i })).toBeInTheDocument();
  });

  // La búsqueda libre es EL CAMPO de la barra, no un filtro que se pide: si apareciera también
  // en el selector, el usuario tendría dos sitios para lo mismo y el segundo emitiría por otro
  // camino.
  it("la búsqueda libre NO se ofrece además como filtro del selector", async () => {
    renderPantalla();

    fireEvent.click(await screen.findByRole("button", { name: /filtros/i }));

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(3);
    expect(within(listbox).queryByRole("option", { name: /^buscar$/i })).toBeNull();
  });

  it("el control de mensajero se monta con las opciones del catálogo pre-cargado (R33)", async () => {
    renderPantalla();

    fireEvent.click(await screen.findByRole("button", { name: /filtros/i }));
    const opcion = await screen.findByRole("option", { name: /mensajero/i });
    fireEvent.click(opcion);
    fireEvent.keyDown(opcion, { key: "Escape" });

    expect(
      await screen.findByRole("button", { name: /mensajero/i }),
    ).toBeInTheDocument();
  });
});

describe("T5.3 — el mínimo de caracteres del campo (R37)", () => {
  /** Teclea en el campo y devuelve el control, ya re-renderizado. */
  async function teclear(texto: string) {
    const campo = screen.getByRole("searchbox", { name: ETIQUETA_BUSCADOR });
    fireEvent.change(campo, { target: { value: texto } });
    await screen.findByRole("searchbox", { name: ETIQUETA_BUSCADOR });
  }

  function renderBarra(onBuscar: (t: string) => void) {
    return renderHistorico(
      <HistoricoFiltrosBar
        mensajeros={MENSAJEROS}
        onBuscar={onBuscar}
        onFiltrosChange={vi.fn()}
        ahora={AHORA}
      />,
    );
  }

  it("con «ma» NO emite el término y avisa de cuántos caracteres faltan", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onBuscar = vi.fn();
    renderBarra(onBuscar);

    await teclear("ma");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(onBuscar).not.toHaveBeenCalled();
    expect(
      screen.getByText(`Escribe al menos ${BUSQUEDA_MIN_CHARS} caracteres para buscar`),
    ).toBeInTheDocument();
  });

  it("con «mar» emite el término tras el debounce", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onBuscar = vi.fn();
    renderBarra(onBuscar);

    await teclear("mar");
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS_DEFAULT + 1);
    });

    expect(onBuscar).toHaveBeenCalledWith("mar");
  });
});
