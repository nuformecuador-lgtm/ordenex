// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { Sidebar } from "@/app/(app)/_components/Sidebar";

// usePathname es configurable por test; useRouter se mockea porque el patrón
// del repo lo espera aunque el Sidebar no lo consuma directamente.
const pushMock = vi.fn();
let currentPathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => currentPathname,
}));

// next/link se reemplaza por un <a> real (mantiene el Sidebar bajo prueba tal
// cual; solo se evita el runtime del router de Next y la navegación de jsdom).
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    onClick,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    onClick?: (e: React.MouseEvent) => void;
  } & ComponentProps<"a">) => (
    <a
      href={typeof href === "string" ? href : "#"}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  currentPathname = "/";
});

describe("Sidebar", () => {
  it("render de items (R1, R2, R3)", () => {
    render(<Sidebar />);

    const nav = screen.getByRole("navigation", {
      name: /navegación principal/i,
    });
    expect(nav).toBeInTheDocument();

    // Estado colapsado por defecto: solo el listado de escritorio está montado,
    // así que hay exactamente 3 enlaces sin ambigüedad.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);

    const config = screen.getByRole("link", { name: "Configuración" });
    const perfil = screen.getByRole("link", { name: "Perfil" });
    const ordenes = screen.getByRole("link", { name: "Órdenes" });

    expect(config).toHaveAttribute("href", "/configuracion");
    expect(perfil).toHaveAttribute("href", "/perfil");
    expect(ordenes).toHaveAttribute("href", "/ordenes");

    // href internos: empiezan con "/" y no con "//"
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//")).toBe(false);
    }
  });

  it("feature 36/R9: el rol mensajero ve la entrada 'Mis asignaciones'; otros roles no", () => {
    const { unmount } = render(<Sidebar rol="mensajero" />);
    const mensajeroLink = screen.getByRole("link", { name: "Mis asignaciones" });
    expect(mensajeroLink).toHaveAttribute("href", "/mis-asignaciones");
    // Base (3) + 1 exclusiva del mensajero.
    expect(screen.getAllByRole("link")).toHaveLength(4);
    unmount();

    // Otro rol: sin la entrada exclusiva; solo las 3 base.
    render(<Sidebar rol="maestro" />);
    expect(
      screen.queryByRole("link", { name: "Mis asignaciones" }),
    ).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("item activo (R4, R5)", () => {
    const cases: Array<{ path: string; active: string }> = [
      { path: "/configuracion", active: "Configuración" },
      { path: "/perfil", active: "Perfil" },
      { path: "/ordenes", active: "Órdenes" },
    ];

    for (const { path, active } of cases) {
      currentPathname = path;
      const { unmount } = render(<Sidebar />);

      for (const link of screen.getAllByRole("link")) {
        if (link.textContent === active) {
          expect(link).toHaveAttribute("aria-current", "page");
        } else {
          expect(link).not.toHaveAttribute("aria-current");
        }
      }
      unmount();
    }

    // Ruta ajena: ningún item marcado como activo (R5)
    currentPathname = "/";
    render(<Sidebar />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("responsive: boton de menu colapsado por defecto (R7, R11)", () => {
    render(<Sidebar />);

    const button = screen.getByRole("button", { name: /abrir menú/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    // Listado móvil no montado mientras está colapsado.
    expect(screen.queryByTestId("sidebar-mobile-list")).not.toBeInTheDocument();
  });

  it("toggle abre y cierra (R8, R9, R11)", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const button = screen.getByRole("button", { name: /abrir menú/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("sidebar-mobile-list")).not.toBeInTheDocument();

    // Abrir
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const mobileList = screen.getByTestId("sidebar-mobile-list");
    expect(within(mobileList).getAllByRole("link")).toHaveLength(3);

    // Cerrar
    await user.click(screen.getByRole("button", { name: /cerrar menú/i }));
    expect(
      screen.getByRole("button", { name: /abrir menú/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("sidebar-mobile-list")).not.toBeInTheDocument();
  });

  it("cierra al navegar desde un item (R10)", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(screen.getByRole("button", { name: /abrir menú/i }));
    const mobileList = screen.getByTestId("sidebar-mobile-list");
    expect(
      screen.getByRole("button", { name: /cerrar menú/i }),
    ).toHaveAttribute("aria-expanded", "true");

    // Click en un item del listado móvil abierto
    await user.click(within(mobileList).getByRole("link", { name: "Perfil" }));

    expect(
      screen.getByRole("button", { name: /abrir menú/i }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("sidebar-mobile-list")).not.toBeInTheDocument();
  });

  it("operable por teclado (R12, R13)", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const button = screen.getByRole("button", { name: /abrir menú/i });

    // Los 3 items son alcanzables por tabulación en orden (R12).
    // El primer tab llega al botón hamburguesa; los siguientes a los links.
    await user.tab();
    expect(button).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Perfil" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Órdenes" })).toHaveFocus();

    // Enter/Espacio sobre el botón alterna aria-expanded (R13).
    button.focus();
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("button", { name: /cerrar menú/i }),
    ).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(
      screen.getByRole("button", { name: /abrir menú/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
