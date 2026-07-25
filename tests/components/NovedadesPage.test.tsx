// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import NovedadesPage from "@/app/(app)/novedades/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarNovedadesAction } from "@/lib/actions/novedades";
import { listarRechazosSlaTiendaAction } from "@/lib/actions/rechazos-sla-tienda";

// Feature 87 (T15) + Feature 102 (T12) — la page resuelve el rol SOLO server-side. Cubre R18 (rol
// != adminTienda / sin sesion -> notFound) y R19 (action principal != ok -> notFound). Se mockean
// el resolver, las dos actions (novedades + rechazos SLA) y next/navigation (notFound lanza). El
// modulo cliente de pestañas se mockea (aqui solo se prueba la guardia, no su render).
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/novedades", () => ({
  listarNovedadesAction: vi.fn(),
}));
vi.mock("@/lib/actions/rechazos-sla-tienda", () => ({
  listarRechazosSlaTiendaAction: vi.fn(),
}));
vi.mock("@/app/(app)/novedades/_components/NovedadesTabs", () => ({
  NovedadesTabs: () => <div data-testid="novedades-module" />,
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
  // PageHeader -> LogoutButton usa useRouter; se mockea para el render del caso ok.
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
const listarMock = vi.mocked(listarNovedadesAction);
const listarRechazosSlaMock = vi.mocked(listarRechazosSlaTiendaAction);

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({
    status: "ok",
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  });
  listarRechazosSlaMock.mockResolvedValue({
    status: "ok",
    items: [],
    total: 0,
    page: 1,
    pageSize: 10,
  });
});

afterEach(() => {
  cleanup();
});

describe("NovedadesPage — control de acceso por rol", () => {
  it("R18: el rol adminTienda ve la pagina con su encabezado y el modulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });

    const page = await NovedadesPage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Novedades" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("novedades-module")).toBeInTheDocument();
  });

  it("R18: cualquier rol distinto de adminTienda -> notFound", async () => {
    const otros: RolValue[] = ["maestro", "admin", "adminSatelite", "mensajero"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(NovedadesPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // No debe consultar el listado si el rol no esta autorizado.
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R18: sin actor autenticado -> notFound", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(NovedadesPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R19: si la action no responde ok (forbidden), la page -> notFound", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(NovedadesPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R19: si la action responde unauthenticated, la page -> notFound", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminTienda" });
    listarMock.mockResolvedValue({ status: "unauthenticated" });
    await expect(NovedadesPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
