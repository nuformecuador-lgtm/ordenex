// @vitest-environment jsdom
//
// FICHA 441 — EL AVISO DE QUE EL PERIODO TODAVIA SE ESTA CERRANDO.
//
// Es lo que distingue «va mal» de «es joven», y sin él esta ficha estaría a medias: con la
// ventana puesta sobre la fecha de carga, una cohorte de ayer lee 14,7 % —medido contra
// producción el 2026-09-17— y el tablero parecería decir que el negocio se hundió de un día
// para otro.
//
// LA MUTACIÓN QUE ESTE ARCHIVO TIENE QUE PONER EN ROJO: que el aviso desaparezca (borrarlo del
// árbol, o devolver `null` siempre) → «lo dice con su número».

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";

import { AvisoPeriodoEnCurso } from "@/app/(app)/analitica/_components/entregas/AvisoPeriodoEnCurso";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

vi.mock("@/lib/actions/conteo-por-status", () => ({ consultarConteoPorStatus: vi.fn() }));

const consultarMock = vi.mocked(consultarConteoPorStatus);

function datos(porStatus: ConteoDeStatus[]) {
  return {
    porStatus,
    total: porStatus.reduce((s, f) => s + f.conteo, 0),
    lastSync: "2026-09-17T18:30:00.000Z",
  };
}

function renderAviso() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AvisoPeriodoEnCurso />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("El aviso de período abierto", () => {
  // El período del diseño: 790 cargadas y 265 todavía vivas.
  it("lo dice con su número cuando quedan órdenes vivas", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { status: "entregado", conteo: 424 },
        { status: "devolucion_a_origen_por_rechazo", conteo: 60 },
        { status: "novedad", conteo: 41 },
        { status: "en_reparto", conteo: 265 },
      ]),
    });
    renderAviso();

    const aviso = await screen.findByRole("status");
    // Las DOS cifras: cuántas siguen vivas y sobre cuántas. «Todavía se está cerrando» a secas
    // no permite decidir si el número de arriba se puede usar o no.
    expect(aviso).toHaveTextContent("265 de sus 790 órdenes siguen vivas");
    expect(aviso).toHaveTextContent("la efectividad va a subir");
  });

  // ⚠ UN AVISO QUE SALE SIEMPRE ENSEÑA A IGNORAR LOS AVISOS. Con el período ya cerrado no hay
  // nada que advertir: el número de arriba es definitivo.
  it("con el período ya cerrado no se pinta nada", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { status: "entregado", conteo: 80 },
        { status: "novedad", conteo: 20 },
      ]),
    });
    const { container } = renderAviso();

    // Se espera a que la consulta resuelva antes de afirmar la ausencia: sin esto, el caso
    // pasaría por estar todavía cargando y no por la regla.
    await vi.waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("mientras la consulta está en vuelo no se adelanta nada", () => {
    consultarMock.mockReturnValue(new Promise<never>(() => {}));
    const { container } = renderAviso();

    expect(container.textContent).toBe("");
  });

  it.each(["forbidden", "unauthenticated", "validation_error"] as const)(
    "con «%s» no inventa un aviso",
    async (status) => {
      consultarMock.mockResolvedValue({ status } as never);
      const { container } = renderAviso();

      await vi.waitFor(() => expect(consultarMock).toHaveBeenCalled());
      expect(container.textContent).toBe("");
    },
  );
});
