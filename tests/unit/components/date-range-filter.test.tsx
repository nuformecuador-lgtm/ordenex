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
//
// Los extremos se eligen en el CALENDARIO (`@daypicker/react` en modo rango): el mes
// se fija con `defaultMonth` para que "hacer clic en el dia 1" sea determinista y no
// dependa de la fecha de la maquina.

// Cada atajo TRAE el rango que representa: pulsarlo no emite su valor, pinta ese rango
// en el calendario y emite sus dos extremos.
const ATAJOS = [
  { value: "corto", label: "Plazo corto", desde: "2026-07-20", hasta: "2026-07-24" },
  { value: "largo", label: "Plazo largo", desde: "2026-07-05", hasta: "2026-07-24" },
];
const RANGO_CORTO = ["", "2026-07-20", "2026-07-24"];
const RANGO_LARGO = ["", "2026-07-05", "2026-07-24"];

const JULIO_2026 = new Date(2026, 6, 1);

function renderControl(props: Partial<Parameters<typeof DateRangeFilter>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <DateRangeFilter
      label="Periodo"
      shortcuts={ATAJOS}
      onChange={onChange}
      defaultMonth={JULIO_2026}
      {...props}
    />,
  );
  return onChange;
}

type Usuario = ReturnType<typeof userEvent.setup>;

/** Abre el calendario si no lo esta (volver a pulsar el disparador lo cerraria). */
async function abrirCalendario(user: Usuario) {
  if (screen.queryAllByRole("grid").length === 0) {
    await user.click(screen.getByRole("button", { name: "Periodo" }));
  }
}

/** Pulsa uno de los rangos predefinidos, que viven dentro del propio calendario. */
async function clicAtajo(user: Usuario, texto: string) {
  await abrirCalendario(user);
  const grupo = screen.getByRole("group", { name: "Rangos predefinidos" });
  await user.click(within(grupo).getByRole("button", { name: texto }));
}

/**
 * Hace clic en un dia del calendario. `mes` indexa los dos meses visibles:
 * 0 = julio 2026, 1 = agosto 2026.
 */
async function clicDia(user: Usuario, dia: number, mes = 0) {
  await abrirCalendario(user);
  const cuadriculas = await screen.findAllByRole("grid");
  await user.click(within(cuadriculas[mes]).getByText(String(dia)));
}

/** Texto que resume la seleccion en el disparador del calendario. */
function textoDisparador() {
  return screen.getByRole("button", { name: "Periodo" }).textContent;
}

/** Ultima terna emitida. */
function ultima(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
}

afterEach(() => cleanup());

