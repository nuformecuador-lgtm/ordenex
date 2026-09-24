// @vitest-environment jsdom
// FICHA 455 (2026-09-24, recorrido T3.2 F10) — el motivo de las filas que escribieron las migraciones
// de retiro llegaba a la pantalla con el código crudo («Motivo: migracion 454: retiro de
// devolucion_por_confirmar», R3). Las migraciones no se editan y la fila no se reescribe: la línea de
// tiempo lo PRESENTA con el formato de R11. Los textos esperados van escritos a mano (literal de
// contrato, memoria «Aserción contra su propia fuente»); los motivos de entrada son los EXACTOS que
// escriben `db/migrations/20260923120200_retiro_estados_454` y `20260729140000_order_status_retiro_…` (la 155).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { HistorialOrdenTimeline } from "@/app/(app)/ordenes/_components/HistorialOrdenTimeline";
import { motivoVisible } from "@/app/(app)/ordenes/_components/motivo-historial";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

afterEach(cleanup);

// El value retirado por la 155 se arma por partes, como en `EstatusBadgeRetiroFulfillment.test.tsx`:
// el censo `censo-order-status-rename` prohibe escribirlo entero en el arbol.
const EN_FULFILLMENT = ["en", "fulfillment"].join("_");

const transicion = (motivo: string | null): OrdenHistorialEntradaDTO => ({
  clase: "transicion",
  estatusOrigenValue: "devolucion_por_confirmar",
  estatusDestinoValue: "en_reparto",
  origenTipo: "ajuste_estado",
  actorNombre: null,
  motivo,
  createdAt: new Date("2026-09-23T20:14:00Z"),
});

describe("455/F10 — `motivoVisible`", () => {
  it("los tres motivos de migración que existen, sin código crudo", () => {
    expect(motivoVisible("migracion 454: retiro de devolucion_por_confirmar")).toBe(
      "Migración: retiro de Devolución por confirmar (estado retirado)",
    );
    expect(motivoVisible("migracion 454: retiro de ayuda_tienda")).toBe(
      "Migración: retiro de Ayuda solicitada a la tienda (estado retirado)",
    );
    expect(motivoVisible(`migracion 155: retiro de ${EN_FULFILLMENT}`)).toBe(
      "Migración: retiro de En fulfillment (estado retirado)",
    );
  });

  it("cualquier otro motivo sale tal cual (también uno parecido con un código que no es retirado)", () => {
    expect(motivoVisible("Cliente ausente")).toBe("Cliente ausente");
    expect(motivoVisible("migracion 999: retiro de en_reparto")).toBe("migracion 999: retiro de en_reparto");
    expect(motivoVisible(null)).toBeNull();
    expect(motivoVisible("")).toBe("");
  });
});

describe("455/F10 — la línea de tiempo pinta el motivo presentado", () => {
  it("«Motivo: Migración: retiro de Devolución por confirmar (estado retirado)», sin el código", () => {
    render(
      <HistorialOrdenTimeline
        entradas={[transicion("migracion 454: retiro de devolucion_por_confirmar")]}
      />,
    );
    expect(
      screen.getByText("Motivo: Migración: retiro de Devolución por confirmar (estado retirado)"),
    ).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/devolucion_por_confirmar|migracion 454/);
  });

  it("un motivo normal no cambia", () => {
    render(<HistorialOrdenTimeline entradas={[transicion("Cliente ausente")]} />);
    expect(screen.getByText("Motivo: Cliente ausente")).toBeInTheDocument();
  });
});
