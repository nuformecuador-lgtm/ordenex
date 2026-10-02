// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  FilterComponent,
  mismaSeleccion,
  type FilterDef,
  type FilterSelection,
} from "@/components/shared/FilterComponent";
import { diaDelMesActual, elegirPeriodo } from "@/tests/fixtures/periodo-calendario";

// =================================================================================================
// FICHA 463 (T5, design §5.1) — el MODO «APLICAR» de `FilterComponent` (hueco 2 de la ficha 328).
//
//  - R21: con `aplicarConBoton`, editar los controles NO emite; pulsar «Aplicar» emite UNA vez, en el
//    acto y sin debounce.
//  - R17: «Aplicar» deshabilitado mientras el borrador es igual a lo aplicado.
//  - R18: un rango con «Desde» posterior a «Hasta» deshabilita «Aplicar», lo avisa y no emite.
//  - R19: «Quitar» vacía lo aplicado y emite `{}` en el acto.
//  - `siembra` en modo «Aplicar» deja el botón en reposo (lo impuesto ES lo aplicado).
//  - R22: SIN la prop, la secuencia de emisiones es la de siempre (debounce, una emisión por racha).
//
// Filtros de FANTASÍA, como el resto de los tests del orquestador: el componente no sabe de wallets.
// =================================================================================================

const PERIODO: FilterDef = { key: "periodo", label: "Periodo", kind: "dateRange" };
const DESTACADO: FilterDef = { key: "destacado", label: "Destacado", kind: "boolean" };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function montarAplicar(props: Partial<React.ComponentProps<typeof FilterComponent>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <FilterComponent
      filters={[PERIODO]}
      onChange={onChange}
      leerDeUrl={false}
      aplicarConBoton={{}}
      {...props}
    />,
  );
  return { onChange, ...utils };
}

