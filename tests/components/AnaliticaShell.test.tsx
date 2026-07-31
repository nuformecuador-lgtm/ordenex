// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { AnaliticaShell } from "@/app/(app)/analitica/_components/AnaliticaShell";

// El shell usa `AppPage` -> `PageHeader`, que monta el `LogoutButton` (client)
// en su topbar. Ese botón usa `useRouter()` (next/navigation) y `useToast()`, y
// además invoca la Server Action de logout; los tres lanzan/importan backend sin
// su contexto, así que se mockean para aislar el shell (mismo patrón que
// `tests/components/PageHeader.test.tsx`). Nada de esto es dominio del shell.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
vi.mock("@/lib/actions/auth", () => ({
  logout: vi.fn(),
}));

afterEach(cleanup);

describe("Feature 129 (R18, R19) — el shell es un componente propio con props tipadas", () => {
  it("renderiza el encabezado de página con el título 'Analítica' sin props", () => {
    render(<AnaliticaShell />);
    expect(
      screen.getByRole("heading", { name: "Analítica" }),
    ).toBeInTheDocument();
  });

  it("renderiza el mismo encabezado recibiendo props (filtros/operativo)", () => {
    render(
      <AnaliticaShell
        filtros={<span>filtro de prueba</span>}
        operativo={<span>panel de prueba</span>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Analítica" }),
    ).toBeInTheDocument();
  });
});

describe("Feature 129 (R20) — exactamente dos regiones, sin región financiera", () => {
  it("expone EXACTAMENTE dos regiones, con nombres accesibles 'Filtros' y 'Tablero operativo' en ese orden", () => {
    render(<AnaliticaShell />);
    const regiones = screen.getAllByRole("region");
    expect(regiones).toHaveLength(2);
    expect(regiones[0]).toHaveAccessibleName("Filtros");
    expect(regiones[1]).toHaveAccessibleName("Tablero operativo");
  });

  it("no existe ninguna región financiera (la añade la 132)", () => {
    render(<AnaliticaShell />);
    expect(
      screen.queryByRole("region", { name: /financ/i }),
    ).toBeNull();
  });
});

describe("Feature 129 (R21) — el contenido de cada slot se pinta dentro de SU región", () => {
  it("filtros se renderiza dentro de la región 'Filtros' y operativo dentro de 'Tablero operativo', no cruzados", () => {
    render(
      <AnaliticaShell
        filtros={<span>contenido de filtros</span>}
        operativo={<span>contenido operativo</span>}
      />,
    );

    const regionFiltros = screen.getByRole("region", { name: "Filtros" });
    const regionOperativo = screen.getByRole("region", {
      name: "Tablero operativo",
    });

    expect(
      within(regionFiltros).getByText("contenido de filtros"),
    ).toBeInTheDocument();
    expect(
      within(regionFiltros).queryByText("contenido operativo"),
    ).toBeNull();

    expect(
      within(regionOperativo).getByText("contenido operativo"),
    ).toBeInTheDocument();
    expect(
      within(regionOperativo).queryByText("contenido de filtros"),
    ).toBeNull();
  });
});

describe("Feature 129 (R22) — sin contenido, estado vacío y CERO cifras/métricas", () => {
  it("cada región muestra su estado vacío cuando no recibe contenido", () => {
    render(<AnaliticaShell />);

    const regionFiltros = screen.getByRole("region", { name: "Filtros" });
    const regionOperativo = screen.getByRole("region", {
      name: "Tablero operativo",
    });
    expect(
      within(regionFiltros).getByText(/entrega posterior/i),
    ).toBeInTheDocument();
    expect(
      within(regionOperativo).getByText(/entrega posterior/i),
    ).toBeInTheDocument();
  });

  it("el texto de las regiones del shell no contiene NINGÚN dígito: un '0' de placeholder es indistinguible de un cero real", () => {
    // Se afirma sobre las DOS regiones que pinta el shell (no sobre `document.body`
    // entero): el `PageHeader` compartido trae de fábrica una fecha con dígitos
    // ("30/07/2026") que es chrome de la app, no contenido del tablero, y no debe
    // hacer fallar esta prueba. Dentro de las regiones, en cambio, cualquier cifra
    // suelta (una serie, un eje, un contador) se leería como un dato real de
    // negocio, y R22 lo prohíbe explícitamente.
    render(<AnaliticaShell />);
    const regiones = screen.getAllByRole("region");
    for (const region of regiones) {
      expect(region.textContent ?? "").not.toMatch(/\d/);
    }
  });
});

describe("Feature 129 (R23) — el shell no fetchea", () => {
  it("no llama a fetch al renderizar sin datos", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AnaliticaShell />);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
