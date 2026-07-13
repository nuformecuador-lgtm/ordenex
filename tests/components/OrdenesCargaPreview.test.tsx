// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrdenesCargaPreview } from "@/app/(app)/ordenes/_components/OrdenesCargaPreview";
import type { ClasificacionCarga } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

afterEach(() => cleanup());

function clasif(overrides: Partial<ClasificacionCarga> = {}): ClasificacionCarga {
  return {
    numRemisionesNuevas: [],
    existentes: [],
    errores: [],
    ...overrides,
  };
}

/** Números de remisión de la tabla de errores, en orden de aparición. */
function filasErrorEnOrden(): string[] {
  const tabla = screen.getByRole("table", { name: /órdenes con error/i });
  const celdas = within(tabla).getAllByRole("cell");
  // Columnas: Fila | Nº Remisión | Motivo → tomamos la 2ª de cada terna.
  const remisiones: string[] = [];
  for (let i = 1; i < celdas.length; i += 3) {
    remisiones.push(celdas[i].textContent ?? "");
  }
  return remisiones;
}

describe("OrdenesCargaPreview — confirmación", () => {
  it("con nuevas > 0 habilita 'Confirmar y cargar' y lo dispara", async () => {
    const user = userEvent.setup();
    const onConfirmar = vi.fn();

    render(
      <OrdenesCargaPreview
        clasificacion={clasif({ numRemisionesNuevas: ["REM-A", "REM-B"] })}
        confirmando={false}
        onConfirmar={onConfirmar}
      />,
    );

    const boton = screen.getByRole("button", { name: /confirmar y cargar 2 nuevas/i });
    expect(boton).toBeEnabled();
    await user.click(boton);
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it("sin nuevas (todo duplicado/error) → el botón queda deshabilitado", () => {
    render(
      <OrdenesCargaPreview
        clasificacion={clasif({
          existentes: [{ numRemision: "REM-X", estatus: "en_bodega" }],
        })}
        confirmando={false}
        onConfirmar={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /confirmar y cargar/i }),
    ).toBeDisabled();
  });

  it("confirmando=true → botón deshabilitado con estado de carga", () => {
    render(
      <OrdenesCargaPreview
        clasificacion={clasif({ numRemisionesNuevas: ["REM-A"] })}
        confirmando
        onConfirmar={vi.fn()}
      />,
    );
    const boton = screen.getByRole("button", { name: /cargando/i });
    expect(boton).toBeDisabled();
  });
});

describe("OrdenesCargaPreview — chips de error", () => {
  const clasificacion = clasif({
    numRemisionesNuevas: ["REM-OK"],
    errores: [
      { fila: 1, numRemision: "A", errores: { provincia: ["provincia no encontrada"] } },
      { fila: 2, numRemision: "B", errores: { canton: ["canton no encontrado en la provincia"] } },
      { fila: 3, numRemision: "C", errores: { provincia: ["provincia no encontrada"] } },
    ],
  });

  it("muestra un chip por tipo de error con su conteo", () => {
    render(
      <OrdenesCargaPreview
        clasificacion={clasificacion}
        confirmando={false}
        onConfirmar={vi.fn()}
      />,
    );
    const grupo = screen.getByRole("group", { name: /filtrar errores/i });
    const chips = within(grupo).getAllByRole("button");
    expect(chips).toHaveLength(2);
    // El de mayor conteo (provincia, 2) va primero.
    expect(chips[0]).toHaveTextContent(/provincia no encontrada/i);
    expect(chips[0]).toHaveTextContent("2");
  });

  it("al pulsar un chip, lleva al inicio las filas con ese error", async () => {
    const user = userEvent.setup();
    render(
      <OrdenesCargaPreview
        clasificacion={clasificacion}
        confirmando={false}
        onConfirmar={vi.fn()}
      />,
    );

    // Orden inicial: A, B, C.
    expect(filasErrorEnOrden()).toEqual(["A", "B", "C"]);

    const grupo = screen.getByRole("group", { name: /filtrar errores/i });
    const chipProvincia = within(grupo).getAllByRole("button")[0];
    await user.click(chipProvincia);

    // Las de "provincia no encontrada" (A, C) suben; B queda al final.
    expect(filasErrorEnOrden()).toEqual(["A", "C", "B"]);
    expect(chipProvincia).toHaveAttribute("aria-pressed", "true");

    // Pulsar de nuevo desactiva y restaura el orden original.
    await user.click(chipProvincia);
    expect(filasErrorEnOrden()).toEqual(["A", "B", "C"]);
    expect(chipProvincia).toHaveAttribute("aria-pressed", "false");
  });
});
