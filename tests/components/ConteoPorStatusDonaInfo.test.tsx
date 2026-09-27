// @vitest-environment jsdom
// FICHA 456 (T3.12, design §5.1 filas 16-17/§8; R14, R37) — las gráficas de analítica cuyas
// categorías son estados llevan una leyenda PROPIA debajo, con un botón por estado y en el orden de
// las barras. La lista de la gráfica (`aria-hidden`) sigue sin controles y las cifras no cambian.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ConteoPorStatusDona } from "@/app/(app)/analitica/_components/entregas/ConteoPorStatusDona";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";
import type { ConteoPorStatusDTO } from "@/lib/types/conteo-por-status";

vi.mock("@/lib/actions/conteo-por-status", () => ({
  consultarConteoPorStatus: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoPorStatus);

function datos(porStatus: { status: string; conteo: number }[]): ConteoPorStatusDTO {
  return { porStatus, total: porStatus.reduce((s, f) => s + f.conteo, 0), lastSync: "2026-08-17T18:30:00.000Z" };
}

function pintar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConteoPorStatusDona />
    </SWRConfig>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("456 · «Conteo por estado» — leyenda propia con botón de información", () => {
  it("R14/R37 — un botón por estado presente, en el orden de las barras; la lista `aria-hidden` sin controles", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { status: "entregado", conteo: 20 },
        { status: "en_reparto", conteo: 8 },
        { status: "novedad", conteo: 2 },
      ]),
    });
    const { container } = pintar();
    const leyenda = await screen.findByRole("list", { name: "Qué significa cada estado" });
    expect(within(leyenda).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Qué significa «Entregado»",
      "Qué significa «En reparto»",
      "Qué significa «Novedad»",
    ]);
    for (const oculto of container.querySelectorAll('[aria-hidden="true"]')) {
      expect(oculto.querySelectorAll("button")).toHaveLength(0);
    }
    // Las cifras siguen en la alternativa textual de la gráfica (R37): el total en el título.
    await waitFor(() => expect(container.textContent).toContain("30"));
  });

  it("sin datos no hay leyenda", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([]) });
    pintar();
    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(screen.queryByRole("list", { name: "Qué significa cada estado" })).toBeNull();
  });
});
