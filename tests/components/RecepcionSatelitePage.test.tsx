// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import RecepcionSatelitePage from "@/app/(app)/recepcion-satelite/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import {
  listarRecepcionSatelite,
  listarMensajerosSatelite,
  estadoBloqueoBodegaSatelite,
} from "@/lib/actions/recepcion-satelite";

// Feature 33 (T11) — la página resuelve el rol SOLO server-side; rol ≠
// adminSatelite (o sin sesión) → `notFound`. Se mockean el resolver, la action de
// listado, la lib de cámara y next/navigation (notFound lanza; useRouter lo consume
// el módulo cliente).
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/recepcion-satelite", () => ({
  listarRecepcionSatelite: vi.fn(),
  listarMensajerosSatelite: vi.fn(),
  estadoBloqueoBodegaSatelite: vi.fn(),
  recibirPorQr: vi.fn(),
}));
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

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
const listarMock = vi.mocked(listarRecepcionSatelite);
const listarMensajerosMock = vi.mocked(listarMensajerosSatelite);
const bloqueoMock = vi.mocked(estadoBloqueoBodegaSatelite);

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({
    status: "ok",
    porRecibir: [],
    recibidas: [],
    porDevolver: [], // Feature 139/T3.3: grupo `por_devolver` por enviar a central
    enTransitoACentral: [], // Feature 139/T3.3: grupo `devolviendo_a_bodega_central` (informativo)
    devueltas: [], // Feature 100/T4.1: grupo `devuelta` por recuperar a bodega
    asignadas: [], // Feature 149/T6.3: grupo `por_recoger` de la zona (deshacer asignacion)
    zonaNombre: "Limón",
    sinZona: false,
  });
  listarMensajerosMock.mockResolvedValue({
    status: "ok",
    mensajeros: [{ id: "m1", nombre: "Ana Mensajera" }],
  });
  bloqueoMock.mockResolvedValue({
    status: "ok",
    bloqueo: { bloqueada: false, porMensajeros: false, porCierreBodega: false },
  });
});

afterEach(() => {
  cleanup();
});

describe("RecepcionSatelitePage — control de acceso por rol (R3)", () => {
  it("R3: el rol adminSatelite ve el módulo con sus dos secciones", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });

    const page = await RecepcionSatelitePage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Mis asignaciones" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Por recibir" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recibidas" })).toBeInTheDocument();
  });

  it("R3: cualquier rol distinto de adminSatelite NO ve el módulo (notFound)", async () => {
    const otros: RolValue[] = ["maestro", "admin", "adminTienda", "mensajero"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(RecepcionSatelitePage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // No debe consultar el listado si el rol no está autorizado.
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R3: sin actor autenticado NO ve el módulo (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(RecepcionSatelitePage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R3: si el listado responde forbidden, tampoco renderiza el módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(RecepcionSatelitePage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("RecepcionSatelitePage — aviso de cierres (ajuste admin_satelite)", () => {
  it("cierres abiertos (no todos los mensajeros) → aviso INFORMATIVO, no bloqueante", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    bloqueoMock.mockResolvedValue({
      status: "ok",
      bloqueo: {
        bloqueada: false,
        porMensajeros: false,
        porCierreBodega: false,
        cierresAbiertos: 2,
        totalMensajeros: 3,
        mensajerosConCierreIds: ["m2", "m3"],
      },
    });

    const page = await RecepcionSatelitePage();
    render(page);

    expect(
      screen.getByText(/2 cierres abiertos de tus mensajeros/i),
    ).toBeInTheDocument();
    // No es el aviso de bloqueo duro.
    expect(
      screen.queryByText(/cierres pendientes de resolver/i),
    ).toBeNull();
  });

  it("TODOS los mensajeros con cierre → bloqueo duro (aviso destructivo)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "adminSatelite" });
    bloqueoMock.mockResolvedValue({
      status: "ok",
      bloqueo: {
        bloqueada: true,
        porMensajeros: true,
        porCierreBodega: false,
        cierresAbiertos: 2,
        totalMensajeros: 2,
        mensajerosConCierreIds: ["m1", "m2"],
      },
    });

    const page = await RecepcionSatelitePage();
    render(page);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /cierres pendientes de resolver/i,
    );
  });
});
