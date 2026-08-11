// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

// Import estático (no `await import()` dentro de cada `it`) para que la carga
// del árbol de la página no cuente contra `testTimeout`. Los `vi.mock` de abajo
// son *hoisted* por Vitest; además la página lee los mocks en tiempo de llamada
// a `Home()`, no de importación, y sin `resetModules` los `await import()`
// repetidos ya devolvían el mismo módulo cacheado: la semántica no cambia.
import Home from "@/app/(app)/dashboard/page";
import { ToastProvider } from "@/providers/ToastProvider";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { listarPostulacionesPendientes } from "@/lib/actions/aprobacion-postulaciones";
import {
  SIDEBAR_ITEMS,
  itemsVisibles,
  primerDestino,
} from "@/lib/auth/menu-visibility";
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
    renderHome(await Home());

    expect(
      screen.getByRole("heading", { level: 1, name: "Panel maestro" }),
    ).toBeInTheDocument();
  });

  // Pedido humano del 2026-08-10: el `adminTienda` ya NO tiene panel propio en `/dashboard`
  // (la R1 de la feature 26 queda derogada; ver `HomePageRol.test.tsx`). Lo que ESTE archivo
  // afirma —que es lo de la feature 23— no cambia: el adminTienda no se cuela en el panel
  // MAESTRO ni dispara su consulta de postulaciones. Solo cambia el desenlace: antes pintaba
  // su propio panel, ahora redirige. Se CONSERVA la aserción de que `listarPendientes` no se
  // llama, que es la que de verdad protege contra la fuga entre ramas.
  it("R2: el adminTienda no cae en el panel maestro ni dispara su consulta (feature 23 intacta)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });

    await expect(Home()).rejects.toThrow(/NEXT_REDIRECT/);

    expect(screen.queryByText("Panel maestro")).toBeNull();
    expect(listarPendientesMock).not.toHaveBeenCalled();
  });

  // Pedido humano: `/dashboard` dejó de ser una pantalla. Quien no tiene un dashboard
  // propio aterriza en el PRIMER ítem de su sidebar; el placeholder solo queda para
  // quien no tiene ningún ítem visible (sin sesión).
  it("R3: mensajero/adminSatelite aterrizan en su primer ítem del sidebar", async () => {
    const roles: RolValue[] = ["mensajero", "adminSatelite"];

    for (const rol of roles) {
      const actor = { usuarioId: "u1", rol };
      resolveActorMock.mockResolvedValue(actor);
      cookieGetMock.mockReturnValue(undefined);

      const esperado = primerDestino(itemsVisibles(SIDEBAR_ITEMS, actor));
      expect(esperado).not.toBeNull();
      // `redirect()` corta el render lanzando: no llega a pintarse ningún dashboard.
      await expect(Home()).rejects.toMatchObject({
        digest: expect.stringContaining(`;${esperado};`),
      });

      cleanup();
      vi.clearAllMocks();
      resetActions();
    }
  });

  it("R3: sin sesión no hay a dónde ir y queda el placeholder Bienvenido", async () => {
    resolveActorMock.mockResolvedValue(null);
    cookieGetMock.mockReturnValue(undefined);
    renderHome(await Home());

    expect(screen.getByText("Bienvenido")).toBeInTheDocument();
    expect(screen.queryByText("Panel maestro")).toBeNull();
    expect(screen.queryByText("Panel de tienda")).toBeNull();
  });

  it("R4: el rol se resuelve server-side vía resolveActorFromSession", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    await Home();

    expect(resolveActorMock).toHaveBeenCalledTimes(1);
  });
});
