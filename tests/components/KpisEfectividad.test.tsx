// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";

import { calcularEfectividad } from "@/app/(app)/analitica/_components/entregas/efectividad";
import { KpisEfectividad } from "@/app/(app)/analitica/_components/entregas/KpisEfectividad";
import {
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

vi.mock("@/lib/actions/conteo-por-status", () => ({
  consultarConteoPorStatus: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoPorStatus);

function datos(porStatus: ConteoDeStatus[]) {
  return {
    porStatus,
    total: porStatus.reduce((s, f) => s + f.conteo, 0),
    lastSync: "2026-08-18T18:30:00.000Z",
  };
}

function renderKpis() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <KpisEfectividad />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

/* -------------------------------------------------------------------------- */
/* El reparto, sin renderizar nada                                             */
/* -------------------------------------------------------------------------- */

describe("El reparto de la efectividad", () => {
  it("mide entregadas sobre el universo ENTERO, en proceso incluido", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 60 },
      { status: "devuelta", conteo: 20 },
      { status: "en_reparto", conteo: 20 },
    ]);

    expect(r).toMatchObject({ entregadas: 60, enProceso: 20, total: 100, efectividad: 0.6 });
  });

  // La efectividad de la GESTIÓN suma los rechazos al numerador: en un rechazo el mensajero
  // llegó, encontró al destinatario y resolvió la orden — lo que falló fue la venta.
  it("la efectividad de la gestión suma entregadas y rechazadas sobre el MISMO total", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 60 },
      { status: "rechazada", conteo: 15 },
      { status: "devuelta", conteo: 5 },
      { status: "en_reparto", conteo: 20 },
    ]);

    expect(r.efectividadGestion).toBe(0.75);
    // Mismo denominador que su hermana: su diferencia es exactamente el peso de los rechazos.
    expect(r.efectividad).toBe(0.6);
  });

  // Una devolución, una reprogramación o un incidente NO cuentan como gestión cumplida: la
  // orden se quedó sin resolver o volvió.
  it("solo los rechazos se suman: los otros desenlaces no", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 1 },
      { status: "devuelta", conteo: 1 },
      { status: "reprogramada", conteo: 1 },
      { status: "incidente", conteo: 1 },
    ]);

    expect(r.efectividadGestion).toBe(0.25);
  });

  // ⚠ «EN PROCESO» SE DEFINE POR NEGACIÓN —todo lo que no es uno de los cinco desenlaces— y no
  // con una lista propia de estados en curso. Con una lista, un estado nuevo del catálogo
  // desaparecería de este KPI en silencio mientras el anillo sí lo contaría en «Otros».
  it("un estado del catálogo que nadie previó cuenta como en proceso", () => {
    const r = calcularEfectividad([
      { status: "entregada", conteo: 5 },
      { status: "estado_inventado_manana", conteo: 5 },
    ]);

    expect(r.enProceso).toBe(5);
  });

  // Los cinco desenlaces YA no están en proceso, aunque no sean «entregada».
  it("los desenlaces que no son entrega no cuentan como en proceso", () => {
    const r = calcularEfectividad([
      { status: "devuelta", conteo: 1 },
      { status: "rechazada", conteo: 1 },
      { status: "reprogramada", conteo: 1 },
      { status: "incidente", conteo: 1 },
    ]);

    expect(r.enProceso).toBe(0);
    expect(r.efectividad).toBe(0);
  });

  // `null` y no `0`: sin órdenes no hay efectividad que medir, y un «0 %» afirmaría que se
  // falló cada entrega. «No hubo» y «salió mal» son dos hechos distintos.
  it("sin universo, la efectividad no es cero: es que no la hay", () => {
    expect(calcularEfectividad([])).toMatchObject({
      total: 0,
      efectividad: null,
      efectividadGestion: null,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Las tarjetas                                                                */
/* -------------------------------------------------------------------------- */

describe("Las tarjetas de efectividad", () => {
  it("pintan el porcentaje y las dos cifras", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { status: "entregada", conteo: 60 },
        { status: "devuelta", conteo: 20 },
        { status: "en_reparto", conteo: 20 },
      ]),
    });
    renderKpis();

    // DOS tarjetas dicen «60 %»: sin rechazos, la efectividad de entrega y la de la gestión
    // coinciden. Por eso se busca en plural — `findByText` falla cuando hay más de una.
    expect((await screen.findAllByText(/60\s?%/)).length).toBe(2);
    expect(screen.getByText("Efectividad de entrega")).toBeInTheDocument();
    expect(screen.getByText("Efectividad de la gestión")).toBeInTheDocument();
    expect(screen.getByText("En proceso")).toBeInTheDocument();
    // 60 entregadas y 20 en proceso, cada una en su tarjeta.
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  // ⚠ EL ENGANCHE CON EL DESGLOSE: la clave de SWR es la misma que la de la dona, así que las
  // dos piezas comparten UNA petición. Este caso lo fija sobre la llamada al borde.
  it("consulta el desglose por status una sola vez y sin filtro", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([{ status: "entregada", conteo: 1 }]),
    });
    renderKpis();

    await screen.findAllByText(/100\s?%/);
    expect(consultarMock).toHaveBeenCalledTimes(1);
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });

  it.each([
    ["forbidden", TEXTO_PROHIBIDO],
    ["unauthenticated", TEXTO_SESION_NO_VALIDA],
  ] as const)("%s se dice, no se pinta como cero", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderKpis();

    // Una tarjeta por KPI, las cuatro con su aviso: un permiso denegado pintado como «0 %»
    // afirmaría que no se entregó nada.
    expect((await screen.findAllByText(texto)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/0\s?%/)).toBeNull();
  });
});
