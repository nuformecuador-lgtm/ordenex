// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { listarPostulacionesPendientes } from "@/lib/actions/aprobacion-postulaciones";
import type { RolValue } from "@prisma/client";

// Feature 23 — ramificación de app/(app)/page.tsx por rol. maestro/admin ven el
// dashboard maestro (R1); adminTienda conserva su Panel de tienda (R2, feature 26
// intacta); mensajero/adminSatelite/sin sesión ven el placeholder (R3). El rol se
// resuelve SOLO server-side vía resolveActorFromSession (R4): aquí se mockea.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));

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
  LogoutButton: () => <button data-testid="logout-button-stub">Salir</button>,
}));

// El dashboard adminTienda monta OrdenesModule (consume listarOrdenes).
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: vi.fn(),
}));

// El dashboard maestro monta el panel (consume listarPostulacionesPendientes).
vi.mock("@/lib/actions/aprobacion-postulaciones", () => ({
  listarPostulacionesPendientes: vi.fn(),
  aprobarPostulacion: vi.fn(),
  rechazarPostulacion: vi.fn(),
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarOrdenesMock = vi.mocked(listarOrdenes);
const listarPendientesMock = vi.mocked(listarPostulacionesPendientes);

function renderHome(element: ReactElement): void {
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {element}
      </SWRConfig>
    </ToastProvider>,
  );
}

function resetActions(): void {
  listarOrdenesMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  listarPendientesMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetActions();
});

afterEach(() => {
  cleanup();
});

describe("app/(app)/page.tsx — ramificación maestro/admin (feature 23)", () => {
  it("R1: rol maestro renderiza el dashboard maestro con el panel de postulaciones", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    const { default: Home } = await import("@/app/(app)/dashboard/page");
    renderHome(await Home());

    expect(
      screen.getByRole("heading", { level: 1, name: "Panel maestro" }),
    ).toBeInTheDocument();
    await screen.findByText("No hay postulaciones pendientes");
    expect(screen.queryByText("Bienvenido")).toBeNull();
    expect(screen.queryByText("Panel de tienda")).toBeNull();
  });

  it("R1: rol admin también renderiza el dashboard maestro", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "admin" });

    const { default: Home } = await import("@/app/(app)/dashboard/page");
    renderHome(await Home());

    expect(
      screen.getByRole("heading", { level: 1, name: "Panel maestro" }),
    ).toBeInTheDocument();
  });

  it("R2: rol adminTienda conserva el Panel de tienda (feature 26 intacta)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });

    const { default: Home } = await import("@/app/(app)/dashboard/page");
    renderHome(await Home());

    expect(
      screen.getByRole("heading", { level: 1, name: "Panel de tienda" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Panel maestro")).toBeNull();
    expect(listarPendientesMock).not.toHaveBeenCalled();
  });

  it("R3: mensajero/adminSatelite/sin sesión conservan el placeholder Bienvenido", async () => {
    const roles: (RolValue | null)[] = ["mensajero", "adminSatelite", null];

    for (const rol of roles) {
      resolveActorMock.mockResolvedValue(
        rol ? { usuarioId: "u1", rol } : null,
      );
      cookieGetMock.mockReturnValue(undefined);

      const { default: Home } = await import("@/app/(app)/dashboard/page");
      renderHome(await Home());

      expect(screen.getByText("Bienvenido")).toBeInTheDocument();
      expect(screen.queryByText("Panel maestro")).toBeNull();
      expect(screen.queryByText("Panel de tienda")).toBeNull();

      cleanup();
      vi.clearAllMocks();
      resetActions();
    }
  });

  it("R4: el rol se resuelve server-side vía resolveActorFromSession", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    const { default: Home } = await import("@/app/(app)/dashboard/page");
    await Home();

    expect(resolveActorMock).toHaveBeenCalledTimes(1);
  });
});
