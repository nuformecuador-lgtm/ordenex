// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import {
  HoyGestionBarras,
  tituloConFecha,
} from "@/app/(app)/analitica/_components/entregas/HoyGestionBarras";
import {
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarConteoHoyGestion } from "@/lib/actions/conteo-hoy-gestion";
import type { ConteoHoyGestionDTO } from "@/lib/types/conteo-hoy-gestion";

vi.mock("@/lib/actions/conteo-hoy-gestion", () => ({
  consultarConteoHoyGestion: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoHoyGestion);

function datos(sinGestion: number, conGestion: number): ConteoHoyGestionDTO {
  return {
    sinGestion,
    conGestion,
    total: sinGestion + conGestion,
    fecha: "2026-08-18",
    lastSync: "2026-08-18T18:30:00.000Z",
  };
}

function renderBarras() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <HoyGestionBarras />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Cargadas hoy — de dónde sale la cifra", () => {
  it("consulta `consultarConteoHoyGestion` y por ninguna otra puerta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(12, 30) });
    renderBarras();

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
  });

  // Manda el filtro entero aunque el backend ignore la ventana y el mensajero: recortarlo aquí
  // haría que la misma barra produjera un `raw` distinto según la gráfica, y un
  // `validation_error` aparecería en tres y no en la cuarta.
  it("la primera consulta va SIN filtro, igual que las otras tres", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(12, 30) });
    renderBarras();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });
});

describe("Cargadas hoy — las dos barras", () => {
  it("pinta las dos con sus cifras", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(12, 30) });
    renderBarras();

    expect(await screen.findByText(/Sin gestionar: 12/)).toBeInTheDocument();
    expect(screen.getByText(/Gestionadas: 30/)).toBeInTheDocument();
  });

  // Si el bucket en cero desapareciera, «todo gestionado» y «todo pendiente» dibujarían la
  // misma gráfica de una sola barra y sólo la etiqueta las distinguiría.
  it("la barra en cero NO desaparece", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 30) });
    renderBarras();

    expect(await screen.findByText(/Sin gestionar: 0/)).toBeInTheDocument();
    expect(screen.getByText(/Gestionadas: 30/)).toBeInTheDocument();
  });

  // Dos barras de altura cero con sus ejes dibujados se leen como una pantalla a medio cargar,
  // no como «hoy no ha entrado nada».
  it("sin ninguna orden cargada hoy cae al estado vacío", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 0) });
    renderBarras();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(screen.queryByText(/Sin gestionar: 0/)).toBeNull();
  });
});

describe("Cargadas hoy — el título lleva la fecha del SERVIDOR", () => {
  // `hoy` en el navegador y `hoy` en Costa Rica no son el mismo día para todo el mundo, y una
  // pestaña abierta desde ayer seguiría diciendo «hoy» sobre un contador de ayer.
  it("pone la fecha que devolvió el servidor", () => {
    expect(tituloConFecha("2026-08-18")).toBe("Cargadas hoy (2026-08-18)");
  });

  // Inventar una fecha mientras carga sería escribir un día que nadie ha medido.
  it("sin datos todavía, el título va desnudo", () => {
    expect(tituloConFecha(null)).toBe("Cargadas hoy");
    expect(tituloConFecha(null)).not.toMatch(/\d/);
  });

  it("la fecha llega hasta el nombre accesible de la gráfica", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(12, 30) });
    renderBarras();

    expect(await screen.findByRole("region", { name: /2026-08-18/ })).toBeInTheDocument();
  });
});

// Degradar un problema de PERMISOS al vacío de la gráfica convierte «no puedes verlo» en «hoy
// no entró nada», que es una afirmación de negocio que nadie hizo.
describe("Cargadas hoy — los estados que NO son «sin datos»", () => {
  it.each([
    ["forbidden" as const, TEXTO_PROHIBIDO],
    ["unauthenticated" as const, TEXTO_SESION_NO_VALIDA],
  ])("«%s» se presenta como aviso, sin cifras", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderBarras();

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain(texto);
    expect(screen.queryByText(/Sin gestionar: \d/)).toBeNull();
  });

  it("un fallo de red se presenta como aviso, no como vacío", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderBarras();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
