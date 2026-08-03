// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import RankingPage from "@/app/(app)/ranking/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { obtenerRankingAction } from "@/lib/actions/ranking";
import type { RankingData } from "@/lib/types/ranking";

// Feature 76 (T8, R16/R17/R18) — la página resuelve el rol SOLO server-side; se permite
// `maestro` (edita) y `mensajero` (solo-lectura); cualquier otro rol o sin sesión →
// `notFound`. Se mockean el resolver, la action de lectura, next/navigation (notFound
// lanza; useRouter lo consume el módulo cliente) y el toast.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/ranking", () => ({
  obtenerRankingAction: vi.fn(),
  editarPremioAction: vi.fn(),
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
const obtenerMock = vi.mocked(obtenerRankingAction);

const DATA: RankingData = {
  ranking: [
    {
      posicion: 1,
      mensajeroId: "m1",
      nombre: "Ana",
      entregadasHoy: 3,
      asignadasHoy: 3,
      pct: "100.0",
      premio: "5000",
    },
  ],
  premios: [
    { posicion: 1, monto: "5000", descripcion: "Bono oro" },
    { posicion: 2, monto: null, descripcion: null },
    { posicion: 3, monto: null, descripcion: null },
  ],
  esEditable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  obtenerMock.mockResolvedValue({ status: "ok", data: DATA });
});

afterEach(() => {
  cleanup();
});

describe("RankingPage — control de acceso por rol (R16/R17/R18)", () => {
  it("R16: el maestro ve el ranking con inputs de edición de premios", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    const page = await RankingPage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Ranking" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Monto del premio — posición 1" }),
    ).toBeInTheDocument();
  });

  it("R16 (feature 94, paridad adm↔maestro): el admin ve el ranking editable igual que el maestro", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u3", rol: "admin" });

    const page = await RankingPage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Ranking" }),
    ).toBeInTheDocument();
    // `esEditable` lo decide el service (que ya da acceso total al admin): con la data
    // por defecto (editable) el admin ve los inputs de edición de premios.
    expect(
      screen.getByRole("textbox", { name: "Monto del premio — posición 1" }),
    ).toBeInTheDocument();
  });

  it("R17: el mensajero ve el ranking en solo-lectura (sin inputs)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u2", rol: "mensajero" });
    obtenerMock.mockResolvedValue({
      status: "ok",
      data: { ...DATA, esEditable: false },
    });

    const page = await RankingPage();
    render(page);

    // El ranking se presenta en el podio (`RankingPodio`), ya no en una tabla.
    expect(
      screen.getByRole("list", { name: "Podio del ranking diario" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("R18: roles no autorizados NO ven el ranking (notFound), sin consultar datos", async () => {
    // Feature 94: `admin` YA no está aquí (ve el ranking, test aparte). Siguen excluidos
    // el adminTienda y el adminSatelite.
    const otros: RolValue[] = ["adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(RankingPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(obtenerMock).not.toHaveBeenCalled();
  });

  it("R18: sin actor autenticado NO ve el ranking (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(RankingPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(obtenerMock).not.toHaveBeenCalled();
  });

  it("R18: si la action no responde ok, no renderiza (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    obtenerMock.mockResolvedValue({ status: "forbidden" });
    await expect(RankingPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
