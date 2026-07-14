// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import type { DesgloseEgresosDTO } from "@/lib/types/wallet";
import { DesgloseEgresosCard } from "@/app/(app)/wallet/_components/DesgloseEgresosCard";

// Feature 45 (T12, R11/R12) — tests de la tarjeta de DESGLOSE de egresos administrativos.
// Money-safe: renderiza los cuatro totales TAL CUAL como STRING (con ₡), sin parseFloat/Number.

const DESGLOSE: DesgloseEgresosDTO = {
  gastoFijo: "300.00",
  gastoVariable: "125.50",
  sueldo: "800.00",
  total: "1225.50",
};

afterEach(() => {
  cleanup();
});

describe("DesgloseEgresosCard — render (R11/R12)", () => {
  it("renderiza los tres totales por tipo y el total como STRING", () => {
    render(<DesgloseEgresosCard desglose={DESGLOSE} />);

    const lista = screen.getByRole("group", { name: "Desglose de egresos administrativos" });
    expect(within(lista).getByText("Gastos fijos")).toBeInTheDocument();
    expect(within(lista).getByText("₡300.00")).toBeInTheDocument();
    expect(within(lista).getByText("Gastos variables")).toBeInTheDocument();
    expect(within(lista).getByText("₡125.50")).toBeInTheDocument();
    expect(within(lista).getByText("Sueldos")).toBeInTheDocument();
    expect(within(lista).getByText("₡800.00")).toBeInTheDocument();
    expect(within(lista).getByText("Total de egresos")).toBeInTheDocument();
    expect(within(lista).getByText("₡1225.50")).toBeInTheDocument();
  });
});
