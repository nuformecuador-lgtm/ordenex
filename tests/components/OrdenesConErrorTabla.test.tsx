// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import {
  OrdenesConErrorTabla,
  formatErrores,
} from "@/app/(app)/ordenes/_components/OrdenesConErrorTabla";
import type { OrdenConError } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

afterEach(() => {
  cleanup();
});

const ERRORES: OrdenConError[] = [
  {
    fila: 1,
    numRemision: "REM-0001",
    errores: {
      num_remision: ["obligatorio"],
      telefono: ["formato inválido"],
    },
  },
  {
    fila: 2,
    numRemision: "REM-0002",
    errores: {},
  },
];

describe("OrdenesConErrorTabla — detalle por fila, solo lectura (R18, R19)", () => {
  it("lista cada fila con error con su motivo", () => {
    render(<OrdenesConErrorTabla errores={ERRORES} />);

    expect(screen.getByText("REM-0001")).toBeInTheDocument();
    expect(screen.getByText("REM-0002")).toBeInTheDocument();
    expect(
      screen.getByText("num_remision: obligatorio; telefono: formato inválido"),
    ).toBeInTheDocument();
  });

  it("muestra motivo generico si no hay detalle de errores", () => {
    render(<OrdenesConErrorTabla errores={ERRORES} />);
    expect(screen.getByText("Error de validación")).toBeInTheDocument();
  });

  it("no ofrece controles de recarga", () => {
    render(<OrdenesConErrorTabla errores={ERRORES} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("formatErrores — aplana el mapa a texto legible (R19)", () => {
  it("une campo: mensajes separados por ';'", () => {
    expect(
      formatErrores({ a: ["x", "y"], b: ["z"] }),
    ).toBe("a: x, y; b: z");
  });

  it("mapa vacío → motivo genérico", () => {
    expect(formatErrores({})).toBe("Error de validación");
  });

  it("entradas sin mensajes → motivo genérico", () => {
    expect(formatErrores({ a: [] })).toBe("Error de validación");
  });
});
