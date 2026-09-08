// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import {
  CascadaDinero,
  type LineaCascada,
} from "@/app/(app)/cierres-admin/_components/CascadaDinero";
import { money } from "@/lib/config/moneda";

/**
 * Feature 393 (F2) — EL COMPONENTE DE UNA CASCADA, a solas.
 *
 * Lo que se afirma aquí es lo que el componente promete y nada más: que la línea que se resta se
 * LEE como una resta (R5), que el resultado se destaca frente a lo que lo compone (R3/R4), que la
 * cascada es una región con nombre accesible propio (R32), que un resultado negativo se pinta con
 * su signo y en tono de atención (R36) y que **el importe que recibe no lo toca** (R13).
 *
 * Los importes llevan CÉNTIMOS a propósito: con cifras redondas, un componente que parseara a
 * coma flotante y volviera a formatear daría la misma cadena y este archivo se quedaría verde.
 */

afterEach(cleanup);

const TITULO = "Lo que va a la central";
const ARIA = "Cascada · lo que va a la central";

/** Las cuatro líneas de la cascada B, con céntimos. 126089,17 − 14000,55 − 250,25 = 111838,37. */
const LINEAS: readonly LineaCascada[] = [
  { label: "Total", monto: "126089.17", signo: "neutro" },
  { label: "Pago al mensajero", monto: "14000.55", signo: "resta" },
  {
    label: "Gana la bodega satélite",
    monto: "250.25",
    signo: "resta",
    notas: ["Lo que se le reconoce por los rechazos."],
  },
  {
    label: "Para la central",
    monto: "111838.37",
    signo: "neutro",
    destacado: true,
    notas: ["Lo recaudado menos los dos descuentos."],
  },
];

function montar(lineas: readonly LineaCascada[] = LINEAS) {
  return render(<CascadaDinero titulo={TITULO} ariaLabel={ARIA} lineas={lineas} />);
}

/** La región de la cascada, localizada por su nombre accesible. */
function region() {
  return screen.getByRole("region", { name: ARIA });
}

describe("393 · F2 — CascadaDinero", () => {
  it("es una región con nombre accesible PROPIO, y enseña su rótulo (R32)", () => {
    montar();
    expect(region()).toBeInTheDocument();
    // El rótulo visible es un encabezado, no sólo el nombre accesible: quien ve la pantalla
    // también tiene que saber de qué cascada se trata.
    expect(within(region()).getByRole("heading", { name: TITULO })).toBeInTheDocument();
  });

  it("cada línea sustraendo se pinta con su signo, y la primera no (R5)", () => {
    montar();
    const texto = region().textContent ?? "";

    // El minuendo: sin operador. Es de donde se parte, no algo que se suma a nada.
    expect(texto).toContain(money("126089.17"));
    expect(texto).not.toContain(`-${money("126089.17")}`);
    // Los dos sustraendos: con el suyo, pegado al importe.
    expect(texto).toContain(`-${money("14000.55")}`);
    expect(texto).toContain(`-${money("250.25")}`);
  });

  it("y la resta CIERRA leyendo lo pintado: minuendo − sustraendos = resultado (R5)", () => {
    montar();
    const texto = region().textContent ?? "";
    // No se recompone la cuenta aquí (eso lo hace `DineroIdentidadesEnPantalla` con su
    // parseador); lo que se afirma es que las cuatro cifras que la componen están, cada una con
    // la forma con la que se puede volver a leer.
    expect(texto).toContain(money("111838.37"));
  });

  it("destaca el resultado frente a las líneas que lo componen (R3/R4)", () => {
    montar();
    const resultado = screen.getByText("Para la central");
    const lineaResultado = resultado.closest("div");
    expect(lineaResultado?.className).toContain("border-t");

    // Y el destaque es del resultado, no de un sustraendo cualquiera.
    const sustraendo = screen.getByText("Pago al mensajero").closest("div");
    expect(sustraendo?.className ?? "").not.toContain("border-t");
  });

  it("NO altera el importe que recibe: lo pinta con el formateador compartido (R13/R14)", () => {
    montar();
    const texto = region().textContent ?? "";
    // El céntimo sigue ahí. Un `Number(monto).toFixed(2)` daría «14000.55» sin símbolo ni
    // separador de miles, y un redondeo al colón daría «₡14.001».
    expect(texto).toContain(`-${money("14000.55")}`);
    expect(texto).not.toContain("14000.55");
    expect(texto).not.toContain(money("14001"));
  });

  it("un resultado NEGATIVO se pinta con su signo y en tono de atención (R11/R36)", () => {
    montar([
      { label: "Total", monto: "1000.00", signo: "neutro" },
      { label: "Pago al mensajero", monto: "2000.05", signo: "resta" },
      { label: "Para la central", monto: "-1000.05", signo: "neutro", destacado: true },
    ]);

    const pintado = screen.getByText(money("-1000.05"));
    // Con su signo: ni «₡1.000,05», ni «₡0», ni escondido.
    expect(pintado.textContent).toBe("-₡1.000,05");
    expect(pintado.className).toContain("text-danger-strong");
    expect(region().textContent).not.toContain(money("0"));
  });

  it("un sustraendo NO se tiñe de rojo aunque sea grande: el tono es del resultado", () => {
    montar([
      { label: "Total", monto: "1000.00", signo: "neutro" },
      { label: "Pago al mensajero", monto: "2000.05", signo: "resta" },
      { label: "Para la central", monto: "-1000.05", signo: "neutro", destacado: true },
    ]);
    const sustraendo = screen.getByText(`-${money("2000.05")}`);
    expect(sustraendo.className).not.toContain("text-danger-strong");
  });

  it("restar un importe que YA viene negativo invierte el operador, y no encadena dos signos", () => {
    // Decisión del frontend_dev (no del humano): los tres sustraendos de esta ficha son
    // snapshots de pagos y nunca vienen negativos, pero si vinieran, `--₡1.000` sería ilegible y
    // `-₡1.000` bajo un rótulo de resta diría lo contrario de lo que pasa. Restar un negativo
    // SUMA, y así se pinta. Es una regla sobre el texto: el importe no se recalcula.
    montar([
      { label: "Total", monto: "1000.00", signo: "neutro" },
      { label: "Ajuste a favor", monto: "-250.25", signo: "resta" },
      { label: "Para la central", monto: "1250.25", signo: "neutro", destacado: true },
    ]);
    const texto = region().textContent ?? "";
    expect(texto).toContain(`+${money("250.25")}`);
    expect(texto).not.toContain("--");
  });

  it("las notas se pintan bajo su rótulo, y sólo las que se pasan", () => {
    montar();
    expect(screen.getByText("Lo que se le reconoce por los rechazos.")).toBeInTheDocument();
    expect(screen.getByText("Lo recaudado menos los dos descuentos.")).toBeInTheDocument();
    // «Total» y «Pago al mensajero» no llevan nota: no se inventa ninguna.
    expect(screen.queryByText(/^Total /)).toBeNull();
  });
});
