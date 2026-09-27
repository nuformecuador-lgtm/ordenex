// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { ResumenMiWallet } from "@/app/(app)/mi-wallet/_components/ResumenMiWallet";

// FICHA 458-D (cierre; 172 R55 `[P5]`, N1) — el resumen de tres cifras de `/mi-wallet`, aislado: pinta
// las CUATRO cifras del servidor tal cual (sin sumar ni recalcular), en el orden de la fórmula, con el
// signo que manda el servidor y la salvedad N1 dentro de su región. El montaje en la página, encima del
// estado de cuenta y cuadrando con la tarjeta, lo mide `tests/integration/mi-wallet-page.test.tsx`; que
// las cifras cuadren de verdad, `tests/integration/db/mi-wallet-resumen-458d.test.ts`.

afterEach(() => cleanup());

function region() {
  return screen.getByRole("region", { name: "Resumen de tu cuenta" });
}

describe("ResumenMiWallet (172 R55 / N1)", () => {
  it("pinta las cifras del servidor en el orden de la fórmula: a tu favor, cargos, ya pagado", () => {
    render(
      <ResumenMiWallet
        resumen={{ aFavor: "13000.00", cargos: "3800.00", pagado: "4000.00", saldo: "5200.00", signo: "positivo" }}
      />,
    );
    const texto = region().textContent ?? "";
    const posicion = (t: string) => texto.indexOf(t);
    expect(posicion("A tu favor")).toBeGreaterThanOrEqual(0);
    expect(posicion("A tu favor")).toBeLessThan(posicion("Cargos de Ordenex"));
    expect(posicion("Cargos de Ordenex")).toBeLessThan(posicion("Ya pagado"));
    expect(posicion("Ya pagado")).toBeLessThan(posicion("Saldo a favor"));
    expect(within(region()).getByText("₡13.000")).toBeInTheDocument();
    expect(within(region()).getByText("₡3.800")).toBeInTheDocument();
    expect(within(region()).getByText("₡4.000")).toBeInTheDocument();
    expect(within(region()).getByText("₡5.200")).toBeInTheDocument();
    expect(within(region()).getByText("A favor")).toBeInTheDocument();
  });

  it("no recalcula: si el servidor manda un saldo, ese es el que se ve (aunque la resta diera otro)", () => {
    render(
      <ResumenMiWallet
        resumen={{ aFavor: "10.00", cargos: "1.00", pagado: "1.00", saldo: "99.00", signo: "positivo" }}
      />,
    );
    expect(within(region()).getByText("₡99")).toBeInTheDocument();
    expect(within(region()).queryByText("₡8")).toBeNull();
  });

  it("el saldo en cero y en contra llevan su distintivo", () => {
    const { rerender } = render(
      <ResumenMiWallet resumen={{ aFavor: "0.00", cargos: "0.00", pagado: "0.00", saldo: "0.00", signo: "cero" }} />,
    );
    expect(within(region()).getByText("En cero")).toBeInTheDocument();
    rerender(
      <ResumenMiWallet
        resumen={{ aFavor: "100.00", cargos: "350.00", pagado: "0.00", saldo: "-250.00", signo: "negativo" }}
      />,
    );
    expect(within(region()).getByText("En contra")).toBeInTheDocument();
    expect(within(region()).getByText("-₡250")).toBeInTheDocument();
  });

  it("N1: la salvedad de las cifras brutas va DENTRO del resumen", () => {
    render(
      <ResumenMiWallet
        resumen={{ aFavor: "13000.00", cargos: "3800.00", pagado: "4000.00", saldo: "5200.00", signo: "positivo" }}
      />,
    );
    expect(within(region()).getByRole("note")).toHaveTextContent(/«Ya pagado» sigue contando los pagos que se anularon/);
  });
});
