// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { Sidebar } from "@/app/(app)/_components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { MenuItem } from "@/lib/auth/menu-visibility";

// usePathname es configurable por test; useRouter se mockea porque el patrón
// del repo lo espera aunque el Sidebar no lo consuma directamente.
const pushMock = vi.fn();
let currentPathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => currentPathname,
}));

// next/link se reemplaza por un <a> real. El Sidebar de shadcn lo pasa vía la
// prop `render` de SidebarMenuButton (variante base-ui), por lo que el <a>
// recibe className, data-* y children ya mergeados por useRender.
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

// El Sidebar de shadcn requiere el SidebarProvider (contexto useSidebar). Sin
// prop `items` usa el default (SIDEBAR_ITEMS de menu-visibility).
function renderSidebar(items?: readonly MenuItem[]) {
  return render(
    <SidebarProvider>
      <Sidebar items={items} />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentPathname = "/";
});

describe("Sidebar", () => {
  it("render de los items principales (R1, R2, R3)", () => {
    renderSidebar();

    const nav = screen.getByRole("navigation", {
      name: /navegación principal/i,
    });
    expect(nav).toBeInTheDocument();

    // Perfil y Órdenes son enlaces directos.
    const perfil = screen.getByRole("link", { name: "Perfil" });
    const ordenes = screen.getByRole("link", { name: "Órdenes" });
    expect(perfil).toHaveAttribute("href", "/perfil");
    expect(ordenes).toHaveAttribute("href", "/ordenes");

    // Configuración tiene subítems: es un botón colapsable, no un enlace.
    const config = screen.getByRole("button", { name: /configuración/i });
    expect(config).toBeInTheDocument();
    expect(config).toHaveAttribute("aria-expanded", "false");
  });

  it("cada item tiene un icono propio (svg de lucide)", () => {
    renderSidebar();

    const config = screen.getByRole("button", { name: /configuración/i });
    const perfil = screen.getByRole("link", { name: "Perfil" });
    const ordenes = screen.getByRole("link", { name: "Órdenes" });

    for (const el of [config, perfil, ordenes]) {
      expect(el.querySelector("svg")).not.toBeNull();
    }
  });

  it("los enlaces internos empiezan con '/' y no con '//'", () => {
    renderSidebar();
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//")).toBe(false);
    }
  });

  it("expande el submenú y muestra los subítems con href correctos", async () => {
    const user = userEvent.setup();
    renderSidebar();

    // Cerrado por defecto: los subítems no están en el DOM.
    expect(screen.queryByRole("link", { name: "Tarifas" })).toBeNull();
    expect(screen.queryByRole("link", { name: "API" })).toBeNull();

    // Al abrir el colapsable aparecen los subítems.
    await user.click(screen.getByRole("button", { name: /configuración/i }));

    const usuarios = screen.getByRole("link", { name: "Usuarios" });
    const tarifas = screen.getByRole("link", { name: "Tarifas" });
    const api = screen.getByRole("link", { name: "API" });
    expect(usuarios).toHaveAttribute("href", "/configuracion");
    expect(tarifas).toHaveAttribute("href", "/configuracion/tarifas");
    expect(api).toHaveAttribute("href", "/configuracion/api");
  });

  it("abre el submenú por defecto cuando un subítem está activo (R4)", () => {
    currentPathname = "/configuracion/tarifas";
    renderSidebar();

    const config = screen.getByRole("button", { name: /configuración/i });
    expect(config).toHaveAttribute("aria-expanded", "true");

    const tarifas = screen.getByRole("link", { name: "Tarifas" });
    expect(tarifas).toHaveAttribute("aria-current", "page");
    expect(tarifas).toHaveAttribute("data-active");

    const api = screen.getByRole("link", { name: "API" });
    expect(api).not.toHaveAttribute("aria-current");
  });

  it("marca item simple activo por ruta (R4, R5)", () => {
    const cases: Array<{ path: string; active: string }> = [
      { path: "/ordenes", active: "Órdenes" },
      { path: "/perfil", active: "Perfil" },
    ];

    for (const { path, active } of cases) {
      currentPathname = path;
      const { unmount } = renderSidebar();

      const link = screen.getByRole("link", { name: active });
      expect(link).toHaveAttribute("aria-current", "page");
      expect(link).toHaveAttribute("data-active");
      unmount();
    }

    // Ruta ajena: ningún item simple marcado como activo (R5).
    currentPathname = "/";
    renderSidebar();
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it("los items son operables por teclado (R12)", () => {
    renderSidebar();

    for (const link of screen.getAllByRole("link")) {
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href");
    }
    // El trigger del submenú es un botón enfocable.
    const config = screen.getByRole("button", { name: /configuración/i });
    expect(config.tagName).toBe("BUTTON");
  });

  it("renderiza solo los items recibidos por prop (filtrado por rol en el server)", () => {
    // Set de prueba ya filtrado: solo Perfil (p.ej. rol adminSatelite).
    const items: readonly MenuItem[] = [
      { label: "Perfil", href: "/perfil", iconKey: "user", roles: [] },
    ];
    renderSidebar(items);

    expect(screen.getByRole("link", { name: "Perfil" })).toHaveAttribute(
      "href",
      "/perfil",
    );
    // Los items no incluidos en la prop no se renderizan.
    expect(screen.queryByRole("button", { name: /configuración/i })).toBeNull();
    expect(screen.queryByRole("link", { name: "Órdenes" })).toBeNull();
  });

  it("resuelve el icono por iconKey en cada item recibido", () => {
    const items: readonly MenuItem[] = [
      { label: "Configuración", href: "/configuracion", iconKey: "settings", roles: [] },
      {
        label: "Órdenes",
        href: "/ordenes",
        iconKey: "package",
        roles: [],
        children: [{ label: "Todas", href: "/ordenes" }],
      },
    ];
    renderSidebar(items);

    expect(
      screen.getByRole("link", { name: "Configuración" }).querySelector("svg"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /órdenes/i }).querySelector("svg"),
    ).not.toBeNull();
  });
});

