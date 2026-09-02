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
  // misma afirmación, y la cifra sola no las distingue. Pedido humano (2026-08-19): el
  // denominador se retiró de la línea suelta de debajo y vive DENTRO del rótulo.
  it("escribe el denominador DENTRO del rótulo, no en una línea aparte", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(86400, 2) });
    renderKpi();

    expect(
      await screen.findByText("Ciclo de vida promedio (2 órdenes cerradas)"),
    ).toBeInTheDocument();
    // La línea de antes («2 órdenes cerradas en el periodo») ya no existe.
    expect(screen.queryByText(/en el periodo/)).toBeNull();
  });

  // El denominador se escribe TAMBIÉN con cero: es lo que explica el guion de la cifra.
  it("con ninguna orden cerrada dice «0», y no lo oculta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 0) });
    renderKpi();

    expect(
      await screen.findByText("Ciclo de vida promedio (0 órdenes cerradas)"),
    ).toBeInTheDocument();
  });

  // FICHA 360 — la base la compone ahora `base-del-kpi`, el MISMO módulo que la de los dos KPIs
  // de porcentaje de esta misma fila, y de ahí sale que la cifra pase por
  // `formatearValor(_, "conteo")`. Sin él, esta tarjeta escribiría «(1234 órdenes cerradas)» al
  // lado de un «1 234» de la tarjeta vecina: dos maneras de escribir la misma clase de número en
  // una fila de cuatro. (El separador de `es-CR` es un espacio duro; el literal de aquí lleva el
  // normal porque `@testing-library` normaliza los blancos antes de comparar.)
  it("la base pasa por el formateador de la analítica, con su separador de miles", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(86400, 1234) });
    renderKpi();

    expect(
      await screen.findByText("Ciclo de vida promedio (1 234 órdenes cerradas)"),
    ).toBeInTheDocument();
  });

  // Se lee como una frase, y «1 órdenes» delata que nadie la leyó.
  it("concuerda en singular con una sola orden cerrada", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(3600, 1) });
    renderKpi();

    expect(
      await screen.findByText("Ciclo de vida promedio (1 orden cerrada)"),
    ).toBeInTheDocument();
  });

  // `promedioSegundos` es `null` sin órdenes cerradas: cero segundos de ciclo sería una
  // afirmación —«se cerraron al instante»— y lo que pasó es que no hubo ninguna que cerrar.
  it("sin órdenes cerradas no pinta un cero", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos(0, 0) });
    renderKpi();

    await screen.findByText(/\(0 órdenes cerradas\)/);
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
    // Sin dato no hay denominador que escribir: el rótulo se queda sin el `n` (un
    // «(0 órdenes cerradas)» aquí sería una afirmación de negocio que nadie ha hecho).
    expect(screen.queryByText(/\(\d+ (órdenes cerradas|orden cerrada)\)/)).toBeNull();
  });

  it("un fallo de red se presenta como aviso, no como vacío", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderKpi();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
