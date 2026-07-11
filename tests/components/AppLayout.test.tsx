// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import AppLayout from "@/app/(app)/layout";

// El layout monta el <Sidebar /> (Client Component) que usa usePathname; se
// mockea next/navigation y next/link igual que en Sidebar.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

// El layout es un Server Component async que resuelve el actor desde la sesión
// (cookies + Prisma). Se mockea `resolveActorFromSession` para devolver un actor
// con rol conocido y evitar tocar next/headers ni la base de datos.
const resolveActorMock = vi.fn();
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: () => resolveActorMock(),
}));

// Como el layout es async, se invoca y se espera su árbol antes de renderizar.
async function renderLayout(children: ReactNode) {
  const ui = await AppLayout({ children });
  return render(ui);
}

describe("Layout de la zona autenticada app/(app)/layout.tsx", () => {
  it("monta el sidebar con los ítems visibles del actor y los children (R14)", async () => {
    // Actor maestro: ve los 3 ítems (Configuración, Perfil, Órdenes).
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    await renderLayout(
      <div data-testid="page-children">Contenido de la página</div>,
    );

    // El landmark de navegación del Sidebar (shadcn) está presente...
    expect(
      screen.getByRole("navigation", { name: /navegación principal/i }),
    ).toBeInTheDocument();
    // ...con los ítems visibles para maestro...
    expect(
      screen.getByRole("link", { name: "Configuración" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Perfil" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /órdenes/i })).toBeInTheDocument();
    // ...junto con los children del layout.
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
    expect(screen.getByText("Contenido de la página")).toBeInTheDocument();
  });

  it("filtra el sidebar según el rol del actor (adminSatelite solo ve Perfil)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u2", rol: "adminSatelite" });

    await renderLayout(<div>Contenido</div>);

    expect(screen.getByRole("link", { name: "Perfil" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Configuración" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /órdenes/i })).toBeNull();
  });

  it("expone el control de alternado del sidebar para móvil (off-canvas)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    await renderLayout(<div>Contenido</div>);

    // El SidebarTrigger de shadcn dispara el Sheet off-canvas en móvil.
    expect(
      screen.getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
  });

  it("/login no incluye el sidebar (R15)", () => {
    // /login vive fuera del grupo (app): ni el layout raíz ni la página de login
    // montan el Sidebar. Se verifica de forma estructural sobre el código fuente.
    const rootLayout = readFileSync(
      resolve(process.cwd(), "app/layout.tsx"),
      "utf8",
    );
    const loginPage = readFileSync(
      resolve(process.cwd(), "app/login/page.tsx"),
      "utf8",
    );

    expect(rootLayout).not.toMatch(/Sidebar/);
    expect(loginPage).not.toMatch(/Sidebar/);
  });
});
