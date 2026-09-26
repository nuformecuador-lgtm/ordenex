// @vitest-environment jsdom
// Ficha 458-A (TA.4, design §5.1, R2/R10, R1) — la primitiva `SelectorBuscable`: estados (vacío,
// cargando, error, «solo los más recientes»), foco, teclado, búsqueda con retardo y que NUNCA pinte el
// valor (el identificador interno) sino el rótulo.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  SelectorBuscable,
  type SelectorBuscableEstado,
  type SelectorBuscableOpcion,
} from "@/components/shared/SelectorBuscable";
import { CIERRE_SELECTOR_TEXTOS } from "@/components/shared/wallet/cierres-selector";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const OPCIONES: SelectorBuscableOpcion[] = [
  { value: A, label: "Cierre del 2026-09-12 · Juan Pérez Mora · 3 movimientos" },
  { value: B, label: "Cierre del 2026-09-10 · Ana Díaz · 1 movimiento" },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Montado(props: {
  estado?: SelectorBuscableEstado;
  opciones?: SelectorBuscableOpcion[];
  hayMas?: boolean;
  onBuscar?: (t: string) => void;
  onCambiar?: (v: string | null) => void;
  esperaMs?: number;
}) {
  const [valor, setValor] = useState<string | null>(null);
  return (
    <>
      <label htmlFor="filtro-cierre">Cierre</label>
      <SelectorBuscable
        id="filtro-cierre"
        etiqueta="Cierre"
        opciones={props.opciones ?? OPCIONES}
        valor={valor}
        onCambiar={(v) => {
          setValor(v);
          props.onCambiar?.(v);
        }}
        onBuscar={props.onBuscar}
        estado={props.estado ?? "listo"}
        hayMas={props.hayMas}
        textos={CIERRE_SELECTOR_TEXTOS}
        esperaMs={props.esperaMs ?? 0}
      />
    </>
  );
}

const disparador = () => screen.getByRole("button", { name: /^Cierre:/ });

describe("SelectorBuscable — elegir sin teclear un identificador (R2/R10)", () => {
  it("el disparador dice qué filtra y qué hay elegido; al elegir, el rótulo (nunca el valor)", async () => {
    const user = userEvent.setup();
    const onCambiar = vi.fn();
    render(<Montado onCambiar={onCambiar} />);

    expect(disparador()).toHaveAccessibleName("Cierre: Todos los cierres");
    await user.click(disparador());
    const lista = await screen.findByRole("listbox", { name: "Cierre" });
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos los cierres",
      OPCIONES[0].label,
      OPCIONES[1].label,
    ]);
    await user.click(within(lista).getByRole("option", { name: OPCIONES[1].label }));

    expect(onCambiar).toHaveBeenCalledWith(B);
    expect(disparador()).toHaveAccessibleName(`Cierre: ${OPCIONES[1].label}`);
    expect(disparador()).toHaveTextContent(OPCIONES[1].label);
    // R1: el valor no aparece en ningún texto ni nombre accesible.
    expect(document.body.textContent ?? "").not.toMatch(UUID);
    expect(disparador().getAttribute("aria-label") ?? "").not.toMatch(UUID);
  });

  it("«Todos los cierres» quita el filtro (valor null)", async () => {
    const user = userEvent.setup();
    const onCambiar = vi.fn();
    render(<Montado onCambiar={onCambiar} />);
    await user.click(disparador());
    await user.click(await screen.findByRole("option", { name: OPCIONES[0].label }));
    await user.click(disparador());
    await user.click(await screen.findByRole("option", { name: "Todos los cierres" }));
    expect(onCambiar).toHaveBeenLastCalledWith(null);
    expect(disparador()).toHaveAccessibleName("Cierre: Todos los cierres");
  });
});

describe("SelectorBuscable — foco y teclado (WAI-ARIA combobox + listbox)", () => {
  it("al abrir, el foco va al campo de búsqueda; ↓ y Intro eligen; la opción activa se anuncia", async () => {
    const user = userEvent.setup();
    const onCambiar = vi.fn();
    render(<Montado onCambiar={onCambiar} />);
    await user.click(disparador());

    const campo = await screen.findByRole("combobox", { name: "Buscar un cierre" });
    expect(campo).toHaveFocus();
    expect(campo).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);

    await user.keyboard("{ArrowDown}");
    const activa = document.getElementById(campo.getAttribute("aria-activedescendant") ?? "");
    expect(activa).toHaveTextContent(OPCIONES[0].label);
    await user.keyboard("{ArrowDown}{ArrowUp}{End}");
    expect(document.getElementById(campo.getAttribute("aria-activedescendant") ?? "")).toHaveTextContent(
      OPCIONES[1].label,
    );
    await user.keyboard("{Home}{ArrowDown}{Enter}");
    expect(onCambiar).toHaveBeenCalledWith(A);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape cierra sin elegir y devuelve el foco al disparador", async () => {
    const user = userEvent.setup();
    const onCambiar = vi.fn();
    render(<Montado onCambiar={onCambiar} />);
    await user.click(disparador());
    await screen.findByRole("combobox", { name: "Buscar un cierre" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onCambiar).not.toHaveBeenCalled();
    expect(disparador()).toHaveFocus();
  });

  it("el foco del disparador es OPACO (ring sin transparencia)", () => {
    render(<Montado />);
    expect(disparador().className).toMatch(/focus-visible:ring-ring(\s|$)/);
    expect(disparador().className).not.toMatch(/focus-visible:ring-ring\//);
  });
});

describe("SelectorBuscable — estados de la lectura, en palabras", () => {
  it.each([
    ["cargando", "Cargando cierres…", "status"],
    ["error", "No pudimos cargar los cierres. Probá de nuevo.", "alert"],
    ["vacio", "No hay cierres con movimientos que coincidan.", "status"],
  ] as const)("%s: lo dice, y solo ofrece «Todos los cierres»", async (estado, texto, rol) => {
    const user = userEvent.setup();
    render(<Montado estado={estado} opciones={estado === "vacio" ? [] : OPCIONES} />);
    await user.click(disparador());
    expect(await screen.findByRole(rol)).toHaveTextContent(texto);
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(1);
  });

  it("hayMas: avisa que solo están los más recientes", async () => {
    const user = userEvent.setup();
    render(<Montado hayMas />);
    await user.click(disparador());
    expect(await screen.findByText(CIERRE_SELECTOR_TEXTOS.hayMas)).toBeInTheDocument();
  });
});

describe("SelectorBuscable — búsqueda", () => {
  it("con `onBuscar`: pide al abrir (\"\") y, tras el retardo, con el texto; no una vez por tecla", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onBuscar = vi.fn();
    render(<Montado onBuscar={onBuscar} esperaMs={300} />);
    fireEvent.click(disparador());
    const campo = await screen.findByRole("combobox", { name: "Buscar un cierre" });
    expect(onBuscar).toHaveBeenCalledWith("");
    onBuscar.mockClear();

    for (const t of ["2", "20", "2026-09-12"]) fireEvent.change(campo, { target: { value: t } });
    expect(onBuscar).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(onBuscar).toHaveBeenCalledTimes(1);
    expect(onBuscar).toHaveBeenCalledWith("2026-09-12");
  });

  it("sin `onBuscar`: filtra en el cliente por el rótulo, sin tildes ni mayúsculas", async () => {
    const user = userEvent.setup();
    render(<Montado />);
    await user.click(disparador());
    await user.type(await screen.findByRole("combobox", { name: "Buscar un cierre" }), "diaz");
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Todos los cierres",
      OPCIONES[1].label,
    ]);
  });
});