describe("DateRangeFilter — dos extremos y atajos en UN control (R8, R9)", () => {
  it("R8: ofrece los dos extremos del rango, fijables por separado", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    // El primer clic fija el rango en ESE dia (ambos extremos); el segundo lo extiende.
    await clicDia(user, 1);
    expect(ultima(onChange)).toEqual(["", "2026-07-01", "2026-07-01"]);

    await clicDia(user, 28);
    expect(ultima(onChange)).toEqual(["", "2026-07-01", "2026-07-28"]);
  });

  it("R8: los extremos son fechas de CALENDARIO (se eligen en un calendario, no como instantes)", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await abrirCalendario(user);
    expect(screen.getAllByRole("grid")).toHaveLength(2); // dos meses a la vista

    await clicDia(user, 15);
    const [, desde, hasta] = ultima(onChange) as [string, string, string];
    // Fechas de calendario, sin hora ni huso.
    expect(desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("R8: el rango tambien se puede cruzar de mes", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 28);
    await clicDia(user, 3, 1); // 3 de agosto

    expect(ultima(onChange)).toEqual(["", "2026-07-28", "2026-08-03"]);
  });

  it("R9: los atajos se ofrecen como BOTONES dentro del mismo calendario, sin control adicional", async () => {
    const user = userEvent.setup();
    renderControl();

    // Un unico disparador: los atajos no son un segundo control de la barra.
    expect(screen.getAllByRole("button")).toHaveLength(1);

    await abrirCalendario(user);
    const grupo = screen.getByRole("group", { name: "Rangos predefinidos" });
    expect(within(grupo).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Plazo corto",
      "Plazo largo",
    ]);
  });

  it("R9: el atajo activo se marca en su propio boton", async () => {
    const user = userEvent.setup();
    renderControl();

    await clicAtajo(user, "Plazo corto");

    const grupo = screen.getByRole("group", { name: "Rangos predefinidos" });
    expect(within(grupo).getByRole("button", { name: "Plazo corto" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(grupo).getByRole("button", { name: "Plazo largo" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(textoDisparador()).toContain("Plazo corto");
  });

  it("R9: volver a pulsar el atajo activo lo suelta", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicAtajo(user, "Plazo corto");
    await clicAtajo(user, "Plazo corto");

    expect(ultima(onChange)).toEqual(["", "", ""]);
    expect(textoDisparador()).toContain("Cualquier fecha");
  });

  it("R9: sin atajos declarados el control sigue operando solo con el rango", async () => {
    const user = userEvent.setup();
    const onChange = renderControl({ shortcuts: [] });

    await abrirCalendario(user);
    expect(screen.queryByRole("group", { name: "Rangos predefinidos" })).toBeNull();

    await clicDia(user, 1);
    expect(ultima(onChange)).toEqual(["", "2026-07-01", "2026-07-01"]);
  });
});

describe("DateRangeFilter — el atajo ES el rango (R10)", () => {
  it("R10: pulsar un atajo SUSTITUYE el rango vigente por el suyo", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 1);
    await clicDia(user, 28);

    await clicAtajo(user, "Plazo corto");

    expect(ultima(onChange)).toEqual(RANGO_CORTO);
    // El disparador lo resume con la etiqueta del atajo, no con las dos fechas.
    expect(textoDisparador()).toContain("Plazo corto");
  });

  it("R10: el rango del atajo queda marcado en el calendario, extremo a extremo", async () => {
    const user = userEvent.setup();
    renderControl();

    await clicAtajo(user, "Plazo corto");

    // `data-selected` lo pone DayPicker en la celda de cada dia del rango, extremos
    // incluidos: es la marca de que el atajo se pinto de verdad en el calendario.
    const dias = within((await screen.findAllByRole("grid"))[0]);
    for (const dia of ["20", "22", "24"]) {
      expect(dias.getByText(dia).parentElement).toHaveAttribute("data-selected");
    }
    expect(dias.getByText("19").parentElement).not.toHaveAttribute("data-selected");
    expect(dias.getByText("25").parentElement).not.toHaveAttribute("data-selected");
  });

  it("R10: elegir dias a mano APAGA el atajo, que deja de estar marcado", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicAtajo(user, "Plazo largo");
    expect(ultima(onChange)).toEqual(RANGO_LARGO);

    // Sobre un rango completo, el dia elegido MUEVE el extremo mas cercano.
    await clicDia(user, 28);

    expect(ultima(onChange)).toEqual(["", "2026-07-05", "2026-07-28"]);
    const grupo = screen.getByRole("group", { name: "Rangos predefinidos" });
    expect(within(grupo).getByRole("button", { name: "Plazo largo" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("R10/R19: el atajo NUNCA viaja como valor propio: la primera posicion va vacia", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 1);
    await clicAtajo(user, "Plazo corto");
    await clicDia(user, 28);

    for (const [terna] of onChange.mock.calls) {
      expect((terna as [string, string, string])[0]).toBe("");
    }
  });
});

describe("DateRangeFilter — forma de la salida (R11, R19)", () => {
  it('R11/R19: quitar el extremo final deja `["","D",""]` (rango abierto por arriba)', async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 1);
    await user.click(screen.getByRole("button", { name: "Quitar hasta" }));

    expect(ultima(onChange)).toEqual(["", "2026-07-01", ""]);
    expect(textoDisparador()).toContain("Desde el");
  });

  it('R11/R19: quitar el extremo inicial deja `["","","H"]` (rango abierto por abajo)', async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 1);
    await clicDia(user, 28);
    await user.click(screen.getByRole("button", { name: "Quitar desde" }));

    expect(ultima(onChange)).toEqual(["", "", "2026-07-28"]);
    expect(textoDisparador()).toContain("Hasta el");
  });

  it("R11: sobre un rango abierto por abajo, el siguiente dia elegido cierra el rango ordenado", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 1);
    await clicDia(user, 28);
    await user.click(screen.getByRole("button", { name: "Quitar desde" }));
    await clicDia(user, 10);

    expect(ultima(onChange)).toEqual(["", "2026-07-10", "2026-07-28"]);
  });

  it("R19: la terna NUNCA se compacta: siempre son 3 posiciones", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicAtajo(user, "Plazo corto");
    await clicDia(user, 1);

    for (const [terna] of onChange.mock.calls) {
      expect(terna).toHaveLength(3);
    }
  });

  it("R5: emite el rango del atajo TAL CUAL lo declaro el consumidor, sin recalcularlo", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicAtajo(user, "Plazo largo");
    expect(ultima(onChange)).toEqual(RANGO_LARGO);
  });
});

