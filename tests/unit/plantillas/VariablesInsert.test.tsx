// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { useRef, useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

import {
  VariablesInsert,
  insertarPlaceholder,
} from "@/app/(app)/configuracion/plantillas/_components/VariablesInsert";
import { previewConEjemplos } from "@/lib/utils/plantilla-mensaje";
import type { PreviewPlantillaResult } from "@/lib/types/plantilla-mensaje";

afterEach(() => {
  cleanup();
});

/** Harness: replica al formulario anfitrión (textarea controlado + botonera). */
function Harness({
  inicial = "",
  previewAction,
}: {
  inicial?: string;
  previewAction?: (cuerpo: string) => Promise<PreviewPlantillaResult>;
}) {
  const [cuerpo, setCuerpo] = useState(inicial);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div>
      <textarea
        aria-label="Cuerpo"
        ref={ref}
        value={cuerpo}
        onChange={(e) => setCuerpo(e.target.value)}
      />
      <VariablesInsert
        textareaRef={ref}
        value={cuerpo}
        onInsert={(next) => setCuerpo(next)}
        previewAction={previewAction}
      />
    </div>
  );
}

describe("insertarPlaceholder (helper puro)", () => {
  it("R17: inserta {{clave}} en el rango del cursor y devuelve la nueva posición", () => {
    // Cursor colapsado en la posición 1 de "AB": "A" | "B".
    expect(insertarPlaceholder("AB", 1, 1, "usuario")).toEqual({
      cuerpo: "A{{usuario}}B",
      caret: 1 + "{{usuario}}".length,
    });
  });

  it("R17: reemplaza la selección [start, end) por el placeholder", () => {
    expect(insertarPlaceholder("Hola XXX", 5, 8, "cod")).toEqual({
      cuerpo: "Hola {{cod}}",
      caret: 5 + "{{cod}}".length,
    });
  });
});

describe("VariablesInsert", () => {
  // R13/R17: el catalogo predefinido esta VACIO por defecto, por lo que la botonera de
  // "Insertar {{clave}}" a partir de una semilla ya no existe. La nueva UI (input para
  // que el usuario defina sus propias variables) y estos tests los rehace frontend_dev
  // al reworkear VariablesInsert. La logica de insercion sigue cubierta por los tests de
  // `insertarPlaceholder` (helper puro) arriba.
  it.skip("R17: inserta {{usuario}} en la posición del cursor del textarea", () => {
    render(<Harness inicial="AB" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");
    // Coloca el cursor entre la A y la B.
    textarea.setSelectionRange(1, 1);

    fireEvent.click(
      screen.getByRole("button", { name: "Insertar {{usuario}}" }),
    );

    expect(textarea.value).toBe("A{{usuario}}B");
  });

  it.skip("R17: inserta al final cuando no hay selección activa", () => {
    render(<Harness inicial="Hola " />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");
    textarea.setSelectionRange(5, 5);

    fireEvent.click(screen.getByRole("button", { name: "Insertar {{cod}}" }));

    expect(textarea.value).toBe("Hola {{cod}}");
  });

  it("R18: con catalogo vacio la vista previa cae al marcador en mayúsculas", async () => {
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(
      <Harness
        inicial="Hola {{usuario}}, tu orden {{cod}}"
        previewAction={previewAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Vista previa" }));

    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveTextContent(
        "Hola USUARIO, tu orden COD",
      );
    });
    expect(previewAction).toHaveBeenCalledWith("Hola {{usuario}}, tu orden {{cod}}");
  });

  it("R18: una clave bien formada fuera del catálogo cae a un marcador en mayúsculas", async () => {
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(<Harness inicial="Hola {{desconocida}}" previewAction={previewAction} />);

    fireEvent.click(screen.getByRole("button", { name: "Vista previa" }));

    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveTextContent(
        "Hola DESCONOCIDA",
      );
    });
  });
});
