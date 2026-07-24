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
  // R13/R17 (Corrección humana 2026-07-22): el usuario DEFINE sus variables. Un input
  // dedicado + "Añadir" agrega la clave como un badge removible (sin insertar aún). Al
  // hacer clic en el cuerpo del badge se inserta `{{clave}}` en el cursor; la "x" lo
  // quita de la lista sin tocar el cuerpo.
  it("R17: escribir una clave válida + Añadir crea un badge y NO inserta aún en el cuerpo", () => {
    render(<Harness inicial="AB" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");

    const input = screen.getByLabelText<HTMLInputElement>("Nueva variable");
    fireEvent.change(input, { target: { value: "Cliente" } }); // se normaliza a minúsculas
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    // Aparece el badge (clic-para-insertar) y el input se limpia; el cuerpo NO cambia.
    expect(
      screen.getByRole("button", { name: "Insertar {{cliente}}" }),
    ).toBeInTheDocument();
    expect(textarea.value).toBe("AB");
    expect(input.value).toBe("");
  });

  it("R17: clic en el badge inserta {{clave}} en la posición del cursor", () => {
    render(<Harness inicial="AB" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");
    // Coloca el cursor entre la A y la B.
    textarea.setSelectionRange(1, 1);

    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Nueva variable"), {
      target: { value: "cliente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));
    fireEvent.click(screen.getByRole("button", { name: "Insertar {{cliente}}" }));

    expect(textarea.value).toBe("A{{cliente}}B");
  });

  it("R17: se puede insertar el mismo badge varias veces (0 o más)", () => {
    render(<Harness inicial="" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");

    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Nueva variable"), {
      target: { value: "uno" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    const badge = screen.getByRole("button", { name: "Insertar {{uno}}" });
    fireEvent.click(badge);
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.click(badge);

    expect(textarea.value).toBe("{{uno}}{{uno}}");
  });

  it("R17: clic en la 'x' del badge lo quita de la lista y NO inserta en el cuerpo", () => {
    render(<Harness inicial="AB" />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");

    fireEvent.change(screen.getByLabelText<HTMLInputElement>("Nueva variable"), {
      target: { value: "cliente" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    fireEvent.click(screen.getByRole("button", { name: "Quitar variable cliente" }));

    expect(
      screen.queryByRole("button", { name: "Insertar {{cliente}}" }),
    ).not.toBeInTheDocument();
    expect(textarea.value).toBe("AB"); // quitar no toca el cuerpo
  });

  it("R17: una clave con formato inválido NO crea badge y avisa inline", () => {
    render(<Harness inicial="AB" />);

    const input = screen.getByLabelText<HTMLInputElement>("Nueva variable");
    fireEvent.change(input, { target: { value: "a b" } }); // espacio → inválida
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    expect(
      screen.queryByRole("button", { name: /^Insertar \{\{/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument(); // aviso inline
  });

  it("R17: la clave vacía tampoco añade y avisa", () => {
    render(<Harness inicial="AB" />);

    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));

    expect(
      screen.queryByRole("button", { name: /^Insertar \{\{/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("R17: no añade badges duplicados de la misma clave", () => {
    render(<Harness inicial="" />);
    const input = screen.getByLabelText<HTMLInputElement>("Nueva variable");
    const boton = screen.getByRole("button", { name: "Añadir" });

    fireEvent.change(input, { target: { value: "cliente" } });
    fireEvent.click(boton);
    fireEvent.change(input, { target: { value: "cliente" } });
    fireEvent.click(boton);

    expect(
      screen.getAllByRole("button", { name: "Insertar {{cliente}}" }),
    ).toHaveLength(1);
  });

  it("R17: siembra la lista con las variables ya presentes en el cuerpo al montar", () => {
    render(<Harness inicial="Hola {{usuario}}, tu orden {{cod}}" />);

    expect(
      screen.getByRole("button", { name: "Insertar {{usuario}}" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Insertar {{cod}}" }),
    ).toBeInTheDocument();
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
