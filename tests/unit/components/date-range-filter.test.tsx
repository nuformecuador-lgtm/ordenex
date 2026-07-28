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

import { DateRangeFilter } from "@/components/shared/DateRangeFilter";

// Feature 144 / TA.3 (R8-R12, R19, R21) — control de rango de fechas con atajos.
// BLOQUE A: sin dominio. Los atajos son de FANTASIA (no hay presets de ordenes) y el
// control no sabe que significan: los emite tal cual los declaro el consumidor (R5).

const ATAJOS = [
  { value: "corto", label: "Plazo corto" },
  { value: "largo", label: "Plazo largo" },
];

function renderControl(props: Partial<Parameters<typeof DateRangeFilter>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <DateRangeFilter
      label="Periodo"
      shortcuts={ATAJOS}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

function ponerFecha(nombre: "Desde" | "Hasta", valor: string) {
  fireEvent.change(screen.getByLabelText(nombre), { target: { value: valor } });
}

/** Ultima terna emitida. */
function ultima(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
}

afterEach(() => cleanup());

describe("DateRangeFilter — dos extremos y atajos en UN control (R8, R9)", () => {
  it("R8: ofrece los dos extremos del rango, fijables por separado", () => {
    const onChange = renderControl();

    ponerFecha("Desde", "2026-07-01");
    expect(ultima(onChange)).toEqual(["", "2026-07-01", ""]);

    ponerFecha("Hasta", "2026-07-28");
    expect(ultima(onChange)).toEqual(["", "2026-07-01", "2026-07-28"]);
  });

  it("R8: los extremos son fechas de CALENDARIO (inputs `type=date`), no instantes", () => {
    renderControl();
    expect(screen.getByLabelText("Desde")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("type", "date");
  });

  it("R9: los atajos se ofrecen DENTRO del mismo filtro, sin control adicional", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole("combobox", { name: "Periodo" }));
    const lista = await screen.findByRole("listbox");
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Plazo corto",
      "Plazo largo",
    ]);
  });

  it("R9: sin atajos declarados el control sigue operando solo con desde/hasta", () => {
    const onChange = renderControl({ shortcuts: [] });
    expect(screen.queryByRole("combobox")).toBeNull();
    ponerFecha("Desde", "2026-07-01");
    expect(ultima(onChange)).toEqual(["", "2026-07-01", ""]);
  });
});

describe("DateRangeFilter — exclusion mutua atajo/rango (R10)", () => {
  it("R10: elegir un atajo VACIA los dos extremos del rango", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    ponerFecha("Desde", "2026-07-01");
    ponerFecha("Hasta", "2026-07-28");

    await user.click(screen.getByRole("combobox", { name: "Periodo" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Plazo corto",
      }),
    );

    expect(ultima(onChange)).toEqual(["corto", "", ""]);
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByLabelText("Hasta")).toHaveValue("");
  });

  it("R10: fijar un extremo VACIA el atajo elegido", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await user.click(screen.getByRole("combobox", { name: "Periodo" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Plazo largo",
      }),
    );
    expect(ultima(onChange)).toEqual(["largo", "", ""]);

    ponerFecha("Hasta", "2026-07-28");
    expect(ultima(onChange)).toEqual(["", "", "2026-07-28"]);
  });

  it("R10: la combinacion atajo + rango NUNCA llega a emitirse", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    ponerFecha("Desde", "2026-07-01");
    await user.click(screen.getByRole("combobox", { name: "Periodo" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Plazo corto",
      }),
    );
    ponerFecha("Hasta", "2026-07-28");

    for (const [terna] of onChange.mock.calls) {
      const [atajo, desde, hasta] = terna as [string, string, string];
      expect(atajo !== "" && (desde !== "" || hasta !== "")).toBe(false);
    }
  });
});

