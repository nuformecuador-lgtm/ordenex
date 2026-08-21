// @vitest-environment jsdom
// Feature 253 (T7.3) — el dashboard del maestro con SUS DOS paneles. Cubre R36 (ningún texto de
// la pantalla afirma algo que dejó de ser cierto al añadir el panel) y el montaje del panel nuevo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";

import { AdminMaestroDashboard } from "@/app/(app)/_components/AdminMaestroDashboard";
import { listarPostulacionesPendientes } from "@/lib/actions/aprobacion-postulaciones";
import { listarPostulacionesRecurso } from "@/lib/actions/atencion-postulaciones-recurso";

vi.mock("@/lib/actions/aprobacion-postulaciones", () => ({
  listarPostulacionesPendientes: vi.fn(),
  aprobarPostulacion: vi.fn(),
  rechazarPostulacion: vi.fn(),
}));

vi.mock("@/lib/actions/atencion-postulaciones-recurso", () => ({
  listarPostulacionesRecurso: vi.fn(),
  marcarPostulacionRecursoAtendida: vi.fn(),
}));

// El shell (`AppPage` -> `PageHeader`) monta el botón de salir, que llama a `useRouter`: sin
// router montado el árbol entero revienta. Mismo doble que usa `HomePageMaestro.test.tsx`.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-button-stub">Salir</button>,
}));

// La campana del `PageHeader` consulta notificaciones vía Server Action, que aquí no tiene
// request scope. Se dobla para que el ruido de OTRA feature no se mezcle con lo que este archivo
// mide; la campana tiene su propia suite (146).
vi.mock("@/hooks/useNotificaciones", () => ({
  useNotificaciones: () => ({
    items: [],
    noLeidas: 0,
    isLoading: false,
    error: undefined,
    refrescar: vi.fn(),
    marcarLeidas: vi.fn(),
  }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const listarMensajerosMock = vi.mocked(listarPostulacionesPendientes);
const listarRecursosMock = vi.mocked(listarPostulacionesRecurso);

/** La descripción de la página HASTA esta ficha. Con dos paneles pasó a ser falsa en pequeño. */
const DESCRIPCION_VIEJA = "Postulaciones de mensajeros pendientes";

function renderDashboard(): void {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AdminMaestroDashboard />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMensajerosMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
  listarRecursosMock.mockResolvedValue({
    status: "ok",
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
});

afterEach(() => {
  cleanup();
});

describe("253/R36 — la descripción de la página dice la verdad con DOS paneles", () => {
  it("ya no se describe la pantalla entera como «Postulaciones de mensajeros pendientes»", async () => {
    renderDashboard();
    // Se espera a que los dos paneles asienten antes de mirar: si no, las actualizaciones de SWR
    // caen fuera de `act` y el ruido tapa lo que este caso mide.
    await screen.findByText("No hay postulaciones pendientes");
    await screen.findByText("No hay vehículos ni bodegas por revisar");

    expect(
      screen.getByRole("heading", { level: 1, name: "Panel maestro" }),
    ).toBeInTheDocument();
    // Un texto que dejó de ser cierto es exactamente el defecto que esta ficha cierra una capa
    // más arriba; dejarlo habría sido arreglar el acuse y estrenar otra frase falsa.
    expect(screen.queryByText(DESCRIPCION_VIEJA)).toBeNull();
    expect(
      screen.getByText(
        "Postulaciones pendientes: mensajeros, y vehículos o bodegas ofrecidos desde la web",
      ),
    ).toBeInTheDocument();
  });

  it("los dos bloques están, cada uno con su título y su propio listado", async () => {
    renderDashboard();

    expect(screen.getByText("Postulaciones de mensajeros")).toBeInTheDocument();
    expect(screen.getByText("Vehículos y bodegas ofrecidos")).toBeInTheDocument();

    // Y cada panel consulta LO SUYO: el del recurso no se cuelga del listado del hermano.
    await screen.findByText("No hay postulaciones pendientes");
    expect(await screen.findByText("No hay vehículos ni bodegas por revisar")).toBeInTheDocument();
    expect(listarMensajerosMock).toHaveBeenCalledTimes(1);
    expect(listarRecursosMock).toHaveBeenCalledTimes(1);
  });
});
