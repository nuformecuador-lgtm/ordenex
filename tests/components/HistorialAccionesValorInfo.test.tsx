// @vitest-environment jsdom
// FICHA 456 (T3.13, R9/R10; hallazgo 2 de `progress/review_456.md`) — las celdas «Valor anterior» y
// «Valor nuevo» del registro de acciones.
//
// Por qué existe: la guardia solo reconoce un símbolo vigilado DIRECTO en el `render`. El revisor
// devolvió `historial-acciones-columnas.ts` a su versión previa a la 456 (`render: (fila) =>
// valorLegible(…) ?? SIN_DATO`, sin botón) y todo siguió verde (X2). Este archivo fija lo que la
// pantalla promete —el nombre del resultado CON su botón— y, a la vez, el motivo de la excepción
// `descarga` del mismo archivo en la guardia: la descarga lleva el NOMBRE, sin botón (R17).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";

import { columnasHistorialAcciones } from "@/app/(app)/historico/acciones/_components/historial-acciones-columnas";
import { filaDescargaHistorialAccion } from "@/app/(app)/historico/acciones/_components/historial-acciones-descarga-columnas";
import type { HistorialAccionDTO } from "@/lib/types/historial-accion";

afterEach(() => cleanup());

function fila(extra: Partial<HistorialAccionDTO> = {}): HistorialAccionDTO {
  return {
    id: "3f0a1c62-6b7e-4a51-9f3d-2a1b4c5d6e7f",
    fecha: "2026-09-02T05:30:00.000Z",
    accion: "cierre_dia_gestion_corregida",
    accionLabel: "Corrigió el resultado de una gestión",
    categoria: "mueve_dinero",
    entidadTipo: "orden",
    entidadEtiqueta: "Guía 1234",
    actorNombre: "Ana Mora",
    actorRol: "admin",
    monto: null,
    valorAnterior: "reprogramado",
    valorNuevo: "entregado",
    loteId: "9c8b7a65-4321-4d0e-8f1a-0b1c2d3e4f50",
    ...extra,
  };
}

/** Pinta la celda de UNA columna tal como la monta `DataTable` (su `render`). */
function celda(id: "anterior" | "nuevo", f: HistorialAccionDTO): HTMLElement {
  const col = columnasHistorialAcciones.find((c) => c.id === id);
  if (typeof col?.render !== "function") throw new Error(`la columna «${id}» no pinta con una función`);
  const { container } = render(<div data-testid={id}>{col.render(f)}</div>);
  return container.firstElementChild as HTMLElement;
}

describe("456 · registro de acciones — el valor que es un resultado lleva su botón", () => {
  it("R10 — «Valor anterior» y «Valor nuevo» de una corrección de resultado: nombre y botón", () => {
    const f = fila();
    const anterior = celda("anterior", f);
    expect(anterior.textContent).toContain("Reprogramado");
    expect(within(anterior).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Qué significa «Reprogramado»",
    ]);
    const nuevo = celda("nuevo", f);
    expect(nuevo.textContent).toContain("Entregado");
    expect(within(nuevo).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Qué significa «Entregado»",
    ]);
  });

  it("otra acción: el valor es texto tal cual, SIN botón (no es un estado)", () => {
    const f = fila({ accion: "orden_eliminada", valorAnterior: "reprogramado", valorNuevo: "Tienda X" });
    const anterior = celda("anterior", f);
    expect(anterior.textContent).toBe("reprogramado");
    expect(within(anterior).queryAllByRole("button")).toHaveLength(0);
    expect(within(celda("nuevo", f)).queryAllByRole("button")).toHaveLength(0);
  });

  it("valor vacío en una corrección: la raya, sin botón", () => {
    const vacia = celda("anterior", fila({ valorAnterior: null }));
    expect(vacia.textContent).toBe("—");
    expect(within(vacia).queryAllByRole("button")).toHaveLength(0);
  });

  it("R17 — la DESCARGA de la misma fila lleva el nombre, sin código ni botón (motivo de la excepción `descarga`)", () => {
    const d = filaDescargaHistorialAccion(fila());
    expect(d.anterior).toBe("Reprogramado");
    expect(d.nuevo).toBe("Entregado");
  });
});
