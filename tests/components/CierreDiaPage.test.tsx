// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import CierreDiaPage from "@/app/(app)/cierre-dia/page";
import type { CierreDetalleGestion } from "@/lib/interfaces/services/ICierreDiaService";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarCierreDia, estadoBloqueoMensajero } from "@/lib/actions/cierre-dia";

// Feature 37 (T14, R1) — la página resuelve el rol SOLO server-side; rol ≠
// mensajero (o sin sesión) → `notFound`. Se mockea el resolver, la action de
// listado y next/navigation (notFound lanza; useRouter lo consume el módulo).
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/cierre-dia", () => ({
  listarCierreDia: vi.fn(),
  estadoBloqueoMensajero: vi.fn(),
  solicitarCierre: vi.fn(),
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
const listarMock = vi.mocked(listarCierreDia);
const bloqueoMock = vi.mocked(estadoBloqueoMensajero);

/** Resultado `ok` del listado, con los 4 grupos VACÍOS. */
function resultadoBase() {
  return {
    status: "ok" as const,
    grupos: { entregada: [], reprogramada: [], devuelta: [], rechazada: [], incidente: [] },
    totales: {
      efectivo: "0.00",
      simpe: "0.00",
      transferencia: "0.00",
      general: "0.00",
    },
    totalPagoMensajero: "0.00", // feature 39/R11
    totalIngresoBodegaRechazos: "0.00", // feature 56/R10
    puedesSolicitar: false,
    motivoBloqueo: "No hay gestiones para cerrar.",
    cierresPasados: [],
  };
}

/** Una gestión entregada mínima: solo para que la sección "Entregadas" exista. */
function gestionEntregada(): CierreDetalleGestion {
  return {
    gestionId: "g1",
    ordenId: "o1",
    numGuia: 1,
    numRemision: "REM-1",
    destinatario: "Ana",
    direccion: null,
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Central",
    distritoNombre: null,
    producto: "Caja",
    tiendaNombre: "Tienda X",
    resultado: "entregada",
    montoRecibido: "10.00",
    metodoPago: "efectivo",
    motivo: null,
    fechaReprogramacion: null,
    evidenciaUrl: null,
    pagoMensajero: "0.00",
    ingresoBodegaRechazo: null,
    tarifaFaltante: false,
    esRechazoSla: false, // feature 102
    // Feature 158/R9/R19: campos POR RAMA del incidente; los casos del incidente los
    // sobreescriben.
    causaIncidente: null,
    indemnizacion: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bloqueoMock.mockResolvedValue({ status: "ok", bloqueado: false });
  listarMock.mockResolvedValue(resultadoBase());
});

afterEach(() => {
  cleanup();
});

describe("CierreDiaPage — control de acceso por rol (R1)", () => {
  it("R1: el rol mensajero ve el módulo con su título y sus secciones", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    // Con una entrega: el módulo ya no pinta las secciones sin registros, así que una
    // sección vacía no probaría nada sobre el acceso al módulo.
    listarMock.mockResolvedValue({
      ...resultadoBase(),
      grupos: {
        entregada: [gestionEntregada()],
        reprogramada: [],
        devuelta: [],
        rechazada: [],
        incidente: [],
      },
    });

    const page = await CierreDiaPage();
    render(page);

    expect(
      screen.getByRole("heading", { level: 1, name: "Cierre del día" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Totales del día" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Entregadas" }),
    ).toBeInTheDocument();
  });

  it("una sección sin registros no se muestra", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    // El default del beforeEach trae los 4 grupos vacíos.
    const page = await CierreDiaPage();
    render(page);

    expect(screen.queryByRole("region", { name: "Entregadas" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Reprogramadas" }),
    ).not.toBeInTheDocument();
  });

  it("R1: cualquier rol distinto de mensajero NO ve el módulo (notFound)", async () => {
    const otros: RolValue[] = ["maestro", "admin", "adminTienda", "adminSatelite"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(CierreDiaPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // No debe consultar el listado si el rol no está autorizado.
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R1: sin actor autenticado NO ve el módulo (notFound)", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(CierreDiaPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R1: si el listado responde forbidden, tampoco renderiza el módulo", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    listarMock.mockResolvedValue({ status: "forbidden" });
    await expect(CierreDiaPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
