// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import { CicloVidaKpi } from "@/app/(app)/analitica/_components/entregas/CicloVidaKpi";
import {
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarCicloVida } from "@/lib/actions/ciclo-vida";
import type { CicloVidaDTO } from "@/lib/types/conteo-ciclo-vida";

vi.mock("@/lib/actions/ciclo-vida", () => ({
  consultarCicloVida: vi.fn(),
}));

const consultarMock = vi.mocked(consultarCicloVida);

function datos(segundosAcum: number, n: number): CicloVidaDTO {
  return {
    segundosAcum,
    n,
    promedioSegundos: n === 0 ? null : segundosAcum / n,
    lastSync: "2026-08-18T18:30:00.000Z",
  };
}

function renderKpi() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CicloVidaKpi />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("KPI de ciclo de vida — de dónde sale la cifra", () => {
  it("consulta `consultarCicloVida` y por ninguna otra puerta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(86400, 2) });
    renderKpi();

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
  });

  // Mismo trato que las cuatro gráficas: nada preestablecido. Los filtros los manda la barra.
  it("la primera consulta va SIN filtro", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(86400, 2) });
    renderKpi();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });
});

describe("KPI de ciclo de vida — la cifra y su denominador", () => {
  // 86 400 s entre 2 órdenes = 43 200 s = 12 h. El valor se pinta por `formatearValor` con
  // unidad `segundos`, que es quien decide la escala legible — el KPI no formatea a mano.
  it("pinta el promedio en horas, no los segundos crudos", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(86400, 2) });
    renderKpi();

    // Se busca por el arranque y se comprueba la unidad sobre el texto: `Intl` separa cifra y
    // unidad con un espacio que NO siempre es el normal (puede ser un fino de no separación),
    // y una regex con un espacio literal fallaría por eso sin que nada estuviera mal.
    const cifra = await screen.findByText(/^12/);
    expect(cifra.textContent ?? "").toContain("h");
    // La mutación que este caso mata: mandar el número sin formatear.
    expect(screen.queryByText("43200")).toBeNull();
  });

  // ⚠ NO ES UN DETALLE. Un promedio de cuatro horas sobre 3 órdenes y sobre 3.000 no son la
  // misma afirmación, y la cifra sola no las distingue.
  it("escribe el denominador debajo", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(86400, 2) });
    renderKpi();

    expect(await screen.findByText(/^2 órdenes cerradas/)).toBeInTheDocument();
  });

  // El denominador se escribe TAMBIÉN con cero: es lo que explica el guion de arriba.
  it("con ninguna orden cerrada dice «0», y no oculta la línea", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 0) });
    renderKpi();

    expect(await screen.findByText(/^0 órdenes cerradas/)).toBeInTheDocument();
  });

  // `promedioSegundos` es `null` sin órdenes cerradas: cero segundos de ciclo sería una
  // afirmación —«se cerraron al instante»— y lo que pasó es que no hubo ninguna que cerrar.
  it("sin órdenes cerradas no pinta un cero", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 0) });
    renderKpi();

    await screen.findByText(/^0 órdenes cerradas/);
    // El «0» del denominador sí está; lo que no puede estar es un «0 s» como valor medido.
    expect(screen.queryByText(/^0 s$/)).toBeNull();
  });

  it("la etiqueta dice que sólo cuentan las cerradas", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(86400, 2) });
    renderKpi();

    expect(await screen.findByText(/Ciclo de vida promedio/)).toBeInTheDocument();
    expect(screen.getByText(/órdenes cerradas\)/)).toBeInTheDocument();
  });
});

// Degradar un problema de PERMISOS a un guion convierte «no puedes verlo» en «no cerró
// ninguna», que es una afirmación de negocio que nadie hizo.
describe("KPI de ciclo de vida — los estados que NO son «sin datos»", () => {
  it.each([
    ["forbidden" as const, TEXTO_PROHIBIDO],
    ["unauthenticated" as const, TEXTO_SESION_NO_VALIDA],
  ])("«%s» se presenta como aviso, sin cifra ni denominador", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderKpi();

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain(texto);
    expect(screen.queryByText(/órdenes cerradas en el periodo/)).toBeNull();
  });

  it("un fallo de red se presenta como aviso, no como vacío", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderKpi();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
