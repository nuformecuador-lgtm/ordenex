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

// Feature 160 (T21, R18/R19/R27) — el aviso es una card, no una tabla: el conteo va
// como DATO ETIQUETADO, con el mismo markup que la línea de la remisión.
describe("BodegaLiberadasHoy — intentos de entrega (feature 160)", () => {
  it("R18: cada orden liberada muestra el dato etiquetado en su card", () => {
    render(
      <BodegaLiberadasHoy
        liberadas={[makeRow({ id: "o1", numGuia: 5001, intentosEntrega: 2 })]}
      />,
    );
    const region = screen.getByRole("region", {
      name: "Liberadas hoy (reprogramación)",
    });
    const dato = within(region).getByText("Intentos: 2");
    // Mismo markup que la línea hermana ("Remisión REM-001"): un <p> del CardContent.
    expect(dato.closest("p")).not.toBeNull();
    expect(within(region).getByText(/Remisión REM-001/)).toBeInTheDocument();
  });

  it("R19: con 0 intentos el dato SE MUESTRA igual (no se omite)", () => {
    render(
      <BodegaLiberadasHoy liberadas={[makeRow({ id: "o1", intentosEntrega: 0 })]} />,
    );
    expect(screen.getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R19: sin el campo (DTO viejo) el dato se muestra como 0", () => {
    render(<BodegaLiberadasHoy liberadas={[makeRow({ id: "o1" })]} />);
    expect(screen.getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R27: cada orden lleva SU número", () => {
    render(
      <BodegaLiberadasHoy
        liberadas={[
          makeRow({ id: "o1", numGuia: 5001, intentosEntrega: 3 }),
          makeRow({ id: "o2", numGuia: 5002, intentosEntrega: 0 }),
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]).getByText("Intentos: 3")).toBeInTheDocument();
    expect(within(items[1]).getByText("Intentos: 0")).toBeInTheDocument();
  });

  it("R32: con lista vacía el aviso sigue sin renderizarse (y sin el dato)", () => {
    const { container } = render(<BodegaLiberadasHoy liberadas={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Intentos/)).toBeNull();
  });

  it("R20: el dato no trae el umbral ('de N')", () => {
    render(
      <BodegaLiberadasHoy liberadas={[makeRow({ id: "o1", intentosEntrega: 2 })]} />,
    );
    expect(screen.getByText("Intentos: 2").textContent).toBe("Intentos: 2");
  });
});
