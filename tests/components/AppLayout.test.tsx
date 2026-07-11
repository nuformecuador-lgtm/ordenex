// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import AppLayout from "@/app/(app)/layout";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";

// El layout monta el <Sidebar /> (Client Component) que usa usePathname; se
// mockea next/navigation y next/link igual que en Sidebar.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

// Feature 36: el layout ahora resuelve el actor server-side para pasar el rol al
// Sidebar. Se mockea (sin sesión → rol undefined → sidebar base).
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(async () => null),
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);

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

describe("Layout de la zona autenticada app/(app)/layout.tsx", () => {
  it("monta el sidebar y los children (R14)", async () => {
    resolveActorMock.mockResolvedValue(null);
    const layout = await AppLayout({
      children: <div data-testid="page-children">Contenido de la página</div>,
    });
    render(layout);

    // El landmark de navegación del Sidebar está presente...
    expect(
      screen.getByRole("navigation", { name: /navegación principal/i }),
    ).toBeInTheDocument();
    // ...junto con los children del layout.
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
    expect(screen.getByText("Contenido de la página")).toBeInTheDocument();
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
