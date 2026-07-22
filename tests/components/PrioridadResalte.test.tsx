// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import type { Column } from "@/components/shared/DataTable";
import {
  PRIORIDAD_RESALTE_CLASS,
  conBadgePrioridad,
  resaltarFilaPrioridad,
} from "@/components/shared/PrioridadResalte";

// Feature 101 (R8/R10): las 3 piezas del resalte de prioridad que reusan idénticas
// las dos superficies de reasignación (apartado `en_bodega` de /ordenes y grupo
// "Recibidas" de /recepcion-satelite). Se prueban aisladas; el comportamiento real
// end-to-end (una superficie resalta, la hermana NO) se cubre en
// RecepcionSateliteModule.test.tsx.

type Fila = { id: string; nombre: string; prioridad?: boolean };

const columnas: Column<Fila>[] = [
  { id: "nombre", value: "Nombre", render: "nombre" },
  { id: "id", value: "ID", render: "id" },
];

describe("PrioridadResalte (feature 101)", () => {
  it("resaltarFilaPrioridad: devuelve la clase de resalte SOLO si prioridad === true", () => {
    const prioritaria: Fila = { id: "a", nombre: "A", prioridad: true };
    const normal: Fila = { id: "b", nombre: "B", prioridad: false };
    const sinFlag: Fila = { id: "c", nombre: "C" };
    expect(resaltarFilaPrioridad(prioritaria)).toBe(PRIORIDAD_RESALTE_CLASS);
    expect(resaltarFilaPrioridad(normal)).toBeUndefined();
    // Sin el flag (superficie que no expone prioridad) → sin resalte (R10).
    expect(resaltarFilaPrioridad(sinFlag)).toBeUndefined();
  });

  it("conBadgePrioridad: la fila prioritaria anexa el badge 'Prioritaria' en la 1.ª columna de datos", () => {
    const [primera] = conBadgePrioridad(columnas);
    render(
      <table>
        <tbody>
          <tr>
            <td>{(primera.render as (r: Fila) => React.ReactNode)({
              id: "p1",
              nombre: "Orden Prioritaria",
              prioridad: true,
            })}</td>
          </tr>
        </tbody>
      </table>,
    );
    // El valor original se conserva y se le suma el marcador accesible (no solo color).
    expect(screen.getByText("Orden Prioritaria")).toBeInTheDocument();
    expect(screen.getByText("Prioritaria")).toBeInTheDocument();
  });

  it("conBadgePrioridad: la fila NO prioritaria conserva la celda SIN el badge", () => {
    const [primera] = conBadgePrioridad(columnas);
    render(
      <table>
        <tbody>
          <tr>
            <td>{(primera.render as (r: Fila) => React.ReactNode)({
              id: "n1",
              nombre: "Orden Normal",
              prioridad: false,
            })}</td>
          </tr>
        </tbody>
      </table>,
    );
    expect(screen.getByText("Orden Normal")).toBeInTheDocument();
    expect(screen.queryByText("Prioritaria")).toBeNull();
  });

  it("conBadgePrioridad: NO altera las cabeceras ni el resto de columnas", () => {
    const decoradas = conBadgePrioridad(columnas);
    expect(decoradas).toHaveLength(columnas.length);
    expect(decoradas.map((c) => c.value)).toEqual(["Nombre", "ID"]);
    // La 2.ª columna queda intacta (misma referencia).
    expect(decoradas[1]).toBe(columnas[1]);
  });
});
