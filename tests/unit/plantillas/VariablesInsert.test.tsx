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
  // R13/R17 (Corrección humana 2026-07-22): el catálogo `PLANTILLA_VARIABLES` está VACÍO;
  // no hay botonera-semilla. El usuario DEFINE sus variables escribiéndolas en un input y
  // las inserta como `{{clave}}` en la posición del cursor, tantas veces como necesite.
  it("R17: escribir una clave válida e insertar la coloca en la posición del cursor", () => {
    render(<Harness inicial="AB" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");
    // Coloca el cursor entre la A y la B.
    textarea.setSelectionRange(1, 1);

    const input = screen.getByLabelText<HTMLInputElement>("Insertar variable");
    fireEvent.change(input, { target: { value: "Cliente" } }); // se normaliza a minúsculas
    fireEvent.click(screen.getByRole("button", { name: "Insertar variable" }));

    expect(textarea.value).toBe("A{{cliente}}B");
    // El input se limpia tras insertar, listo para la siguiente variable.
    expect(input.value).toBe("");
  });

  it("R17: una clave con formato inválido NO se inserta y avisa inline", () => {
    render(<Harness inicial="AB" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");
    textarea.setSelectionRange(1, 1);

    const input = screen.getByLabelText<HTMLInputElement>("Insertar variable");
    fireEvent.change(input, { target: { value: "a b" } }); // espacio → inválida
    fireEvent.click(screen.getByRole("button", { name: "Insertar variable" }));

    expect(textarea.value).toBe("AB"); // no inserta
    expect(screen.getByRole("alert")).toBeInTheDocument(); // aviso inline
  });

  it("R17: la clave vacía tampoco inserta y avisa", () => {
    render(<Harness inicial="AB" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");
    textarea.setSelectionRange(2, 2);

    fireEvent.click(screen.getByRole("button", { name: "Insertar variable" }));

    expect(textarea.value).toBe("AB");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("R17: se pueden insertar varias variables distintas (0 o más)", () => {
    render(<Harness inicial="" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");
    const input = screen.getByLabelText<HTMLInputElement>("Insertar variable");
    const boton = screen.getByRole("button", { name: "Insertar variable" });

    fireEvent.change(input, { target: { value: "uno" } });
    fireEvent.click(boton);
    // Coloca el cursor al final para la siguiente inserción.
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.change(input, { target: { value: "dos" } });
    fireEvent.click(boton);

    expect(textarea.value).toBe("{{uno}}{{dos}}");
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
