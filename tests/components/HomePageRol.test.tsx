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

// Feature 57: el LogoutButton (client: useRouter/useToast) lo monta ahora el
// PageHeader compartido (topbar) que usan tanto los dashboards como el
// placeholder. Se stubbea para aislar la ramificación por rol de la home.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-button-stub">Salir</button>,
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
    await Home();

    expect(resolveActorMock).toHaveBeenCalledTimes(1);
  });

  it("R3: un rol distinto de adminTienda NO renderiza el dashboard de tienda — ahora ni llega a pintar", async () => {
    // Feature 23: maestro/admin ven el dashboard maestro (cubierto en
    // HomePageMaestro.test.tsx), así que ya no conservan el placeholder aquí.
    //
    // Y el "Bienvenido" que mensajero y adminSatelite conservaban TAMPOCO existe ya: por
    // pedido humano esta home los manda al PRIMER ítem de su sidebar en vez de dejarlos en
    // una pantalla vacía (ver el porqué en `app/(app)/dashboard/page.tsx`). R3 se cumple
    // MÁS fuerte que antes —no es que no vean el panel de tienda: es que no ven nada,
    // porque la home redirige antes de renderizar—, y eso es justo lo que se afirma.
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
      // `redirect()` de Next corta el render lanzando: la home nunca devuelve un árbol,
      // así que no hay nada donde pudiera colarse el panel de tienda.
      await expect(Home()).rejects.toThrow(/NEXT_REDIRECT/);

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
    const element = await Home();
    renderHome(element);

    expect(screen.queryByRole("heading", { name: "Panel de tienda" })).toBeNull();
    expect(screen.getByText("Bienvenido")).toBeInTheDocument();
    // El placeholder usa el PageHeader compartido, cuyo topbar aporta el control
    // de logout (feature 57): el stub está presente.
    expect(screen.getByTestId("logout-button-stub")).toBeInTheDocument();
  });
});
