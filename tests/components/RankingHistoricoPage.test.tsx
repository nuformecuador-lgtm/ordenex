// @vitest-environment jsdom
// Feature 196 (T4.6) — la página `/ranking/historico`. Cubre R24, R26, R27 y R28.
//
// Lo que se juzga aquí es la PUERTA y la DISTINCIÓN de estados, que son las dos cosas que
// esta pantalla puede romper en silencio:
//
//  - la puerta (R27/R28): el rol se resuelve server-side y un rol ajeno no ve ni una fila.
//    Se comprueba además que la acción NO llega a invocarse: denegar después de haber leído
//    el snapshot sería denegar la pantalla, no el dato.
//  - los tres estados (R26): «hay filas», «ese día no hubo actividad» (el cron corrió y no
//    había nada que congelar) y «no se generó el snapshot» (el cron no corrió). Los dos
//    últimos son CERO filas los dos, y confundirlos hace pasar un cron caído por un día
//    tranquilo. Por eso el caso los compara por TEXTO y además comprueba que el mensaje de
//    uno NO aparece en el otro.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RolValue } from "@prisma/client";

import RankingHistoricoPage from "@/app/(app)/ranking/historico/page";
import { obtenerRankingHistoricoAction } from "@/lib/actions/ranking-historico";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { RankingSnapshotData } from "@/lib/types/ranking-snapshot";

vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(),
}));
vi.mock("@/lib/actions/ranking-historico", () => ({
  obtenerRankingHistoricoAction: vi.fn(),
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
const obtenerMock = vi.mocked(obtenerRankingHistoricoAction);

const FECHA = "2026-08-09";

/** Snapshot con CUATRO filas: dos de podio, una de podio sin premio y una fuera de podio. */
const DATA: RankingSnapshotData = {
  fecha: FECHA,
  generadoAt: "2026-08-10T08:00:00.000Z",
  minAsignadasPodio: 3,
  filas: [
    {
      puesto: 1,
      posicion: 1,
      mensajeroId: "m1",
      nombre: "Ana Mensajera",
      entregadas: 5,
      asignadas: 5,
      pct: "100.0",
      premioMonto: "5000.00",
      premioDescripcion: "Bono oro",
    },
    {
      puesto: 2,
      posicion: 2,
      mensajeroId: "m2",
      nombre: "Beto Repartidor",
      entregadas: 4,
      asignadas: 5,
      pct: "80.0",
      premioMonto: null,
      premioDescripcion: null,
    },
    {
      puesto: 3,
      posicion: 3,
      mensajeroId: "m3",
      nombre: "Caro Ruta",
      entregadas: 3,
      asignadas: 5,
      pct: "60.0",
      premioMonto: "1000.00",
      premioDescripcion: "Consuelo",
    },
    {
      puesto: 4,
      posicion: null,
      mensajeroId: "m4",
      nombre: "Dani Suplente",
      entregadas: 1,
      asignadas: 2,
      pct: "50.0",
      premioMonto: null,
      premioDescripcion: null,
    },
  ],
};

/** Props de la página: Next 16 entrega `searchParams` como PROMESA. */
function props(fecha?: string) {
  return {
    searchParams: Promise.resolve(fecha === undefined ? {} : { fecha }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  obtenerMock.mockResolvedValue({ status: "ok", data: DATA });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RankingHistoricoPage — control de acceso (R27/R28)", () => {
  it("R27: un rol ajeno NO ve el histórico (notFound) y el snapshot ni se consulta", async () => {
    const otros: RolValue[] = ["adminTienda", "adminSatelite", "apiKey"];
    for (const rol of otros) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      await expect(RankingHistoricoPage(props(FECHA))).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(obtenerMock).not.toHaveBeenCalled();
  });

  it("R27: sin sesión NO se ve el histórico (notFound), sin consultar nada", async () => {
    resolveActorMock.mockResolvedValue(null);
    await expect(RankingHistoricoPage(props(FECHA))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(obtenerMock).not.toHaveBeenCalled();
  });

  it("R27: si la acción responde forbidden o unauthenticated, no se renderiza nada (defensa en profundidad)", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    for (const status of ["forbidden", "unauthenticated"] as const) {
      obtenerMock.mockResolvedValue({ status });
      await expect(RankingHistoricoPage(props(FECHA))).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("R30: un `?fecha` que no es una fecha calendario no pinta el histórico de otro día", async () => {
    // El 31 de febrero no existe; la acción lo rechaza en el borde. La página NO cae al D−1
    // en silencio: enseñar los datos de una fecha distinta de la pedida es peor que un 404.
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
    obtenerMock.mockResolvedValue({ status: "invalid", message: "Fecha invalida" });
    await expect(RankingHistoricoPage(props("2026-02-31"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("R28: el mensajero ve TODAS las filas del día, sin recorte a las suyas", async () => {
    // Decisión humana 4: el histórico es completo en solo lectura para el mensajero. Se
    // comprueba fila a fila y no por conteo: un recorte al top 3 dejaría el conteo «casi
    // bien» y desaparecería justo al que pregunta dónde quedó.
    resolveActorMock.mockResolvedValue({ usuarioId: "m4", rol: "mensajero" });

    render(await RankingHistoricoPage(props(FECHA)));

    for (const fila of DATA.filas) {
      expect(screen.getByText(fila.nombre)).toBeInTheDocument();
    }
    const tabla = screen.getByRole("table", { name: "Ranking congelado del día" });
    expect(tabla).toBeInTheDocument();
  });

  it("R28 (paridad): maestro y admin ven el mismo histórico completo", async () => {
    for (const rol of ["maestro", "admin"] as const) {
      resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol });
      render(await RankingHistoricoPage(props(FECHA)));
      expect(screen.getAllByText("Dani Suplente")).not.toHaveLength(0);
      cleanup();
    }
  });
});

describe("RankingHistoricoPage — fecha consultada", () => {
  it("sin `?fecha` consulta el día D−1 en calendario de Costa Rica", async () => {
    // 2026-08-11T08:00:00Z son las 02:00 CR del 11, que es cuando corre el cron: la fecha
    // que hay que enseñar es el 10. Un `toISOString()` sobre `now − 24h` daría lo mismo
    // aquí, pero a las 20:00 CR daría el día siguiente; el esperado va escrito a mano.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-11T08:00:00.000Z"));
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    await RankingHistoricoPage(props());

    expect(obtenerMock).toHaveBeenCalledWith({ fecha: "2026-08-10" });
  });

  it("con `?fecha` consulta exactamente esa fecha y la muestra en pantalla", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });

    render(await RankingHistoricoPage(props(FECHA)));

    expect(obtenerMock).toHaveBeenCalledWith({ fecha: FECHA });
    expect(screen.getByText(`Ranking del día ${FECHA}`)).toBeInTheDocument();
  });
});

describe("RankingHistoricoPage — los tres estados de R26", () => {
  const SIN_SNAPSHOT = "No se generó el snapshot de esta fecha.";
  const SIN_ACTIVIDAD =
    "Ese día no hubo actividad: ningún mensajero tuvo entregas ni asignaciones.";

  beforeEach(() => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u1", rol: "maestro" });
  });

  it("con filas pinta la tabla y ninguno de los dos mensajes de vacío", async () => {
    render(await RankingHistoricoPage(props(FECHA)));

    expect(screen.getByRole("table", { name: "Ranking congelado del día" })).toBeInTheDocument();
    expect(screen.queryByText(SIN_SNAPSHOT)).not.toBeInTheDocument();
    expect(screen.queryByText(SIN_ACTIVIDAD)).not.toBeInTheDocument();
  });

  it("cabecera con cero filas dice «ese día no hubo actividad», NO «no se generó el snapshot»", async () => {
    obtenerMock.mockResolvedValue({
      status: "ok",
      data: { ...DATA, filas: [] },
    });

    render(await RankingHistoricoPage(props(FECHA)));

    expect(screen.getByText(SIN_ACTIVIDAD)).toBeInTheDocument();
    expect(screen.queryByText(SIN_SNAPSHOT)).not.toBeInTheDocument();
  });

  it("sin cabecera dice «no se generó el snapshot», NO «no hubo actividad», y no monta tabla", async () => {
    obtenerMock.mockResolvedValue({ status: "sin_snapshot", fecha: FECHA });

    render(await RankingHistoricoPage(props(FECHA)));

    expect(screen.getByText(SIN_SNAPSHOT)).toBeInTheDocument();
    expect(screen.queryByText(SIN_ACTIVIDAD)).not.toBeInTheDocument();
    // Sin cabecera no hay nada que descargar: tampoco se monta la tabla ni su control.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Descargar / })).not.toBeInTheDocument();
  });

  it("R24: el instante de generación se ve, y solo cuando hay cabecera que lo tenga", async () => {
    render(await RankingHistoricoPage(props(FECHA)));
    expect(screen.getByText(/^Generado el /)).toBeInTheDocument();

    cleanup();
    obtenerMock.mockResolvedValue({ status: "sin_snapshot", fecha: FECHA });
    render(await RankingHistoricoPage(props(FECHA)));
    expect(screen.queryByText(/^Generado el /)).not.toBeInTheDocument();
  });
});
