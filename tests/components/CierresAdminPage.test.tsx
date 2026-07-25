// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import CierresAdminPage from "@/app/(app)/cierres-admin/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarCierresAdmin } from "@/lib/actions/cierres-admin";
import {
  listarConsolidacion,
  listarCierresBodegaAdmin,
} from "@/lib/actions/cierre-bodega";

// Feature 38 (T12, R1/R3) — la página resuelve el rol SOLO server-side; rol ∉
// {maestro, adminSatelite} (o sin sesión) → `notFound`. Se mockean el resolver, la
// action de listado y next/navigation (notFound lanza; useRouter lo consume el
// módulo cliente).
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/cierres-admin", () => ({
  listarCierresAdmin: vi.fn(),
  verCierreDetalle: vi.fn(),
  aprobarCierre: vi.fn(),
  rechazarCierre: vi.fn(),
  // Feature 111/R16: válvula de escape consumida por el módulo hijo.
  forzarSolicitudVencido: vi.fn(),
}));
// Feature 40: la página, role-aware, pre-fetch los datos de cierre de bodega por rol
// (adminSatelite → consolidación; maestro → cola/histórico). Se mockean para aislar
// el control de acceso de la 38; por defecto `forbidden` → no se renderiza la sección.
vi.mock("@/lib/actions/cierre-bodega", () => ({
  listarConsolidacion: vi.fn(),
  listarCierresBodegaAdmin: vi.fn(),
  solicitarCierreBodega: vi.fn(),
  verCierreBodegaDetalle: vi.fn(),
  aprobarCierreBodega: vi.fn(),
  rechazarCierreBodega: vi.fn(),
}));

class NotFoundError extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarCierresAdmin);
const listarConsolidacionMock = vi.mocked(listarConsolidacion);
const listarCierresBodegaAdminMock = vi.mocked(listarCierresBodegaAdmin);

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({
    status: "ok",
    pendientes: [],
    historico: [],
    sinZona: false,
  });
  // Feature 40: por defecto sin sección de cierre de bodega (aísla el control de
  // acceso de la 38); cada test que la necesite sobreescribe con `status: "ok"`.
  listarConsolidacionMock.mockResolvedValue({ status: "forbidden" });
  listarCierresBodegaAdminMock.mockResolvedValue({ status: "forbidden" });
});

afterEach(() => {
  cleanup();
});

describe("CierresAdminPage — control de acceso por rol (R1)", () => {
  it("R1: el rol maestro ve el módulo con su título y secciones", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    const page = await CierresAdminPage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Cierres del día" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Pendientes de decisión" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Histórico" })).toBeInTheDocument();
  });

  it("R1: el rol adminSatelite ve el módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u2", rol: "adminSatelite" });

    const page = await CierresAdminPage();
    render(page);

    expect(
      screen.getByRole("region", { name: "Pendientes de decisión" }),
    ).toBeInTheDocument();
  });

  it("R1 (feature 94, paridad adm↔maestro): el rol admin ve el módulo igual que el maestro", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u3", rol: "admin" });

    const page = await CierresAdminPage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Cierres del día" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Pendientes de decisión" }),
    ).toBeInTheDocument();
  });

  it("R1: roles sin acceso NO ven el módulo (notFound)", async () => {
    // Feature 94: `admin` YA no está aquí (ve el módulo, test aparte). Siguen excluidos
    // el mensajero y el adminTienda.
    const otros: RolValue[] = ["mensajero", "adminTienda"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(CierresAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // No debe consultar el listado si el rol no está autorizado.
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R1: sin actor autenticado NO ve el módulo (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(CierresAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R1: si el listado responde forbidden, tampoco renderiza el módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(CierresAdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R3: adminSatelite sin zona → estado vacío accionable, sin tablas de acción", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u2", rol: "adminSatelite" });
    listarMock.mockResolvedValue({
      status: "ok",
      pendientes: [],
      historico: [],
      sinZona: true,
    });

    const page = await CierresAdminPage();
    render(page);

    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent("No tenés una zona asignada; contactá a tu administrador.");
    // Sin zona: NO se muestran las tablas de acción (R3).
    expect(
      screen.queryByRole("region", { name: "Pendientes de decisión" }),
    ).not.toBeInTheDocument();
  });
});
