// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// FICHA 453 / T3.1 — `siembra`: IMPONER EL TERMINO DESDE FUERA sin remontar la barra.
//
// Es el hueco 1 de la ficha 328, y esta ficha lo arrastra porque sin el una vista con termino de
// busqueda NO SE PUEDE APLICAR: hasta hoy el campo nacia de un `useState` con lo que traia la URL
// y la unica via desde fuera era remontar con `key`, que relee la query y tira el foco.
//
// Los casos que de verdad valen no son «el texto cambia» —eso lo veria cualquiera— sino los dos
// que fallan EN SILENCIO si la costura se hace a medias:
//   (a) que el campo sea EL MISMO nodo (no remontado), que es la queja literal de la 328; y
//   (b) que `emitido.current` quede al dia, o la guarda de «sin cambio» miente y el siguiente
//       gesto real del usuario —vaciar el campo— no llega nunca al consumidor.

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ordenes",
  useSearchParams: () => new URLSearchParams(),
}));

import { olvidarParamsBorrados } from "@/hooks/useFiltrosUrl";
import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";

beforeEach(() => {
  replaceMock.mockClear();
  olvidarParamsBorrados();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function campo(): HTMLInputElement {
  return screen.getByRole("searchbox", { name: "Buscar" }) as HTMLInputElement;
}

/** La barra con la prop nueva, lista para que el caso mueva la señal a mano. */
function montar(opciones: { debounceMs?: number } = {}) {
  const onChange = vi.fn();
  const debounceMs = opciones.debounceMs ?? 0;
  const vista = render(
    <BuscadorFiltros
      onChange={onChange}
      debounceMs={debounceMs}
      siembra={{ senal: 0, termino: "" }}
    />,
  );
  const sembrar = (senal: number, termino: string) =>
    vista.rerender(
      <BuscadorFiltros
        onChange={onChange}
        debounceMs={debounceMs}
        siembra={{ senal, termino }}
      />,
    );
  return { onChange, sembrar };
}

describe("BuscadorFiltros — la siembra pone el termino desde fuera (T3.1)", () => {
  it("cambiar la señal deja el campo con el termino sembrado", () => {
    const { sembrar } = montar();
    expect(campo().value).toBe("");

    sembrar(1, "san jose arriba");

    expect(campo().value).toBe("san jose arriba");
  });

  it("EL CAMPO NO SE REMONTA: es el mismo nodo y conserva el foco", () => {
    const { sembrar } = montar();
    const antes = campo();
    antes.focus();
    expect(document.activeElement).toBe(antes);

    sembrar(1, "guia123");

    // La misma referencia de nodo: si la barra se remontara —el truco de la `key` que esta
    // costura viene a retirar— seria otro elemento y el foco estaria en el `body`.
    expect(campo()).toBe(antes);
    expect(document.activeElement).toBe(antes);
    expect(campo().value).toBe("guia123");
  });

  it("sembrar «» vacia el campo desde fuera", () => {
    const { sembrar } = montar();
    fireEvent.change(campo(), { target: { value: "algo" } });
    expect(campo().value).toBe("algo");

    sembrar(1, "");

    expect(campo().value).toBe("");
  });

  it("la siembra NO emite: quien la impuso ya sabe lo que puso", () => {
    const { onChange, sembrar } = montar();

    sembrar(1, "guia123");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("la MISMA señal dos veces no toca el campo: es una señal, no un valor", () => {
    const { sembrar } = montar();
    sembrar(1, "primero");
    fireEvent.change(campo(), { target: { value: "lo que escribio la persona" } });

    sembrar(1, "segundo");

    expect(campo().value).toBe("lo que escribio la persona");
  });

  it("al MONTAR no siembra: la siembra es un CAMBIO de señal", () => {
    const onChange = vi.fn();
    render(
      <BuscadorFiltros
        onChange={onChange}
        debounceMs={0}
        siembra={{ senal: 7, termino: "no deberia aparecer" }}
      />,
    );

    expect(campo().value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("BuscadorFiltros — la siembra deja la guarda de «sin cambio» DICIENDO LA VERDAD", () => {
  it("vaciar el campo despues de sembrar SI avisa al consumidor", () => {
    // El caso que mata la costura a medias. Sin poner al dia `emitido.current`, la barra cree
    // que lo aplicado sigue siendo «» —lo de antes de la siembra—, la guarda corta y el
    // consumidor nunca se entera de que el usuario vacio el campo: el listado se queda
    // filtrando por un termino que ya no esta escrito en ningun sitio.
    const { onChange, sembrar } = montar();
    sembrar(1, "guia123");
    onChange.mockClear();

    fireEvent.change(campo(), { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("teclear otra cosa despues de sembrar emite el termino nuevo", () => {
    const { onChange, sembrar } = montar();
    sembrar(1, "guia123");
    onChange.mockClear();

    fireEvent.change(campo(), { target: { value: "guia999" } });

    expect(onChange).toHaveBeenCalledWith("guia999");
  });

  it("volver a teclear EXACTAMENTE lo sembrado no emite nada", () => {
    const { onChange, sembrar } = montar();
    sembrar(1, "guia123");
    onChange.mockClear();

    fireEvent.change(campo(), { target: { value: "guia123" } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("una emision en vuelo NO pisa lo sembrado medio segundo despues", () => {
    vi.useFakeTimers();
    const { onChange, sembrar } = montar({ debounceMs: 300 });
    fireEvent.change(campo(), { target: { value: "lo viejo" } });

    sembrar(1, "lo nuevo");
    vi.advanceTimersByTime(1000);

    // Sin cancelar el temporizador, el consumidor recibiria «lo viejo» DESPUES de haber
    // aplicado la vista: el listado cambiaria solo, sin que nadie lo pidiera.
    expect(onChange).not.toHaveBeenCalled();
    expect(campo().value).toBe("lo nuevo");
  });
});

describe("BuscadorFiltros — SIN la prop, la barra es exactamente la de antes (R31)", () => {
  it("no emite al montar, no monta ningun control nuevo y el campo sigue siendo suyo", () => {
    const onChange = vi.fn();
    const vista = render(<BuscadorFiltros onChange={onChange} debounceMs={0} />);

    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(campo(), { target: { value: "hola" } });
    expect(onChange).toHaveBeenCalledWith("hola");

    // Un re-render del consumidor sin la prop no repone ni vacia nada: lo escrito se queda.
    vista.rerender(<BuscadorFiltros onChange={onChange} debounceMs={0} />);
    expect(campo().value).toBe("hola");
  });
});