describe("DateRangeFilter — forma de la salida (R11, R19)", () => {
  it("R11/R19: solo `desde` -> `[\"\",\"D\",\"\"]` (rango abierto por arriba)", () => {
    const onChange = renderControl();
    ponerFecha("Desde", "2026-07-01");
    expect(ultima(onChange)).toEqual(["", "2026-07-01", ""]);
  });

  it("R11/R19: solo `hasta` -> `[\"\",\"\",\"H\"]` (rango abierto por abajo)", () => {
    const onChange = renderControl();
    ponerFecha("Hasta", "2026-07-28");
    expect(ultima(onChange)).toEqual(["", "", "2026-07-28"]);
  });

  it("R19: la terna NUNCA se compacta: siempre son 3 posiciones", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await user.click(screen.getByRole("combobox", { name: "Periodo" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Plazo corto",
      }),
    );
    ponerFecha("Desde", "2026-07-01");

    for (const [terna] of onChange.mock.calls) {
      expect(terna).toHaveLength(3);
    }
  });

  it("R5: emite el valor del atajo TAL CUAL lo declaro el consumidor, sin decorarlo", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await user.click(screen.getByRole("combobox", { name: "Periodo" }));
    await user.click(
      within(await screen.findByRole("listbox")).getByRole("option", {
        name: "Plazo largo",
      }),
    );
    expect(ultima(onChange)).toEqual(["largo", "", ""]);
  });
});

describe("DateRangeFilter — rango invertido (R12)", () => {
  it("R12: con `desde` posterior a `hasta` NO se emite esa combinacion", () => {
    const onChange = renderControl();

    ponerFecha("Hasta", "2026-07-01");
    onChange.mockClear();
    ponerFecha("Desde", "2026-07-28");

    expect(onChange).not.toHaveBeenCalled();
  });

  it("R12: el rango invertido se SEÑALA como invalido", () => {
    renderControl();
    ponerFecha("Hasta", "2026-07-01");
    ponerFecha("Desde", "2026-07-28");

    expect(screen.getByLabelText("Desde")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("R12: los extremos se acotan entre si (`min`/`max` cruzados)", () => {
    renderControl();
    ponerFecha("Desde", "2026-07-01");
    expect(screen.getByLabelText("Hasta")).toHaveAttribute("min", "2026-07-01");
    ponerFecha("Hasta", "2026-07-28");
    expect(screen.getByLabelText("Desde")).toHaveAttribute("max", "2026-07-28");
  });

  it("R12: un rango de un solo dia (desde === hasta) SI es valido y se emite", () => {
    const onChange = renderControl();
    ponerFecha("Desde", "2026-07-15");
    ponerFecha("Hasta", "2026-07-15");
    expect(ultima(onChange)).toEqual(["", "2026-07-15", "2026-07-15"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("R12: corregir el rango invertido vuelve a emitir", () => {
    const onChange = renderControl();
    ponerFecha("Hasta", "2026-07-01");
    ponerFecha("Desde", "2026-07-28");
    onChange.mockClear();

    ponerFecha("Hasta", "2026-07-30");
    expect(ultima(onChange)).toEqual(["", "2026-07-28", "2026-07-30"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("DateRangeFilter — limpieza y deshabilitado (R21, R15)", () => {
  it("R21: 'Limpiar' vacia las TRES posiciones a la vez y emite el resultado", () => {
    const onChange = renderControl();
    ponerFecha("Desde", "2026-07-01");
    ponerFecha("Hasta", "2026-07-28");
    onChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /limpiar/i }));

    expect(ultima(onChange)).toEqual(["", "", ""]);
    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(screen.getByLabelText("Hasta")).toHaveValue("");
  });

  it("R21: sin ninguna seleccion no se ofrece la limpieza individual", () => {
    renderControl();
    expect(screen.queryByRole("button", { name: /limpiar/i })).toBeNull();
  });

  it("R15: deshabilitado, los controles no aceptan cambios ni emiten", () => {
    const onChange = renderControl({ disabled: true });

    expect(screen.getByLabelText("Desde")).toBeDisabled();
    expect(screen.getByLabelText("Hasta")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Periodo" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("R29: el control expone un nombre accesible propio", () => {
    renderControl();
    expect(screen.getByRole("group", { name: "Periodo" })).toBeInTheDocument();
  });

  it("`resetSignal` vacia el control SIN emitir (lo emite el orquestador)", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DateRangeFilter
        label="Periodo"
        shortcuts={ATAJOS}
        onChange={onChange}
        resetSignal={0}
      />,
    );
    ponerFecha("Desde", "2026-07-01");
    onChange.mockClear();

    rerender(
      <DateRangeFilter
        label="Periodo"
        shortcuts={ATAJOS}
        onChange={onChange}
        resetSignal={1}
      />,
    );

    expect(screen.getByLabelText("Desde")).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
  });
});
