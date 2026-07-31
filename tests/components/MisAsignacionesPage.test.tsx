// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import MisAsignacionesPage from "@/app/(app)/mis-asignaciones/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMisAsignaciones } from "@/lib/actions/mis-asignaciones";
import { estadoBloqueoMensajero } from "@/lib/actions/cierre-dia";
import type { RolValue } from "@prisma/client";

// Feature 36 (T14) — la página resuelve el rol SOLO server-side; rol ≠ mensajero
// (o sin sesión) → `notFound`. Se mockea el resolver, la action de listado y
// next/navigation (notFound lanza; useRouter lo consume el módulo cliente).
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/mis-asignaciones", () => ({
  listarMisAsignaciones: vi.fn(),
  recogerAsignaciones: vi.fn(),
  escogerParaGestion: vi.fn(),
  gestionar: vi.fn(),
  liberarGestion: vi.fn(),
}));
// Feature 111/R12/R14: la página pre-fetch el flag de bloqueo del mensajero. Se mockea
// para no arrastrar Prisma en jsdom (default: NO bloqueado).
vi.mock("@/lib/actions/cierre-dia", () => ({
  estadoBloqueoMensajero: vi.fn(),
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
const listarMock = vi.mocked(listarMisAsignaciones);
const bloqueoMock = vi.mocked(estadoBloqueoMensajero);

beforeEach(() => {
  vi.clearAllMocks();
  bloqueoMock.mockResolvedValue({ status: "ok", bloqueado: false });
  listarMock.mockResolvedValue({
    status: "ok",
    porRecoger: [],
    porGestionar: [],
    porRecolectar: [], // feature 157: tercer grupo del portal
    ordenEnGestionId: null,
    kpis: { pendientes: 0, entregadas: 0, porCobrar: 0, totalACobrar: 0 },
    // Feature 92/R27/R30: bloque de estado de la ruta que acompana al listado.
    ruta: { estado: "vigente", calculadaAt: null, origenFuente: null, paradasSinOptimizar: 0 },
  });
});

afterEach(() => {
  cleanup();
});

describe("MisAsignacionesPage — control de acceso por rol (R9/R12)", () => {
  it("R9: el rol mensajero ve el módulo con sus dos apartados", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });

    const page = await MisAsignacionesPage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Mis asignaciones" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Por recoger" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "En reparto / por gestionar" }),
    ).toBeInTheDocument();
    // Feature 61: fila de KPIs del portal.
    expect(
      screen.getByRole("region", { name: "Indicadores de mis asignaciones" }),
    ).toBeInTheDocument();
  });

  it("Feature 61: la fila de KPIs muestra pendientes, entregadas, por cobrar y total a cobrar", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    listarMock.mockResolvedValue({
      status: "ok",
      porRecoger: [],
      porGestionar: [],
      porRecolectar: [], // feature 157: tercer grupo del portal
      ordenEnGestionId: null,
      kpis: { pendientes: 3, entregadas: 7, porCobrar: 350, totalACobrar: 750 },
      ruta: { estado: "vigente", calculadaAt: null, origenFuente: null, paradasSinOptimizar: 0 },
    });

    const page = await MisAsignacionesPage();
    render(page);

    const kpis = screen.getByRole("region", { name: "Indicadores de mis asignaciones" });
    expect(kpis).toHaveTextContent("Pendientes");
    expect(kpis).toHaveTextContent("3");
    expect(kpis).toHaveTextContent("Entregadas");
    expect(kpis).toHaveTextContent("7");
    expect(kpis).toHaveTextContent("Por cobrar");
    expect(kpis).toHaveTextContent("350");
    // Nuevo KPI acumulado: COD en_reparto (350) + COD entregado (400) = 750.
    expect(kpis).toHaveTextContent("Total a cobrar");
    expect(kpis).toHaveTextContent("750");
  });

  it("R12: cualquier rol distinto de mensajero NO ve el módulo (notFound)", async () => {
    const otros: RolValue[] = ["maestro", "admin", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(MisAsignacionesPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // No debe consultar el listado si el rol no está autorizado.
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R12: sin actor autenticado NO ve el módulo (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(MisAsignacionesPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R12: si el listado responde forbidden, tampoco renderiza el módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(MisAsignacionesPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
