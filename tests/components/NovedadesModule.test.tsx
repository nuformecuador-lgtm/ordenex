// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { NovedadesModule } from "@/app/(app)/novedades/_components/NovedadesModule";
import type { NovedadDTO } from "@/lib/types/novedad";

// Feature 87 (T14) — modulo cliente de `/novedades`. Cubre R9 (fila con guia/destinatario/
// causa/contacto + placeholder si numGuia null), R10 (estado vacio), R11 (label ES, no slug)
// y R22 (Pagination con total/page). Se mockea la Server Action (re-fetch) y el toast.
vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({
  id: "o1",
  numGuia: 12345,
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  causa: "not_found",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("NovedadesModule", () => {
  it("R10: lista vacia -> estado vacio, sin filas", () => {
    render(<NovedadesModule items={[]} total={0} page={1} pageSize={10} />);

    expect(screen.getByText(/No tenés órdenes en devolución/i)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Órdenes en devolución" })).toBeNull();
  });

  it("R9: por cada orden muestra guia, destinatario y botones de contacto", () => {
    render(
      <NovedadesModule
        items={[novedad({ id: "o1", numGuia: 12345, destinatario: "Ana Cliente" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText(/12345/)).toBeInTheDocument();
    expect(screen.getByText("Ana Cliente")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Llamar a Ana Cliente" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "WhatsApp a Ana Cliente" }),
    ).toBeInTheDocument();
  });

  it("R9: numGuia null -> placeholder legible, no rompe la fila", () => {
    render(
      <NovedadesModule
        items={[novedad({ numGuia: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText(/sin asignar/i)).toBeInTheDocument();
  });

  it("R11: muestra la etiqueta ES de la causa, nunca el slug crudo del enum", () => {
    render(
      <NovedadesModule
        items={[novedad({ causa: "not_found" })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Cliente no localizado")).toBeInTheDocument();
    expect(screen.queryByText("not_found")).toBeNull();
  });

  it("R7: causa null -> 'Sin causa registrada'", () => {
    render(
      <NovedadesModule
        items={[novedad({ causa: null })]}
        total={1}
        page={1}
        pageSize={10}
      />,
    );

    expect(screen.getByText("Sin causa registrada")).toBeInTheDocument();
  });

  it("R22: renderiza la Pagination con el total y la pagina recibidos", () => {
    render(
      <NovedadesModule
        items={[novedad()]}
        total={25}
        page={2}
        pageSize={10}
      />,
    );

    // total 25 / pageSize 10 = 3 paginas; page 2 de 3.
    expect(
      screen.getByRole("navigation", { name: "Paginación de novedades" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
  });
});
