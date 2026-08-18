// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import { CargadasPorDiaBarras } from "@/app/(app)/analitica/_components/entregas/CargadasPorDiaBarras";
import {
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarConteoCargadasPorDia } from "@/lib/actions/conteo-cargadas-por-dia";
import type { ConteoCargadasPorDiaDTO } from "@/lib/types/conteo-cargadas";

vi.mock("@/lib/actions/conteo-cargadas-por-dia", () => ({
  consultarConteoCargadasPorDia: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoCargadasPorDia);

function datos(porDia: { fecha: string; conteo: number }[]): ConteoCargadasPorDiaDTO {
  return {
    porDia,
    total: porDia.reduce((s, f) => s + f.conteo, 0),
    lastSync: "2026-08-17T18:30:00.000Z",
  };
}

function renderBarras() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CargadasPorDiaBarras />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Cargadas por día — de dónde sale la serie", () => {
  it("consulta `consultarConteoCargadasPorDia` y por ninguna otra puerta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([{ fecha: "2026-08-17", conteo: 4 }]) });
    renderBarras();

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
  });

  // Mismo trato que las otras dos gráficas: nada preestablecido. Los filtros los manda la barra.
  it("la primera consulta va SIN filtro", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([{ fecha: "2026-08-17", conteo: 4 }]) });
    renderBarras();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });
});

describe("Cargadas por día — las barras", () => {
  // Se afirma sobre la ALTERNATIVA TEXTUAL de la gráfica y no sobre el SVG: recharts mide su
  // contenedor y en jsdom mide 0×0, así que no dibuja nada.
  it("pinta una barra por día, con su conteo", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { fecha: "2026-08-15", conteo: 12 },
        { fecha: "2026-08-16", conteo: 7 },
        { fecha: "2026-08-17", conteo: 3 },
      ]),
    });
    renderBarras();

    expect(await screen.findByText(/2026-08-15: 12/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-16: 7/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-17: 3/)).toBeInTheDocument();
  });

  // El orden cronológico ascendente es CONTRATO del repositorio, y el componente no reordena:
  // dos criterios de orden —uno en la base y otro aquí— acaban pintando distinto según quién
  // toque el dato al final.
  it("conserva el orden en que llegaron los días", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { fecha: "2026-08-15", conteo: 12 },
        { fecha: "2026-08-16", conteo: 7 },
      ]),
    });
    renderBarras();

    const lista = await screen.findByRole("list", { name: /cargadas por día/i });
    const textos = Array.from(lista.querySelectorAll("li")).map((li) => li.textContent ?? "");
    expect(textos[0]).toMatch(/2026-08-15/);
    expect(textos[1]).toMatch(/2026-08-16/);
  });

  // Los días sin órdenes NO viajan (contrato del DTO), así que el componente no puede
  // inventárselos: pinta lo que llegó y nada más.
  it("no inventa los días que no llegaron", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { fecha: "2026-08-15", conteo: 12 },
        { fecha: "2026-08-17", conteo: 3 },
      ]),
    });
    renderBarras();

    await screen.findByText(/2026-08-15: 12/);
    expect(screen.queryByText(/2026-08-16/)).toBeNull();
  });

  // Una gráfica de barras sin barras y con ejes dibujados se lee como una pantalla a medio
  // cargar, no como una respuesta.
  it("sin ningún día cae al estado vacío", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([]) });
    renderBarras();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(screen.queryByText(/: \d/)).toBeNull();
  });
});

// Degradar un problema de PERMISOS al vacío de la gráfica convierte «no puedes verlo» en «no
// se cargó nada», que es una afirmación de negocio que nadie hizo.
describe("Cargadas por día — los estados que NO son «sin datos»", () => {
  it.each([
    ["forbidden" as const, TEXTO_PROHIBIDO],
    ["unauthenticated" as const, TEXTO_SESION_NO_VALIDA],
  ])("«%s» se presenta como aviso, sin cifras", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderBarras();

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain(texto);
    expect(screen.queryByText(/: \d/)).toBeNull();
  });

  it("un fallo de red se presenta como aviso, no como vacío", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderBarras();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