describe("463 R21 — en modo «Aplicar» editar no emite; «Aplicar» emite una vez y en el acto", () => {
  it("elegir el rango en el calendario no avisa; pulsar «Aplicar» avisa UNA vez con el rango", async () => {
    const user = userEvent.setup();
    const { onChange, container } = montarAplicar();

    await elegirPeriodo(user, container, 1, 28);
    expect(onChange).not.toHaveBeenCalled();
    // Y tampoco cuando vence la espera del modo de siempre (500 ms): editar NO programa ninguna emisión.
    await new Promise((r) => setTimeout(r, 700));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    // Sin debounce: la emisión ya está aquí, sin esperar ningún temporizador.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ periodo: ["", diaDelMesActual(1), diaDelMesActual(28)] });
  });

  it("con un debounce largo declarado, «Aplicar» sigue emitiendo en el acto (el debounce es del modo de siempre)", async () => {
    const user = userEvent.setup();
    const { onChange, container } = montarAplicar({ debounceMs: 60_000 });
    await elegirPeriodo(user, container, 1, 28);
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("con `debounceMs={0}` tampoco: editar sigue sin emitir en modo «Aplicar»", async () => {
    const user = userEvent.setup();
    const { onChange, container } = montarAplicar({ debounceMs: 0 });
    await elegirPeriodo(user, container, 1, 28);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("463 R17 — «Aplicar» deshabilitado con el borrador igual a lo aplicado", () => {
  it("nace deshabilitado; se habilita al editar; tras aplicar vuelve a deshabilitarse", async () => {
    const user = userEvent.setup();
    const { container } = montarAplicar();
    const aplicar = () => screen.getByRole("button", { name: "Aplicar" });
    expect(aplicar()).toBeDisabled();

    await elegirPeriodo(user, container, 1, 28);
    expect(aplicar()).toBeEnabled();

    await user.click(aplicar());
    expect(aplicar()).toBeDisabled();
  });

  it("volver a dejar el borrador igual a lo aplicado lo deshabilita otra vez", async () => {
    const user = userEvent.setup();
    const { container } = montarAplicar();
    await elegirPeriodo(user, container, 1, 28);
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    // Se quita el rango (X del control) y se vuelve a poner el mismo.
    await user.click(screen.getByRole("button", { name: "Limpiar Periodo" }));
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeEnabled();
    await elegirPeriodo(user, container, 1, 28);
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
  });

  it("`mismaSeleccion` compara por claves y valores, no por identidad", () => {
    const a: FilterSelection = { x: ["1", "2"], y: ["a"] };
    expect(mismaSeleccion(a, { y: ["a"], x: ["1", "2"] })).toBe(true);
    expect(mismaSeleccion(a, { x: ["1", "2"] })).toBe(false);
    expect(mismaSeleccion(a, { x: ["2", "1"], y: ["a"] })).toBe(false);
    expect(mismaSeleccion({}, {})).toBe(true);
  });
});

describe("463 R18 — «Desde» posterior a «Hasta»: no se aplica y se avisa", () => {
  it("un rango invertido (llegado por siembra) deja «Aplicar» deshabilitado, lo avisa y no emite", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterComponent filters={[PERIODO]} onChange={onChange} leerDeUrl={false} aplicarConBoton={{}} />,
    );
    // Con el calendario no se puede elegir un rango invertido (ordena los extremos solo): la única vía
    // por la que llega es una siembra, y es lo que se mide.
    rerender(
      <FilterComponent
        filters={[PERIODO]}
        onChange={onChange}
        leerDeUrl={false}
        aplicarConBoton={{}}
        siembra={{ senal: 1, seleccion: { periodo: ["", "2026-09-20", "2026-09-10"] } }}
      />,
    );
    const aplicar = screen.getByRole("button", { name: "Aplicar" });
    expect(aplicar).toBeDisabled();
    expect(screen.getByText("«Desde» no puede ser posterior a «Hasta».")).toHaveAttribute("role", "status");
    expect(aplicar).toHaveAttribute("aria-describedby");
    fireEvent.click(aplicar);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("el aviso se puede redactar por el consumidor", () => {
    render(
      <FilterComponent
        filters={[PERIODO]}
        onChange={vi.fn()}
        leerDeUrl={false}
        aplicarConBoton={{ avisoRangoInvertido: "Revisá las fechas." }}
        siembra={{ senal: 1, seleccion: { periodo: ["", "2026-09-20", "2026-09-10"] } }}
      />,
    );
    expect(screen.getByText("Revisá las fechas.")).toBeInTheDocument();
  });
});

describe("463 R19 — «Quitar» vacía lo aplicado y emite `{}` en el acto", () => {
  it("solo aparece con algo aplicado; al pulsarlo emite `{}` una vez y el control vuelve a «Cualquier fecha»", async () => {
    const user = userEvent.setup();
    const { onChange, container } = montarAplicar({ aplicarConBoton: { etiquetaQuitar: "Quitar periodo" } });
    expect(screen.queryByRole("button", { name: "Quitar periodo" })).toBeNull();

    await elegirPeriodo(user, container, 1, 28);
    expect(screen.queryByRole("button", { name: "Quitar periodo" })).toBeNull(); // aún no está APLICADO
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    onChange.mockClear();

    await user.click(screen.getByRole("button", { name: "Quitar periodo" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({});
    expect(screen.getByRole("button", { name: "Periodo" })).toHaveTextContent("Cualquier fecha");
    expect(screen.queryByRole("button", { name: "Quitar periodo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
  });
});

describe("463 — `siembra` en modo «Aplicar» deja el botón en reposo", () => {
  it("lo sembrado es borrador Y aplicado: «Aplicar» deshabilitado, «Quitar» disponible, sin emitir", () => {
    const onChange = vi.fn();
    render(
      <FilterComponent
        filters={[PERIODO]}
        onChange={onChange}
        leerDeUrl={false}
        aplicarConBoton={{}}
        siembra={{ senal: 1, seleccion: { periodo: ["", "2026-09-01", "2026-09-15"] } }}
      />,
    );
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quitar" })).toBeEnabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("463 R22 — SIN `aplicarConBoton`, las emisiones son exactamente las de antes", () => {
  it("con debounce: una racha de cambios da UNA emisión, la del estado final, al cumplirse la espera", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<FilterComponent filters={[DESTACADO]} onChange={onChange} leerDeUrl={false} debounceMs={500} />);
    const casilla = screen.getByRole("checkbox");

    fireEvent.click(casilla); // marcado
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(casilla); // desmarcado
    act(() => vi.advanceTimersByTime(200));
    fireEvent.click(casilla); // marcado otra vez
    act(() => vi.advanceTimersByTime(499));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(onChange.mock.calls).toEqual([[{ destacado: ["true"] }]]);
    // Ni botón «Aplicar» ni «Quitar»: el modo no se activa solo.
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quitar" })).toBeNull();
  });

  it("sin debounce: cada cambio emite en el acto, como siempre", () => {
    const onChange = vi.fn();
    render(<FilterComponent filters={[DESTACADO]} onChange={onChange} leerDeUrl={false} debounceMs={0} />);
    const casilla = screen.getByRole("checkbox");
    fireEvent.click(casilla);
    fireEvent.click(casilla);
    expect(onChange.mock.calls).toEqual([[{ destacado: ["true"] }], [{}]]);
  });
});
