// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";

// El PageHeader monta el LogoutButton (client) en su topbar. Ese botón usa
// useRouter() (next/navigation) y useToast() (feature 11); ambos lanzan sin su
// contexto, por lo que se mockean para aislar el header. El comportamiento del
// logout (invocar la Server Action + navegar) se cubre en LogoutButton.test.tsx.
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

// La Server Action de logout es código server; se mockea para no importar el
// backend al montar el LogoutButton.
vi.mock("@/lib/actions/auth", () => ({
  logout: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PageHeader — topbar con control de logout (feature 57)", () => {
  it("renderiza el título como encabezado nivel 1 y la descripción", () => {
    render(<PageHeader title="Órdenes" description="Listado de órdenes" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Órdenes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Listado de órdenes")).toBeInTheDocument();
  });

  it("R1/R2: muestra el control de logout 'Salir' en el topbar (presente en toda página autenticada, independiente del rol)", () => {
    render(<PageHeader title="Panel" />);

    const salir = screen.getByRole("button", { name: "Salir" });
    expect(salir).toBeInTheDocument();
    // R12: elemento nativo <button>, enfocable y operable por teclado.
    expect(salir.tagName).toBe("BUTTON");
    expect(salir).not.toBeDisabled();
  });

  it("el control de logout convive con las `actions` específicas de la página", () => {
    render(
      <PageHeader
        title="Órdenes"
        actions={<Button>Carga masiva</Button>}
      />,
    );

    // Ambos controles coexisten en el topbar.
    expect(
      screen.getByRole("button", { name: "Carga masiva" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });

  it("el control de logout aparece aunque la página no pase `actions`", () => {
    render(<PageHeader title="Perfil" />);

    expect(screen.getByRole("button", { name: "Salir" })).toBeInTheDocument();
  });
});