describe("Sidebar colapso (desktop)", () => {
  it("expone un control accesible de colapso", () => {
    renderSidebar();
    // Expandido por defecto (SidebarProvider defaultOpen): la acción es colapsar.
    expect(
      screen.getByRole("button", { name: /colapsar menú/i }),
    ).toBeInTheDocument();
  });

  it("alterna el estado al activarlo (colapsar/expandir)", async () => {
    const user = userEvent.setup();
    renderSidebar();

    // Estado inicial: expandido. El botón dice "Colapsar menú".
    const colapsar = screen.getByRole("button", { name: /colapsar menú/i });
    await user.click(colapsar);

    // Tras el click el estado cambió: ahora ofrece "Expandir menú".
    const expandir = await screen.findByRole("button", {
      name: /expandir menú/i,
    });
    expect(expandir).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /colapsar menú/i }),
    ).toBeNull();

    // Y vuelve a expandir.
    await user.click(expandir);
    expect(
      screen.getByRole("button", { name: /colapsar menú/i }),
    ).toBeInTheDocument();
  });
});

// Feature 57 — el control de logout ("Salir") vive ahora en el topbar del
// PageHeader compartido, NO en el sidebar. Su presencia se cubre en
// PageHeader.test.tsx y su comportamiento en LogoutButton.test.tsx; el sidebar
// ya no renderiza ningún control de logout.
it("el sidebar NO renderiza ningún control de logout (movido al PageHeader)", () => {
  renderSidebar();

  expect(screen.queryByRole("button", { name: "Salir" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Cerrar sesión" }),
  ).toBeNull();
});

// Guard: el submenú se agrupa dentro de un SidebarMenuItem del nav principal.
describe("Sidebar estructura", () => {
  it("el submenú vive dentro del landmark de navegación", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: /configuración/i }));

    const nav = screen.getByRole("navigation", {
      name: /navegación principal/i,
    });
    expect(
      within(nav).getByRole("link", { name: "Usuarios" }),
    ).toBeInTheDocument();
  });
});
