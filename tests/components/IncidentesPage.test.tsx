// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import IncidentesPage from "@/app/(app)/incidentes/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarIncidentes } from "@/lib/actions/incidentes";

// Feature 158 (T2.8, Q-I — R48) — la PÁGINA de la cola de incidentes resuelve el rol SOLO
// server-side. La entrada del menú decide qué se MUESTRA; ESTA es la defensa real.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/incidentes", () => ({
  listarIncidentes: vi.fn(),
  verIncidente: vi.fn(),
  aprobarIncidente: vi.fn(),
  rechazarIncidente: vi.fn(),
  retractarIncidente: vi.fn(),
  reportarIncidente: vi.fn(),
  // Feature 170 — FASE 2 (T I.2 el histórico, T J.2 la cola): la página pre-carga la PÁGINA 1
  // de las DOS tablas.
  listarHistoricoIncidentesPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
  listarPendientesIncidentesPaginado: vi.fn(async () => ({
    status: "ok" as const,
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  })),
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
const listarMock = vi.mocked(listarIncidentes);

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({
    status: "ok",
    pendientes: [],
    historico: [],
    sinZona: false,
  });
});
afterEach(cleanup);

async function renderPage() {
  render(await IncidentesPage());
}

describe("Feature 158 (T2.8) — R48: quién entra a /incidentes", () => {
  it.each(["maestro", "admin", "adminSatelite"] as RolValue[])(
    "el rol `%s` ve la cola",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await renderPage();
      expect(screen.getByRole("table", { name: "Pendientes de decisión" })).toBeInTheDocument();
      expect(screen.getByRole("table", { name: "Histórico" })).toBeInTheDocument();
    },
  );

  it.each(["mensajero", "adminTienda"] as RolValue[])(
    "el rol `%s` recibe notFound (no basta con ocultarlo del menú)",
    async (rol) => {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(renderPage()).rejects.toThrow(NotFoundError);
      expect(listarMock).not.toHaveBeenCalled();
    },
  );

  it("sin sesión: notFound, y NO se consulta nada", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(renderPage()).rejects.toThrow(NotFoundError);
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("si el service responde `forbidden`, la página tampoco se pinta (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "admin" as RolValue });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(renderPage()).rejects.toThrow(NotFoundError);
  });
});

describe("Feature 158 (T2.8) — los datos bajan por PROPS desde el servidor", () => {
  it("el módulo cliente recibe pendientes/histórico/sinZona ya resueltos", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" as RolValue });
    listarMock.mockResolvedValue({
      status: "ok",
      pendientes: [],
      historico: [],
      sinZona: true, // adminSatelite sin zona
    });
    await renderPage();
    // `sinZona` viaja por props: el módulo pinta el aviso y NINGUNA tabla.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    // Y el módulo NO fetchea la lista por su cuenta: la pidió la página (1 sola llamada).
    expect(listarMock).toHaveBeenCalledTimes(1);
  });
});
