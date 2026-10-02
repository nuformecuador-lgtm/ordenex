// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// =================================================================================================
// FICHA 463 (R22, revisión m4) — la PRECARGA DE LA URL de `FilterComponent`, con y sin el modo
// «Aplicar».
//
//  - SIN `aplicarConBoton` la precarga se emite como siempre: por `emitir`, con su debounce. Ni antes
//    ni dos veces (R22: ausente la prop, el orquestador es exactamente el de antes).
//  - CON `aplicarConBoton` lo que trajo la URL ya ES lo aplicado: se avisa una vez y en el acto.
//
// La mutación M5 de la revisión (emitir la precarga en el acto también fuera del modo «Aplicar»)
// pone rojo el primer caso: la emisión llegaría antes de vencer la espera.
//
// El mock de `next/navigation` es el de `filter-component-url.test.tsx`; los filtros, de fantasía.
// =================================================================================================

/** La URL de la prueba. `let` porque cada caso entra por una dirección distinta. */
let parametros = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/fantasia",
  useSearchParams: () => parametros,
}));

import { BOOLEAN_MARCADO, FilterComponent, type FilterDef } from "@/components/shared/FilterComponent";

const DESTACADO: FilterDef = { key: "destacado", label: "Destacado", kind: "boolean" };

beforeEach(() => {
  parametros = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("463 R22 — la precarga de la URL SIN `aplicarConBoton` sigue el camino de siempre", () => {
  it("se emite UNA vez, con la selección de la URL, al vencer el debounce (no en el acto)", () => {
    vi.useFakeTimers();
    parametros = new URLSearchParams("destacado=true");
    const onChange = vi.fn();

    render(<FilterComponent filters={[DESTACADO]} onChange={onChange} debounceMs={500} />);

    // Montado y con los efectos corridos: nada todavía.
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(499));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(onChange.mock.calls).toEqual([[{ destacado: [BOOLEAN_MARCADO] }]]);
    act(() => vi.advanceTimersByTime(2000));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("CON `aplicarConBoton` la misma URL se avisa una vez y en el acto (ya es lo aplicado)", () => {
    vi.useFakeTimers();
    parametros = new URLSearchParams("destacado=true");
    const onChange = vi.fn();

    render(
      <FilterComponent filters={[DESTACADO]} onChange={onChange} debounceMs={500} aplicarConBoton={{}} />,
    );

    expect(onChange.mock.calls).toEqual([[{ destacado: [BOOLEAN_MARCADO] }]]);
    act(() => vi.advanceTimersByTime(2000));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
