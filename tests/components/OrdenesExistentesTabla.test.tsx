// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { OrdenesExistentesTabla } from "@/app/(app)/ordenes/_components/OrdenesExistentesTabla";
import type { OrdenExistente } from "@/app/(app)/ordenes/_components/carga-masiva-clasificacion";

afterEach(() => {
  cleanup();
});

const EXISTENTES: OrdenExistente[] = [
  { numRemision: "REM-0001", estatus: "en_preparacion" },
  { numRemision: "REM-0002", estatus: null },
];

describe("OrdenesExistentesTabla — solo lectura (R5, R6)", () => {
  it("muestra el estado como etiqueta legible", () => {
    render(<OrdenesExistentesTabla existentes={EXISTENTES} />);

    expect(screen.getByText("REM-0001")).toBeInTheDocument();
    // en_preparacion → "En preparación" (etiqueta, no value crudo)
    expect(screen.getByText("En preparación")).toBeInTheDocument();
    expect(screen.queryByText("en_preparacion")).not.toBeInTheDocument();
  });

  it("estatus null → '—'", () => {
    render(<OrdenesExistentesTabla existentes={EXISTENTES} />);

    expect(screen.getByText("REM-0002")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("no ofrece ninguna accion de recarga sobre las existentes", () => {
    render(<OrdenesExistentesTabla existentes={EXISTENTES} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
