// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import MisAsignacionesPage from "@/app/(app)/mis-asignaciones/page";
import RepartoPage from "@/app/(app)/mis-asignaciones/reparto/page";
import RecogerPage from "@/app/(app)/mis-asignaciones/recoger/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarMisAsignaciones } from "@/lib/actions/mis-asignaciones";
import { estadoBloqueoMensajero } from "@/lib/actions/cierre-dia";
import type { RolValue } from "@prisma/client";
import { SIN_BLOQUEO } from "@/lib/utils/bloqueo-cierre";

// Feature 36 (T14) — las páginas del portal del mensajero resuelven el rol SOLO
// server-side; rol ≠ mensajero (o sin sesión) → `notFound`. Se mockean el resolver, la
// action de listado y next/navigation (notFound y redirect lanzan; useRouter lo consume el
// módulo cliente).
//
// 2026-07-31 (decisión del humano): el portal se partió en `/mis-asignaciones/reparto` y
// `/mis-asignaciones/recoger`, y la ruta vieja quedó como REDIRECT. El gate de rol se
// prueba en LAS DOS páginas: son dos puertas distintas, y una sola cubierta dejaría la
// otra abierta.
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
// Feature 111/R12/R14: las páginas pre-fetch el flag de bloqueo del mensajero. Se mockea
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
/** `redirect()` de Next también lanza; se distingue por el destino que arrastra. */
class RedirectError extends Error {
  constructor(readonly destino: string) {
    super(`NEXT_REDIRECT:${destino}`);
    this.name = "RedirectError";
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError();
  },
  redirect: (destino: string) => {
    throw new RedirectError(destino);
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

const OTROS_ROLES: RolValue[] = [
  "maestro",
  "admin",
  "adminTienda",
  "adminSatelite",
];

beforeEach(() => {
  vi.clearAllMocks();
  bloqueoMock.mockResolvedValue({ status: "ok", bloqueo: SIN_BLOQUEO });
  listarMock.mockResolvedValue({
    status: "ok",
    porRecoger: [],
    porGestionar: [],
    conAyuda: [], // feature 235 (R18): el tercer grupo, separado en el servidor
    ordenEnGestionId: null,
    kpis: { pendientes: 0, entregadas: 0, porCobrar: 0, totalACobrar: 0 },
    // Feature 92/R27/R30: bloque de estado de la ruta que acompana al listado.
    ruta: { estado: "vigente", calculadaAt: null, origenFuente: null, secuenciaFuente: null, paradasSinOptimizar: 0, trazado: null, tramoSiguiente: null },
  });
});

afterEach(() => {
  cleanup();
});

describe("/mis-asignaciones — redirect a la pantalla de Reparto", () => {
  it("redirige a /mis-asignaciones/reparto", () => {
    // No se borra la ruta: vive en enlaces viejos, en el historial de los navegadores de
    // la calle y en la PWA ya instalada. Borrarla daría 404 a quien la tuviera guardada.
    expect(() => MisAsignacionesPage()).toThrow("NEXT_REDIRECT:/mis-asignaciones/reparto");
  });

  it("no consulta datos ni sesión para redirigir", () => {
    expect(() => MisAsignacionesPage()).toThrow();
    // El gate de rol lo aplica la página de destino; repetirlo aquí sería una segunda
    // fuente de verdad que puede divergir.
    expect(resolveActorMock).not.toHaveBeenCalled();
    expect(listarMock).not.toHaveBeenCalled();
  });
});

describe("RepartoPage — control de acceso por rol (R9/R12)", () => {
  it("R9: el rol mensajero ve el apartado de reparto y los KPIs", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });

    render(await RepartoPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Reparto" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "En reparto / por gestionar" }),
    ).toBeInTheDocument();
    // Feature 61: la fila de KPIs vive en Reparto (resume el turno, y el turno se
    // trabaja aquí).
    expect(
      screen.getByRole("region", { name: "Indicadores de mis asignaciones" }),
    ).toBeInTheDocument();
    // La superficie de recogida NO está: tiene su propia pantalla.
    expect(screen.queryByRole("region", { name: "Por recoger" })).toBeNull();
  });

  it("Feature 61: la fila de KPIs muestra pendientes, entregadas, por cobrar y total a cobrar", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    listarMock.mockResolvedValue({
      status: "ok",
      porRecoger: [],
      porGestionar: [],
    conAyuda: [], // feature 235 (R18): el tercer grupo, separado en el servidor
      ordenEnGestionId: null,
      kpis: { pendientes: 3, entregadas: 7, porCobrar: 350, totalACobrar: 750 },
      ruta: { estado: "vigente", calculadaAt: null, origenFuente: null, secuenciaFuente: null, paradasSinOptimizar: 0, trazado: null, tramoSiguiente: null },
    });

    render(await RepartoPage());

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
    for (const rol of OTROS_ROLES) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(RepartoPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // No debe consultar el listado si el rol no está autorizado.
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R12: sin actor autenticado NO ve el módulo (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(RepartoPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R12: si el listado responde forbidden, tampoco renderiza el módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(RepartoPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("RecogerPage — control de acceso por rol (R9/R12)", () => {
  it("R9: el rol mensajero ve el listado por recoger, sin las superficies de reparto", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });

    render(await RecogerPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Por recoger" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Por recoger" })).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "En reparto / por gestionar" }),
    ).toBeNull();
    // Los KPIs son de Reparto (decisión del humano): aquí no se repiten.
    expect(
      screen.queryByRole("region", { name: "Indicadores de mis asignaciones" }),
    ).toBeNull();
  });

  it("lee la MISMA action que Reparto (un solo origen de verdad, sin contrato nuevo)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });

    render(await RecogerPage());

    expect(listarMock).toHaveBeenCalledTimes(1);
  });

  it("R12: cualquier rol distinto de mensajero NO ve el módulo (notFound)", async () => {
    for (const rol of OTROS_ROLES) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(RecogerPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R12: sin actor autenticado NO ve el módulo (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(RecogerPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R12: si el listado responde forbidden, tampoco renderiza el módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(RecogerPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
