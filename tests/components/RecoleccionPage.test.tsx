// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import RecoleccionPage from "@/app/(app)/recoleccion/page";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { listarRecoleccion } from "@/lib/actions/recoleccion-tienda";
import { estadoBloqueoMensajero } from "@/lib/actions/cierre-dia";

// Feature 167 (R1/R2/R3/R6) — la página del apartado propio de recolección. Lo que este
// archivo protege es el BORDE: quién puede abrirla (rol resuelto SOLO server-side, R3) y que
// los datos lleguen al módulo de cliente POR PROPS, pre-fetch por la Server Action, sin que
// el componente fetchee por su cuenta (R6).

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/recoleccion-tienda", () => ({
  listarRecoleccion: vi.fn(),
  recolectarEnTiendaPorQr: vi.fn(),
}));
// Feature 111/R12/R14: la página pre-fetch el flag de bloqueo del mensajero. Se mockea para
// no arrastrar Prisma en jsdom (default: NO bloqueado).
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

// El escáner monta la cámara vía html5-qrcode, que jsdom no puede abrir.
vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

const resolveActorMock = vi.mocked(resolveActorFromSession);
const listarMock = vi.mocked(listarRecoleccion);
const bloqueoMock = vi.mocked(estadoBloqueoMensajero);

/**
 * El acceso al escaneo, que es lo que R7 exige que no desaparezca nunca. Desde el
 * 2026-07-31 la tarjeta vive TRAS este disparador (`EscanerModal`, decisión del humano; en
 * modal desde el 2026-08-10): montada dejaba la cámara encendida todo el rato que el
 * mensajero tuviera la
 * pantalla abierta. Aquí se mira el disparador porque es lo que la página renderiza; que al
 * abrirlo salga un escáner que funciona lo fija `RecoleccionModule.test.tsx`.
 */
const escaner = () =>
  screen.queryByRole("button", { name: "Recolectar en tienda" });

beforeEach(() => {
  vi.clearAllMocks();
  bloqueoMock.mockResolvedValue({ status: "ok", bloqueado: false });
  listarMock.mockResolvedValue({
    status: "ok",
    porRecolectar: [],
    recolectadasHoy: [],
    recolectadasHoyRecortada: false,
  });
});

afterEach(() => cleanup());

describe("RecoleccionPage — control de acceso por rol (R3)", () => {
  it("R3: cualquier rol distinto de mensajero NO ve la página (notFound) ni sus datos", async () => {
    const otros: RolValue[] = ["maestro", "admin", "adminTienda", "adminSatelite", "apiKey"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(RecoleccionPage()).rejects.toThrow("NEXT_NOT_FOUND");
    }
    // El corte es ANTES de leer: un rol no autorizado no dispara ninguna consulta.
    expect(listarMock).not.toHaveBeenCalled();
    expect(bloqueoMock).not.toHaveBeenCalled();
  });

  it("R3: sin sesión válida tampoco (notFound), sin consultar nada", async () => {
    resolveActorMock.mockResolvedValue(null);

    await expect(RecoleccionPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("R3: si la lectura responde forbidden, tampoco renderiza el apartado", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    listarMock.mockResolvedValue({ status: "forbidden" });

    await expect(RecoleccionPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("R3: si la lectura responde unauthenticated, tampoco", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    listarMock.mockResolvedValue({ status: "unauthenticated" });

    await expect(RecoleccionPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("RecoleccionPage — el apartado del mensajero (R1/R2/R6)", () => {
  it("R1/R2: el mensajero ve la página con su título propio y el apartado montado", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });

    render(await RecoleccionPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Recolección" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Por recolectar en tienda" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Recolectadas hoy" }),
    ).toBeInTheDocument();
  });

  it("R6/R7: los datos del payload llegan al módulo POR PROPS (y el escáner va accesible)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    listarMock.mockResolvedValue({
      status: "ok",
      porRecolectar: [
        {
          id: "o1",
          numGuia: 1001,
          numRemision: "REM-P1",
          producto: "Caja",
          destinatario: "Ana",
          tiendaNombre: "Tienda Norte",
          tiendaTelefono: "88880000",
          // 2026-08-11: el DTO extiende `MiAsignacionDTO` (misma card que «Por recoger»).
          estatusValue: "recolectando",
          telefonoDest: "70001111",
          direccion: "200m sur",
          peso: 1.2,
          montoCobrar: 25000,
          latitud: 9.93,
          longitud: -84.08,
          notas: null,
          zonaNombre: "GAM",
          provinciaNombre: "San José",
          cantonNombre: "Escazú",
          distritoNombre: "San Rafael",
          secuenciaRuta: null,
          marcarLuego: false,
          intentosEntrega: 0,
        },
      ],
      recolectadasHoy: [
        {
          id: "h1",
          numGuia: 5001,
          numRemision: "REM-H1",
          tiendaNombre: "Tienda Sur",
          tiendaTelefono: "88880000",
          producto: "Caja",
          destinatario: "Ana",
          // 2026-08-11: el DTO extiende `MiAsignacionDTO` (misma card que «Por recoger»).
          estatusValue: "recolectando",
          telefonoDest: "70001111",
          direccion: "200m sur",
          peso: 1.2,
          montoCobrar: 25000,
          latitud: 9.93,
          longitud: -84.08,
          notas: null,
          zonaNombre: "GAM",
          provinciaNombre: "San Jose",
          cantonNombre: "Escazu",
          distritoNombre: "San Rafael",
          secuenciaRuta: null,
          marcarLuego: false,
          intentosEntrega: 0,
          recolectadaAt: new Date("2026-07-31T15:30:00.000Z"),
        },
      ],
      recolectadasHoyRecortada: true,
    });

    render(await RecoleccionPage());

    // La lectura la hace la PÁGINA, una sola vez; el módulo de cliente no fetchea.
    expect(listarMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("REM-P1")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Recolectadas hoy" })).getByText("REM-H1"),
    ).toBeInTheDocument();
    // El flag de recorte también viaja por props (R31).
    expect(screen.getByText(/se muestran las 100 más recientes de hoy/i)).toBeInTheDocument();
    // R7 (forma vigente desde el 2026-07-31): el bloque de captura es ACCESIBLE desde que
    // la página carga — la tarjeta vive plegada tras su disparador para no dejar la cámara
    // encendida, pero el acceso a ella no depende de nada.
    expect(escaner()).toBeInTheDocument();
  });

  it("R7/R8: con NADA asignado la página sigue ofreciendo el escáner y explica el vacío", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });

    render(await RecoleccionPage());

    expect(escaner()).toBeInTheDocument();
    expect(
      screen.getByText(/no tienes órdenes por recolectar en tienda ahora mismo/i),
    ).toBeInTheDocument();
  });

  it("R9: el bloqueo por cierre pendiente lo deriva el SERVIDOR y apaga el escáner", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    bloqueoMock.mockResolvedValue({ status: "ok", bloqueado: true });

    render(await RecoleccionPage());

    expect(escaner()).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /resolver tu cierre pendiente/i,
    );
  });

  it("R9: si la derivación del bloqueo degrada, NO se bloquea al mensajero", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "mensajero" });
    bloqueoMock.mockResolvedValue({ status: "unauthenticated" });

    render(await RecoleccionPage());

    // Mismo criterio que `/mis-asignaciones`: un fallo al derivar el flag no puede dejar al
    // mensajero sin poder trabajar; el backend de la 157/R31 sigue siendo la defensa real.
    expect(escaner()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
