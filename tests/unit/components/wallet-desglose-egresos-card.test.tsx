// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import type { DesgloseEgresosDTO } from "@/lib/types/wallet";
import { DesgloseEgresosCard } from "@/app/(app)/wallet/_components/DesgloseEgresosCard";

// Feature 45 (T12, R11/R12) — tests de la tarjeta de DESGLOSE de egresos.
// Money-safe: renderiza los totales TAL CUAL como STRING (con ₡), sin parseFloat/Number.
//
// Feature 158 (T2.5, R32) — el nombre accesible del grupo pasa de "Desglose de egresos
// administrativos" a "Desglose de egresos", y el título de la tarjeta de "Egresos
// administrativos" a "Egresos". NO es un test debilitado: es el MISMO invariante (la tarjeta
// muestra sus conceptos y su total, money-safe) sobre el copy corregido. El copy viejo se
// volvió FALSO al entrar la indemnización, que es un egreso operativo y no administrativo.

const DESGLOSE: DesgloseEgresosDTO = {
  gastoFijo: "300.00",
  gastoVariable: "125.50",
  sueldo: "800.00",
  indemnizacion: "25.25", // feature 158/R32
  total: "1250.75",
};

afterEach(() => {
  cleanup();
});

describe("DesgloseEgresosCard — render (R11/R12)", () => {
  it("renderiza los totales por tipo y el total como STRING", () => {
    render(<DesgloseEgresosCard desglose={DESGLOSE} />);

    const lista = screen.getByRole("group", { name: "Desglose de egresos" });
    expect(within(lista).getByText("Gastos fijos")).toBeInTheDocument();
    expect(within(lista).getByText("₡300.00")).toBeInTheDocument();
    expect(within(lista).getByText("Gastos variables")).toBeInTheDocument();
    expect(within(lista).getByText("₡125.50")).toBeInTheDocument();
    expect(within(lista).getByText("Sueldos")).toBeInTheDocument();
    expect(within(lista).getByText("₡800.00")).toBeInTheDocument();
    expect(within(lista).getByText("Total de egresos")).toBeInTheDocument();
    expect(within(lista).getByText("₡1250.75")).toBeInTheDocument();
  });
});

describe("Feature 158/R32 — la indemnización es una fila propia y suma al total", () => {
  it("pinta la fila 'Indemnizaciones' con su monto TAL CUAL", () => {
    render(<DesgloseEgresosCard desglose={DESGLOSE} />);

    const lista = screen.getByRole("group", { name: "Desglose de egresos" });
    expect(within(lista).getByText("Indemnizaciones")).toBeInTheDocument();
    expect(within(lista).getByText("₡25.25")).toBeInTheDocument();
  });

  it("el total mostrado es el que llega del servidor (la tarjeta NO suma dinero)", () => {
    // 300.00 + 125.50 + 800.00 + 25.25 = 1250.75. El componente no hace la cuenta: si el
    // servidor mandara otro total, la tarjeta mostraría ESE (money-safe, un solo origen).
    render(
      <DesgloseEgresosCard desglose={{ ...DESGLOSE, total: "999.99" }} />,
    );
    const lista = screen.getByRole("group", { name: "Desglose de egresos" });
    expect(within(lista).getByText("₡999.99")).toBeInTheDocument();
  });

  it("un monto con muchos decimales o muy grande se muestra sin reformatear (sin parseFloat)", () => {
    render(
      <DesgloseEgresosCard
        desglose={{ ...DESGLOSE, indemnizacion: "12345678901.99", total: "12345679127.49" }}
      />,
    );
    const lista = screen.getByRole("group", { name: "Desglose de egresos" });
    // Un `parseFloat`/`Number` intermedio perdería precisión o cambiaría el texto.
    expect(within(lista).getByText("₡12345678901.99")).toBeInTheDocument();
    expect(within(lista).getByText("₡12345679127.49")).toBeInTheDocument();
  });
});

describe("Feature 158/T2.5 — el copy del título deja de decir 'administrativos'", () => {
  it("la tarjeta ya NO se titula 'Egresos administrativos'", () => {
    const { container } = render(<DesgloseEgresosCard desglose={DESGLOSE} />);

    const titulo = container.querySelector('[data-slot="card-title"]');
    expect(titulo).toHaveTextContent("Egresos");
    // La indemnización es un egreso OPERATIVO: el rótulo viejo sería falso con esa fila
    // dentro, y encima falso sobre dinero.
    expect(container.textContent).not.toMatch(/Egresos administrativos/);
  });

  it("dice qué entra y qué NO entra en el total, en vez de dejarlo implícito", () => {
    const { container } = render(<DesgloseEgresosCard desglose={DESGLOSE} />);

    const descripcion = container.querySelector('[data-slot="card-description"]');
    expect(descripcion?.textContent ?? "").toMatch(/indemnizaci/i);
    // La tarjeta NO es el total de TODOS los egresos de la caja: no incluye las
    // liquidaciones. Antes tampoco lo incluía y no se decía en ninguna parte.
    expect(descripcion?.textContent ?? "").toMatch(/no incluye/i);
    expect(descripcion?.textContent ?? "").toMatch(/tienda|mensajero/i);
  });
});
