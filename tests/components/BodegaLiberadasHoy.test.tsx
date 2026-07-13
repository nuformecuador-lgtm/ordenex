// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";

import { BodegaLiberadasHoy } from "@/components/private/BodegaLiberadasHoy";
import type { LiberadaHoyRow } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";

// Feature 46 (T15, R15/R16) — aviso derivado "Liberadas hoy (reprogramación)".
// Componente PRIVADO: recibe las órdenes por props (ya resueltas server-side por la
// bodega responsable) y las renderiza; sin datos → sin sección.

function makeRow(over: Partial<LiberadaHoyRow> & { id: string }): LiberadaHoyRow {
  return {
    numGuia: 5001,
    numRemision: "REM-001",
    destinatario: "Ana Pérez",
    liberadaReprogramadaAt: new Date("2026-07-13T06:00:00.000Z"),
    ...over,
  };
}

afterEach(() => cleanup());

describe("BodegaLiberadasHoy", () => {
  it("R15: renderiza la sección con las órdenes recibidas por props (guía + destinatario)", () => {
    render(
      <BodegaLiberadasHoy
        liberadas={[
          makeRow({ id: "o1", numGuia: 5001, destinatario: "Ana Pérez" }),
          makeRow({
            id: "o2",
            numGuia: 5002,
            numRemision: "REM-002",
            destinatario: "Beto Ruiz",
          }),
        ]}
      />,
    );

    const region = screen.getByRole("region", {
      name: "Liberadas hoy (reprogramación)",
    });
    expect(within(region).getByText(/Guía 5001/)).toBeInTheDocument();
    expect(within(region).getByText(/Ana Pérez/)).toBeInTheDocument();
    expect(within(region).getByText(/Guía 5002/)).toBeInTheDocument();
    expect(within(region).getByText(/Beto Ruiz/)).toBeInTheDocument();
  });

  it("R15: sin guía muestra el número de remisión como referencia", () => {
    render(
      <BodegaLiberadasHoy
        liberadas={[
          makeRow({ id: "o3", numGuia: null, numRemision: "REM-777", destinatario: "Caro" }),
        ]}
      />,
    );

    const region = screen.getByRole("region", {
      name: "Liberadas hoy (reprogramación)",
    });
    expect(within(region).getAllByText(/REM-777/).length).toBeGreaterThan(0);
  });

  it("R15: lista vacía NO renderiza la sección (aviso solo cuando hay algo que avisar)", () => {
    const { container } = render(<BodegaLiberadasHoy liberadas={[]} />);
    expect(
      screen.queryByRole("region", { name: "Liberadas hoy (reprogramación)" }),
    ).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
