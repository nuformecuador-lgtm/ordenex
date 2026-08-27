// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { useRef, useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

import {
  VariablesInsert,
  insertarPlaceholder,
  PREVIEW_DEBOUNCE_MS,
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
  variablesNombres,
}: {
  inicial?: string;
  previewAction?: (cuerpo: string) => Promise<PreviewPlantillaResult>;
  variablesNombres?: Record<string, string>;
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
        variablesNombres={variablesNombres}
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

/** Avanza el debounce del panel de vista previa bajo temporizadores falsos. */
async function avanzarDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 1);
  });
}

describe("VariablesInsert", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("R10 + R18: resuelve con los datos de ejemplo del catálogo y no toca el textarea", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(
      <Harness inicial="Hola {{cliente}}, total {{monto}}" previewAction={previewAction} />,
    );

    await avanzarDebounce();

    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveValue(
        "Hola María Rodríguez, total ₡12.500",
      );
    });
    expect(screen.getByLabelText<HTMLTextAreaElement>("Cuerpo").value).toBe(
      "Hola {{cliente}}, total {{monto}}",
    );
  });

  it("R13: el resumen lista los campos usados, deduplicados y en orden de aparición", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(<Harness inicial="{{monto}} y {{cliente}} y {{monto}}" previewAction={previewAction} />);

    await avanzarDebounce();
    await waitFor(() => expect(previewAction).toHaveBeenCalled());

    const botones = screen.getAllByRole("button");
    expect(botones.map((b) => b.textContent)).toEqual(["Monto a cobrar", "Cliente"]);
  });

  it("R14: editar el textarea a mano actualiza panel y resumen sin otra interacción", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(<Harness inicial="Total {{monto}}" previewAction={previewAction} />);
    await avanzarDebounce();
    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveValue("Total ₡12.500");
    });

    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");
    fireEvent.change(textarea, { target: { value: "Total " } });
    await avanzarDebounce();

    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveValue("Total ");
    });
    expect(
      screen.queryByRole("button", { name: "Monto a cobrar" }),
    ).not.toBeInTheDocument();
  });

  it("R15: clave fuera del catálogo avisa y el panel muestra el hueco real", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(<Harness inicial="Hola {{sucursal}}" previewAction={previewAction} />);
    await avanzarDebounce();

    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveValue("Hola ");
    });
    expect(
      screen.getByTestId<HTMLTextAreaElement>("plantilla-preview").value,
    ).toBe("Hola ");

    const alerta = screen.getByRole("alert");
    expect(alerta.textContent).toContain("{{sucursal}}");
    expect(alerta.textContent).toContain(
      "no es un campo válido y llegará vacío al cliente",
    );
  });

  it("R16: con nombre persistido el aviso dice «ya no existe» y nombra el snapshot", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );

    // Sin snapshot: nunca fue válida.
    const { unmount } = render(
      <Harness inicial="Hola {{sucursal}}" previewAction={previewAction} />,
    );
    await avanzarDebounce();
    await waitFor(() => {
      const alerta = screen.getByRole("alert");
      expect(alerta.textContent).toContain("{{sucursal}}");
      expect(alerta.textContent).toContain("no es un campo válido");
    });
    unmount();

    // Con snapshot: fue retirada del catálogo.
    render(
      <Harness
        inicial="Hola {{sucursal}}"
        previewAction={previewAction}
        variablesNombres={{ sucursal: "Sucursal" }}
      />,
    );
    await avanzarDebounce();
    await waitFor(() => {
      const alerta = screen.getByRole("alert");
      expect(alerta.textContent).toContain("{{sucursal}}");
      expect(alerta.textContent).toContain("Sucursal");
      expect(alerta.textContent).toContain("ya no existe");
    });
  });

  it("R5: un alias resuelve con su ejemplo, con su nombre limpio y sin aviso", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(<Harness inicial="{{num_guia}}" previewAction={previewAction} />);
    await avanzarDebounce();

    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveValue("10432");
    });
    expect(
      screen.getByRole("button", { name: "Número de guía" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("R7: elegir un campo en el picker lo inserta en la posición del cursor", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(<Harness inicial="Hola , gracias" previewAction={previewAction} />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");
    textarea.setSelectionRange(5, 5); // "Hola |, gracias"

    const filtro = screen.getByRole("textbox", { name: /campo/i });
    fireEvent.change(filtro, { target: { value: "monto" } });
    fireEvent.click(screen.getByRole("option", { name: /Monto a cobrar/ }));

    expect(textarea.value).toBe("Hola {{monto}}, gracias");
  });

  it("Nuevo — orden en el DOM: la vista previa aparece antes del selector de campos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(<Harness inicial="Total {{monto}}" previewAction={previewAction} />);
    await avanzarDebounce();
    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveValue("Total ₡12.500");
    });

    const preview = screen.getByTestId("plantilla-preview");
    const filtro = screen.getByRole("textbox", { name: /campo/i });

    expect(
      preview.compareDocumentPosition(filtro) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("Nuevo — solo lectura: el panel de vista previa tiene readOnly y escribir en él no cambia el cuerpo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(<Harness inicial="Total {{monto}}" previewAction={previewAction} />);
    await avanzarDebounce();
    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveValue("Total ₡12.500");
    });

    const preview = screen.getByTestId<HTMLTextAreaElement>("plantilla-preview");
    expect(preview).toHaveAttribute("readonly");
    expect(preview).toHaveAttribute("aria-readonly", "true");

    fireEvent.change(preview, { target: { value: "algo distinto" } });

    expect(screen.getByTestId("plantilla-preview")).toHaveValue("Total ₡12.500");
    expect(screen.getByLabelText<HTMLTextAreaElement>("Cuerpo").value).toBe(
      "Total {{monto}}",
    );
  });

  it("debounce: varias pulsaciones dentro de la ventana solo disparan una llamada", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (cuerpo: string): Promise<PreviewPlantillaResult> => ({
        status: "ok",
        texto: previewConEjemplos(cuerpo),
      }),
    );
    render(<Harness inicial="" previewAction={previewAction} />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");

    fireEvent.change(textarea, { target: { value: "H" } });
    fireEvent.change(textarea, { target: { value: "Ho" } });
    fireEvent.change(textarea, { target: { value: "Hol" } });
    fireEvent.change(textarea, { target: { value: "Hola" } });

    await avanzarDebounce();

    expect(previewAction).toHaveBeenCalledTimes(1);
    expect(previewAction).toHaveBeenCalledWith("Hola");
  });

  it("respuesta tardía: un cuerpo anterior que resuelve tarde no pisa el panel actual", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const resolvers = new Map<string, (r: PreviewPlantillaResult) => void>();
    const previewAction = vi.fn(
      (cuerpo: string) =>
        new Promise<PreviewPlantillaResult>((resolve) => {
          resolvers.set(cuerpo, resolve);
        }),
    );
    render(<Harness inicial="" previewAction={previewAction} />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");

    fireEvent.change(textarea, { target: { value: "Cuerpo A" } });
    await avanzarDebounce();
    expect(previewAction).toHaveBeenCalledWith("Cuerpo A");

    fireEvent.change(textarea, { target: { value: "Cuerpo B" } });
    await avanzarDebounce();
    expect(previewAction).toHaveBeenCalledWith("Cuerpo B");

    // Resuelve primero B (actual), luego A (anterior, tardía).
    await act(async () => {
      resolvers.get("Cuerpo B")?.({ status: "ok", texto: "texto B" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveValue("texto B");
    });

    await act(async () => {
      resolvers.get("Cuerpo A")?.({ status: "ok", texto: "texto A" });
    });
    expect(screen.getByTestId("plantilla-preview")).toHaveValue("texto B");
  });

  // M1: el caso que el descarte por «ultima peticion lanzada» NO cubria. A esta en vuelo y
  // B aun no ha salido (sigue dentro de su ventana de debounce), asi que no hay ninguna
  // peticion posterior con la que comparar: solo una bandera invalidada por el cleanup del
  // efecto sabe que el cuerpo de A ya no esta en pantalla.
  it("respuesta en vuelo: si el usuario teclea, la respuesta de A no pinta aunque B siga en debounce", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const resolvers = new Map<string, (r: PreviewPlantillaResult) => void>();
    const previewAction = vi.fn(
      (cuerpo: string) =>
        new Promise<PreviewPlantillaResult>((resolve) => {
          resolvers.set(cuerpo, resolve);
        }),
    );
    render(<Harness inicial="" previewAction={previewAction} />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>("Cuerpo");

    // A sale: se lanza de verdad y queda EN VUELO, sin resolver.
    fireEvent.change(textarea, { target: { value: "Cuerpo A" } });
    await avanzarDebounce();
    expect(previewAction).toHaveBeenCalledWith("Cuerpo A");
    expect(previewAction).toHaveBeenCalledTimes(1);

    // El usuario teclea B. Su debounce AUN NO expira: B no se ha pedido todavia.
    fireEvent.change(textarea, { target: { value: "Cuerpo B" } });
    expect(previewAction).toHaveBeenCalledTimes(1);

    // A responde ahora, con B en pantalla y sin peticion posterior con la que compararse.
    await act(async () => {
      resolvers.get("Cuerpo A")?.({ status: "ok", texto: "texto A" });
    });

    // El panel NO puede mostrar el cuerpo que el maestro ya cambio. Existe siempre (con su
    // placeholder), asi que lo que se afirma es que sigue VACIO, no que desaparezca.
    expect(screen.getByTestId("plantilla-preview")).toHaveValue("");
    expect(screen.getByTestId("plantilla-preview")).not.toHaveValue("texto A");

    // Y cuando B expira y resuelve, ese si pinta.
    await avanzarDebounce();
    expect(previewAction).toHaveBeenCalledWith("Cuerpo B");
    await act(async () => {
      resolvers.get("Cuerpo B")?.({ status: "ok", texto: "texto B" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("plantilla-preview")).toHaveValue("texto B");
    });
  });

  // Pedido humano 2026-08-27: un cuerpo a medio escribir NO es un error que regañar. La
  // rama `validation_error` deja de pintar un alert y el panel se queda vacio con su
  // placeholder; el fallo REAL de la accion si sigue avisando.
  it("cuerpo a medias: sin alert, el panel queda vacio con su placeholder", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (): Promise<PreviewPlantillaResult> => ({
        status: "validation_error",
        fieldErrors: { cuerpo: ["llave malformada"] },
      }),
    );
    render(<Harness inicial="Hola {{" previewAction={previewAction} />);

    await avanzarDebounce();

    const panel = screen.getByTestId("plantilla-preview");
    expect(panel).toHaveValue("");
    expect(panel).toHaveAttribute("placeholder", "Hola...");
    // Ni rastro del viejo «Corrige el cuerpo antes de ver la vista previa.»
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un fallo real de la accion SI avisa, y ese alert se conserva", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const previewAction = vi.fn(
      async (): Promise<PreviewPlantillaResult> => ({ status: "forbidden" }),
    );
    render(<Harness inicial="Hola" previewAction={previewAction} />);

    await avanzarDebounce();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "No se pudo generar la vista previa.",
      );
    });
    expect(screen.getByTestId("plantilla-preview")).toHaveValue("");
  });
});
