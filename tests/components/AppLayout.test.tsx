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

// Feature 211: el layout lee la cookie del tema con `cookies()` de next/headers para
// estampar la clase del tema en el servidor. Fuera de una petición real esa API lanza
// («`cookies` was called outside a request scope»), así que se mockea con un almacén
// controlable. Por defecto: sin cookie -> tema «sistema».
const cookieTemaMock = vi.fn<() => string | undefined>(() => undefined);
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nombre: string) =>
      nombre === "ordenex_tema" && cookieTemaMock() !== undefined
        ? { name: nombre, value: cookieTemaMock() }
        : undefined,
  }),
}));

// El layout también resuelve el NOMBRE del usuario (para el footer del sidebar) vía
// UserRepository.findById; se mockea el repo y el cliente Prisma para no tocar la BD.
vi.mock("@/lib/db/prisma-client", () => ({ getPrismaClient: () => ({}) }));
vi.mock("@/lib/repositories/UserRepository", () => ({
  UserRepository: class {
    findById = vi.fn().mockResolvedValue({ id: "u1", nombre: "Ada Lovelace" });
  },
}));

// Como el layout es async, se invoca y se espera su árbol antes de renderizar.
async function renderLayout(children: ReactNode) {
  const ui = await AppLayout({ children });
  return render(ui);
}

describe("Layout de la zona autenticada app/(app)/layout.tsx", () => {
  it("monta el sidebar con los ítems visibles del actor y los children (R14)", async () => {
    // Actor maestro: ve sus ítems (Configuración, Órdenes, Ranking…).
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
      screen.getByRole("button", { name: /configuración/i }),
    ).toBeInTheDocument();
    // Feature 196 (T4.5): "Ranking" pasó a tener subítems ("Ranking del día" / "Histórico"),
    // así que el Sidebar lo renderiza como disparador colapsable y ya no como enlace. La
    // intención del caso —que el ítem del maestro esté montado— se conserva intacta.
    expect(screen.getByRole("button", { name: /ranking/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Órdenes" })).toBeInTheDocument();
    // ...junto con los children del layout.
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
    expect(screen.getByText("Contenido de la página")).toBeInTheDocument();
    // Footer del sidebar: nombre, rol legible e iniciales (máx 2) del avatar.
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Maestro")).toBeInTheDocument();
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("filtra el sidebar según el rol del actor (adminSatelite: su portal, no la Configuración ni el listado maestro)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u2", rol: "adminSatelite" });

    await renderLayout(<div>Contenido</div>);

    expect(
      screen.queryByRole("button", { name: /configuración/i }),
    ).toBeNull();
    // Hay DOS ítems con label "Órdenes": el del maestro/admin/adminTienda
    // (`/ordenes`) y el portal del adminSatelite (`/recepcion-satelite`). El
    // adminSatelite NO ve el listado maestro (`/ordenes`) pero SÍ su portal.
    const ordenesLinks = screen.getAllByRole("link", { name: "Órdenes" });
    const hrefs = ordenesLinks.map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/recepcion-satelite");
    expect(hrefs).not.toContain("/ordenes");
  });

  it("expone el control de alternado del sidebar para móvil (off-canvas)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    await renderLayout(<div>Contenido</div>);

    // El SidebarTrigger de shadcn dispara el Sheet off-canvas en móvil.
    expect(
      screen.getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
  });

  // Feature 211 — el tema lo resuelve EL SERVIDOR. Es lo que hace que el HTML llegue ya
  // con la clase puesta y no haya que corregir nada después del primer pintado: si esto
  // se rompiera, el tema seguiría cambiando al pulsar y volvería a parpadear al recargar.
  it("estampa la clase del tema que dice la COOKIE, sin esperar a que el cliente hidrate", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    for (const [cookie, clase] of [
      ["oscuro", "dark"],
      ["claro", "tema-claro"],
      ["sistema", "tema-sistema"],
    ] as const) {
      cookieTemaMock.mockReturnValue(cookie);
      const { unmount } = await renderLayout(<div>Contenido</div>);

      const envoltorio = document.querySelector(`[data-tema="${cookie}"]`);
      expect(envoltorio, `sin envoltorio para la cookie ${cookie}`).not.toBeNull();
      expect(envoltorio!.className.split(" ")).toContain(clase);
      // `contents`: estampar el tema no puede alterar el layout de la aplicación.
      expect(envoltorio!.className.split(" ")).toContain("contents");
      unmount();
    }
    cookieTemaMock.mockReturnValue(undefined);
  });

  it("sin cookie —y con una cookie manipulada— cae en «sistema», que respeta la preferencia del SO", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    for (const cookie of [undefined, "azul", ""]) {
      cookieTemaMock.mockReturnValue(cookie);
      const { unmount } = await renderLayout(<div>Contenido</div>);

      const envoltorio = document.querySelector("[data-tema]");
      expect(envoltorio!.getAttribute("data-tema"), `cookie=${String(cookie)}`).toBe("sistema");
      expect(envoltorio!.className.split(" ")).toContain("tema-sistema");
      expect(envoltorio!.className.split(" ")).not.toContain("dark");
      unmount();
    }
    cookieTemaMock.mockReturnValue(undefined);
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
