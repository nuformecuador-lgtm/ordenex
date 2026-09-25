// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { RetieneReprogramadasBadge } from "@/app/(app)/cierres-admin/_components/RetieneReprogramadasBadge";

// FICHA 462 (T3.2, S3, R27/R28) — LA MARCA «Retiene N paquetes reprogramados para hoy».
//
// Lo que este archivo protege: que con 0 (o sin dato) NO se pinte NADA de esta ficha (R27), y que con
// una cifra se lea el literal aprobado, singular y plural, con nombre accesible. Los literales van A
// MANO (memoria «asercion contra su propia fuente»).
//
// MUTACION OBLIGATORIA (una por superficie, `progress/impl_462_frontend.md`): quitar la guarda de
// `cuantas <= 0` en el componente pone ROJO el primer caso.

afterEach(cleanup);

describe("462/R27 — RetieneReprogramadasBadge", () => {
  it("con 0, `null` o `undefined` no renderiza NADA (ni texto, ni badge vacio)", () => {
    for (const cuantas of [0, null, undefined]) {
      const { container } = render(<RetieneReprogramadasBadge cuantas={cuantas} />);
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByText(/Retiene/)).toBeNull();
      cleanup();
    }
  });

  it("con 1 pinta el singular, literal a mano", () => {
    render(<RetieneReprogramadasBadge cuantas={1} />);
    expect(screen.getByText("Retiene 1 paquete reprogramado para hoy")).toBeInTheDocument();
  });

  it("con 3 pinta el plural, literal a mano, y NO el singular", () => {
    render(<RetieneReprogramadasBadge cuantas={3} />);
    expect(screen.getByText("Retiene 3 paquetes reprogramados para hoy")).toBeInTheDocument();
    expect(screen.queryByText(/Retiene 1 paquete/)).toBeNull();
  });

  it("tiene nombre accesible (aria-label) y nota (title) que explican que no se puede asignar hasta aprobar", () => {
    render(<RetieneReprogramadasBadge cuantas={2} />);
    const badge = screen.getByText("Retiene 2 paquetes reprogramados para hoy");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Retiene 2 paquetes reprogramados para hoy. 2 paquetes reprogramados para hoy no se pueden asignar hasta que se apruebe este cierre.",
    );
    expect(badge).toHaveAttribute(
      "title",
      "2 paquetes reprogramados para hoy no se pueden asignar hasta que se apruebe este cierre.",
    );
  });

  it("usa la variante `warning` de la primitiva Badge (tokens semanticos, sin hex; DESIGN.md)", () => {
    render(<RetieneReprogramadasBadge cuantas={2} />);
    const badge = screen.getByText("Retiene 2 paquetes reprogramados para hoy");
    expect(badge).toHaveAttribute("data-variant", "warning");
    expect(badge.className).toContain("bg-warning-soft");
    expect(badge.className).toContain("text-warning-strong");
    expect(badge.className).not.toMatch(/#[0-9a-f]{3,6}|emerald|amber-|yellow-/i);
  });

  it("455 §0.3: el plural femenino retirado «reprogramadas» no aparece en el DOM", () => {
    const { container } = render(<RetieneReprogramadasBadge cuantas={5} />);
    expect(container.innerHTML).not.toMatch(/reprogramadas/i);
  });
});
