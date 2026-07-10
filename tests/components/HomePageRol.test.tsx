// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type { RolValue } from "@prisma/client";

// Ramificación de app/(app)/page.tsx por rol (feature 26, R1/R3/R4/R5). El rol se
// resuelve SOLO server-side vía resolveActorFromSession (R5): aquí se mockea.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

// Rama placeholder: page.tsx sigue leyendo cookie/sesión cuando el rol != adminTienda.
const cookieGetMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

const findValidByIdMock = vi.fn();
vi.mock("@/lib/repositories/SessionRepository", () => ({
  SessionRepository: vi.fn().mockImplementation(function SessionRepositoryMock(this: {
    findValidById: typeof findValidByIdMock;
  }) {
    this.findValidById = findValidByIdMock;
  }),
}));

vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-button-stub">Cerrar sesión</button>,
}));

// El dashboard monta OrdenesModule (cliente), que consume esta action.
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: vi.fn(),
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarOrdenesMock = vi.mocked(listarOrdenes);

/** Envuelve el árbol devuelto por Home() con los providers del módulo cliente. */
function renderHome(element: ReactElement): void {
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {element}
      </SWRConfig>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
});

afterEach(() => {
  cleanup();
});

describe("app/(app)/page.tsx — ramificación por rol (feature 26)", () => {
  it("R1: rol adminTienda con sesión válida renderiza el dashboard del admin de tienda", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });

    const { default: Home } = await import("@/app/(app)/page");
    const element = await Home();
    renderHome(element);

    expect(
      screen.getByRole("heading", { level: 1, name: "Panel de tienda" }),
    ).toBeInTheDocument();
    // No es el placeholder genérico.
    expect(screen.queryByText("Bienvenido")).toBeNull();
  });

  it("R5: el rol se resuelve server-side invocando resolveActorFromSession (sin hook de cliente)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });

    const { default: Home } = await import("@/app/(app)/page");
    await Home();

    expect(resolveActorMock).toHaveBeenCalledTimes(1);
  });

  it("R3: un rol distinto de adminTienda NO renderiza el dashboard de tienda, conserva el placeholder", async () => {
    // Feature 23: maestro/admin ahora ven el dashboard maestro (cubierto en
    // HomePageMaestro.test.tsx), por lo que ya no conservan el placeholder aquí.
    // Los roles que siguen viendo "Bienvenido" son mensajero y adminSatelite.
    const otrosRoles: RolValue[] = [
      "mensajero",
      "adminSatelite",
    ];

    for (const rol of otrosRoles) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      cookieGetMock.mockReturnValue({ value: "session-abc" });
      findValidByIdMock.mockResolvedValue({
        id: "session-abc",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      });

      const { default: Home } = await import("@/app/(app)/page");
      const element = await Home();
      renderHome(element);

      expect(screen.queryByRole("heading", { name: "Panel de tienda" })).toBeNull();
      expect(screen.getByText("Bienvenido")).toBeInTheDocument();

      cleanup();
      vi.clearAllMocks();
      listarOrdenesMock.mockResolvedValue({
        status: "ok",
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
      });
    }
  });

  it("R4: sin sesión válida (actor null) NO renderiza el dashboard", async () => {
    resolveActorMock.mockResolvedValue(null);
    cookieGetMock.mockReturnValue(undefined);

    const { default: Home } = await import("@/app/(app)/page");
    const element = await Home();
    renderHome(element);

    expect(screen.queryByRole("heading", { name: "Panel de tienda" })).toBeNull();
    expect(screen.getByText("Bienvenido")).toBeInTheDocument();
    // Sin sesión, tampoco el botón de logout.
    expect(screen.queryByTestId("logout-button-stub")).toBeNull();
  });
});
