// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

// Feature 288 — `FormSheet`: ancho por props (`max(<pct>vw, <px>px)`).
//
// jsdom (via `cssstyle`) NO reconoce la función CSS `max()` como valor válido de
// `width`: al aplicar el `style` inline sobre un nodo real, la asignación se
// descarta en silencio (el atributo `style` del DOM real queda sin ese `width`),
// aunque en cualquier navegador real (y en producción) es CSS válido y funciona.
// Para no depender de esa limitación de jsdom, se mockea `SheetContent` para que
// renderice el objeto `style` que le llega TAL CUAL, como JSON en un atributo, sin
// que jsdom intente parsearlo como CSS. Así se verifica exactamente lo que
// `FormSheet` construye y le pasa a `SheetContent`, que es lo que importa: cómo lo
// interpreta jsdom al aplicarlo de verdad no es responsabilidad de este componente.
vi.mock("@/components/ui/sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/sheet")>();
  return {
    ...actual,
    SheetContent: ({
      style,
      children,
    }: {
      style?: React.CSSProperties;
      children?: ReactNode;
    }) => (
      <div data-slot="sheet-content" data-style={JSON.stringify(style)}>
        {children}
      </div>
    ),
  };
});

const { FormSheet } = await import(
  "@/app/(app)/configuracion/plantillas/_components/FormSheet"
);

afterEach(() => {
  cleanup();
});

function getPanelStyle(): { width?: string; maxWidth?: string } {
  const panel = document.body.querySelector(
    '[data-slot="sheet-content"]',
  ) as HTMLElement;
  return JSON.parse(panel.getAttribute("data-style") ?? "{}");
}

describe("FormSheet — ancho", () => {
  it("con el default, el panel usa max(30vw, 300px) y maxWidth none", async () => {
    render(
      <FormSheet
        open
        onOpenChange={() => {}}
        title="Título de prueba"
        confirmLabel="Confirmar"
        onConfirm={() => {}}
      >
        <p>Contenido</p>
      </FormSheet>,
    );
    await screen.findByText("Título de prueba");
    const style = getPanelStyle();
    expect(style.width).toBe("max(30vw, 300px)");
    expect(style.maxWidth).toBe("none");
  });

  it("con anchoPorcentaje=45, el panel usa max(45vw, 300px)", async () => {
    render(
      <FormSheet
        open
        onOpenChange={() => {}}
        title="Título de prueba"
        confirmLabel="Confirmar"
        onConfirm={() => {}}
        anchoPorcentaje={45}
      >
        <p>Contenido</p>
      </FormSheet>,
    );
    await screen.findByText("Título de prueba");
    const style = getPanelStyle();
    expect(style.width).toBe("max(45vw, 300px)");
    expect(style.maxWidth).toBe("none");
  });

  it("el suelo minimo se respeta aun con un porcentaje muy chico (anchoMinimoPx=420)", async () => {
    render(
      <FormSheet
        open
        onOpenChange={() => {}}
        title="Título de prueba"
        confirmLabel="Confirmar"
        onConfirm={() => {}}
        anchoPorcentaje={5}
        anchoMinimoPx={420}
      >
        <p>Contenido</p>
      </FormSheet>,
    );
    await screen.findByText("Título de prueba");
    const style = getPanelStyle();
    // El suelo (420px) sigue dentro de la expresión `max(...)`: con un porcentaje
    // chico, en un viewport angosto seguiría ganando el mínimo.
    expect(style.width).toBe("max(5vw, 420px)");
  });
});
