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
    expect(within(lista).getByText("₡300")).toBeInTheDocument();
    expect(within(lista).getByText("Gastos variables")).toBeInTheDocument();
    expect(within(lista).getByText("₡126")).toBeInTheDocument();
    expect(within(lista).getByText("Sueldos")).toBeInTheDocument();
    expect(within(lista).getByText("₡800")).toBeInTheDocument();
    expect(within(lista).getByText("Total de egresos")).toBeInTheDocument();
    expect(within(lista).getByText("₡1.251")).toBeInTheDocument();
  });
});

describe("Feature 158/R32 — la indemnización es una fila propia y suma al total", () => {
  it("pinta la fila 'Indemnizaciones' con su monto TAL CUAL", () => {
    render(<DesgloseEgresosCard desglose={DESGLOSE} />);

    const lista = screen.getByRole("group", { name: "Desglose de egresos" });
    expect(within(lista).getByText("Indemnizaciones")).toBeInTheDocument();
    expect(within(lista).getByText("₡25")).toBeInTheDocument();
  });

  it("el total mostrado es el que llega del servidor (la tarjeta NO suma dinero)", () => {
    // 300.00 + 125.50 + 800.00 + 25.25 = 1250.75. El componente no hace la cuenta: si el
    // servidor mandara otro total, la tarjeta mostraría ESE (money-safe, un solo origen).
    //
    // Feature 230/R20: el total que se pinta es el REDONDEO DEL TOTAL (1250.75 -> ₡1.251),
    // nunca la suma de los redondeos. Aquí las dos cuentas coinciden por casualidad
    // (300+126+800+25 = 1251); el caso de abajo, con `999.99 -> ₡1.000`, demuestra que la
    // tarjeta pinta lo que le mandan aunque no cuadre con las filas de arriba.
    render(
      <DesgloseEgresosCard desglose={{ ...DESGLOSE, total: "999.99" }} />,
    );
    const lista = screen.getByRole("group", { name: "Desglose de egresos" });
    expect(within(lista).getByText("₡1.000")).toBeInTheDocument();
  });

  it("un monto que no cabe en un `number` se redondea EXACTO (sin parseFloat)", () => {
    render(
      <DesgloseEgresosCard
        desglose={{ ...DESGLOSE, indemnizacion: "12345678901.99", total: "12345679127.49" }}
      />,
    );
    const lista = screen.getByRole("group", { name: "Desglose de egresos" });
    // Feature 230: los dos redondean en sentidos opuestos (`,99` sube, `,49` baja) sobre
    // once dígitos, y eso solo sale bien trabajando dígito a dígito. Un `parseFloat`/`Number`
    // intermedio pondría en juego la precisión justo aquí.
    expect(within(lista).getByText("₡12.345.678.902")).toBeInTheDocument();
    expect(within(lista).getByText("₡12.345.679.127")).toBeInTheDocument();
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
