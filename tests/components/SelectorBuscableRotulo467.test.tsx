// @vitest-environment jsdom
// FICHA 467 (T2, design §4.2; R23, R33) — `SelectorBuscable` con `rotuloVisible`: el nombre del control
// DENTRO del disparador («A quién: Todos»), como el `labelPrefix` de `Select`. Sin la prop, el
// disparador es el de siempre: mismo texto visible y mismo nombre accesible.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { SelectorBuscable, type SelectorBuscableOpcion } from "@/components/shared/SelectorBuscable";
import { A_QUIEN_SELECTOR_TEXTOS } from "@/app/(app)/wallet/_components/a-quien-selector";

const OPCIONES: SelectorBuscableOpcion[] = [
  { value: "v1", label: "Tienda Sol · Tienda · 3 movimientos" },
  { value: "v2", label: "Juan Pérez · Mensajero · 1 movimiento" },
];

afterEach(() => cleanup());

function Montado({ rotuloVisible }: { rotuloVisible?: boolean }) {
  const [valor, setValor] = useState<string | null>(null);
  return (
    <SelectorBuscable
      id="filtro-a-quien"
      etiqueta="A quién"
      opciones={OPCIONES}
      valor={valor}
      onCambiar={setValor}
      estado="listo"
      textos={A_QUIEN_SELECTOR_TEXTOS}
      esperaMs={0}
      rotuloVisible={rotuloVisible}
    />
  );
}

const disparador = () => screen.getByRole("button", { name: /^A quién:/ });

describe("467 R23 — con `rotuloVisible`, el nombre va DENTRO del disparador", () => {
  it("sin elección dice «A quién: Todos» y, tras elegir, «A quién: <rótulo>»", async () => {
    const user = userEvent.setup();
    render(<Montado rotuloVisible />);

    expect(disparador()).toHaveTextContent(/^A quién: Todos$/);
    expect(disparador()).toHaveAccessibleName("A quién: Todos");

    await user.click(disparador());
    await user.click(screen.getByRole("option", { name: "Tienda Sol · Tienda · 3 movimientos" }));

    expect(disparador()).toHaveTextContent(/^A quién: Tienda Sol · Tienda · 3 movimientos$/);
    expect(disparador()).toHaveAccessibleName("A quién: Tienda Sol · Tienda · 3 movimientos");
  });
});

describe("467 R33 — sin la prop, el disparador es idéntico al de antes", () => {
  it("el texto visible es SOLO el valor y el nombre accesible no cambia", async () => {
    const user = userEvent.setup();
    render(<Montado />);

    // Literal: el texto de siempre, sin el nombre delante.
    expect(disparador()).toHaveTextContent(/^Todos$/);
    expect(disparador()).toHaveAccessibleName("A quién: Todos");

    await user.click(disparador());
    await user.click(screen.getByRole("option", { name: "Juan Pérez · Mensajero · 1 movimiento" }));

    expect(disparador()).toHaveTextContent(/^Juan Pérez · Mensajero · 1 movimiento$/);
    expect(disparador()).toHaveAccessibleName("A quién: Juan Pérez · Mensajero · 1 movimiento");
  });
});