describe("DateRangeFilter — rango invertido (R12)", () => {
  it("R12: elegir primero el dia MAYOR no produce un rango invertido: el calendario lo ordena", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 28);
    await clicDia(user, 1);

    expect(ultima(onChange)).toEqual(["", "2026-07-01", "2026-07-28"]);
  });

  it("R12: ninguna terna emitida lleva `desde` posterior a `hasta`", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 28);
    await clicDia(user, 1);
    await clicDia(user, 15);
    await clicDia(user, 3, 1);

    for (const [terna] of onChange.mock.calls) {
      const [, desde, hasta] = terna as [string, string, string];
      expect(desde !== "" && hasta !== "" && desde > hasta).toBe(false);
    }
  });

  it("R12: un rango de un solo dia (desde === hasta) SI es valido y se emite", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 15);

    expect(ultima(onChange)).toEqual(["", "2026-07-15", "2026-07-15"]);
  });

  it("volver a pulsar el dia del rango de un solo dia lo deselecciona", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 15);
    await clicDia(user, 15);

    expect(ultima(onChange)).toEqual(["", "", ""]);
    expect(textoDisparador()).toContain("Cualquier fecha");
  });
});

describe("DateRangeFilter — limpieza y deshabilitado (R21, R15)", () => {
  it("R21: la X del propio control vacia las TRES posiciones y emite el resultado", async () => {
    const user = userEvent.setup();
    const onChange = renderControl();

    await clicDia(user, 1);
    await clicDia(user, 28);
    onChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar Periodo" }));

    expect(ultima(onChange)).toEqual(["", "", ""]);
    expect(textoDisparador()).toContain("Cualquier fecha");
  });

  it("R21: la limpieza NO es un boton aparte: vive dentro del mismo control", async () => {
    const user = userEvent.setup();
    renderControl();

    // Sin seleccion no se ofrece.
    expect(screen.queryByRole("button", { name: "Limpiar Periodo" })).toBeNull();

    await clicDia(user, 1);

    // Con seleccion aparece, y sigue habiendo un solo control en la barra.
    expect(screen.getByRole("button", { name: "Limpiar Periodo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Limpiar$/i })).toBeNull();
  });

  it("R15: deshabilitado, los controles no aceptan cambios ni emiten", async () => {
    const user = userEvent.setup();
    const onChange = renderControl({ disabled: true });

    expect(screen.getByRole("button", { name: "Periodo" })).toBeDisabled();

    // Con el disparador deshabilitado no hay forma de llegar ni al calendario ni a
    // los atajos: el control entero queda inerte.
    await user.click(screen.getByRole("button", { name: "Periodo" }));
    expect(screen.queryAllByRole("grid")).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Rangos predefinidos" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("R29: el control expone un nombre accesible propio", () => {
    renderControl();
    expect(screen.getByRole("group", { name: "Periodo" })).toBeInTheDocument();
  });

  it("`resetSignal` vacia el control SIN emitir (lo emite el orquestador)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DateRangeFilter
        label="Periodo"
        shortcuts={ATAJOS}
        onChange={onChange}
        defaultMonth={JULIO_2026}
        resetSignal={0}
      />,
    );
    await clicDia(user, 1);
    onChange.mockClear();

    rerender(
      <DateRangeFilter
        label="Periodo"
        shortcuts={ATAJOS}
        onChange={onChange}
        defaultMonth={JULIO_2026}
        resetSignal={1}
      />,
    );

    expect(textoDisparador()).toContain("Cualquier fecha");
    expect(onChange).not.toHaveBeenCalled();
  });
});
