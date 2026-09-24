// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import { ConteoPorStatusDona } from "@/app/(app)/analitica/_components/entregas/ConteoPorStatusDona";
import {
  TEXTO_PROHIBIDO,
  TEXTO_SESION_NO_VALIDA,
} from "@/app/(app)/analitica/_components/operativo/textos";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";
import type { ConteoPorStatusDTO } from "@/lib/types/conteo-por-status";

vi.mock("@/lib/actions/conteo-por-status", () => ({
  consultarConteoPorStatus: vi.fn(),
}));

const consultarMock = vi.mocked(consultarConteoPorStatus);

function datos(porStatus: { status: string; conteo: number }[]): ConteoPorStatusDTO {
  return {
    porStatus,
    total: porStatus.reduce((s, f) => s + f.conteo, 0),
    lastSync: "2026-08-17T18:30:00.000Z",
  };
}

function renderDona() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConteoPorStatusDona />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Dona por estado — de dónde sale la cifra", () => {
  it("consulta `consultarConteoPorStatus` y por ninguna otra puerta", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([{ status: "entregado", conteo: 20 }]) });
    renderDona();

    await waitFor(() => expect(consultarMock).toHaveBeenCalledTimes(1));
  });

  // Mismo trato que el anillo hermano: nada preestablecido. Los filtros los manda la barra.
  it("la primera consulta va SIN filtro", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([{ status: "entregado", conteo: 20 }]) });
    renderDona();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(consultarMock.mock.calls[0]?.[0]).toEqual({});
  });
});

describe("Dona por estado — los segmentos", () => {
  // Se afirma sobre la ALTERNATIVA TEXTUAL de la gráfica y no sobre el SVG: recharts mide su
  // contenedor y en jsdom mide 0×0.
  it("pinta un segmento por status, con su conteo", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { status: "entregado", conteo: 20 },
        { status: "en_reparto", conteo: 8 },
        { status: "novedad", conteo: 2 },
      ]),
    });
    renderDona();

    expect(await screen.findByText(/Entregado: 20/)).toBeInTheDocument();
    expect(screen.getByText(/En reparto: 8/)).toBeInTheDocument();
    expect(screen.getByText(/Novedad: 2/)).toBeInTheDocument();
    // FICHA 455 (recorrido F5): el título iba sin tilde («Detalle de las ordenes»).
    expect(document.body.textContent ?? "").toContain("Detalle de las órdenes · 30");
    expect(document.body.textContent ?? "").not.toContain("de las ordenes");
  });

  // Los buckets vacíos no viajan (decisión del 2026-08-18), así que la dona no puede inventar
  // segmentos en cero: pinta lo que llegó y nada más.
  it("no inventa segmentos para los status que no llegaron", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([{ status: "entregado", conteo: 20 }]) });
    renderDona();

    await screen.findByText(/Entregado: 20/);
    expect(screen.queryByText(/En reparto/)).toBeNull();
    expect(screen.queryByText(/Novedad/)).toBeNull();
  });

  it("sin ningún bucket cae al estado vacío, sin dibujar una dona de ceros", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([]) });
    renderDona();

    await waitFor(() => expect(consultarMock).toHaveBeenCalled());
    expect(screen.queryByText(/: 0/)).toBeNull();
  });
});

// ⚠ AQUI VIVIA EL BLOQUE DE LA NOTA que declaraba de donde sale el estado. Retirada por
// decision humana del 2026-08-18, junto con el sello de frescura.
//
// Lo que se pierde queda dicho, porque es una diferencia REAL y ya no hay nada en pantalla
// que la explique: el bucket sale de la ultima gestion vigente, no del estatus de la orden,
// asi que este desglose y el listado filtrado por estatus pueden no cuadrar para el mismo
// dia. La regla sigue viva y probada en el backend (conteo-por-status-sql.test.ts); lo que
// se quito es el rotulo.
describe("Dona por estado — sin rótulos bajo la gráfica", () => {
  it("no pinta la nota de la fuente del estado", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([{ status: "entregado", conteo: 20 }]) });
    renderDona();

    await screen.findByText(/Entregado: 20/);
    expect(screen.queryByText(/última gestión/i)).toBeNull();
  });

  it("ni la hora de la última actualización", async () => {
    consultarMock.mockResolvedValue({ status: "ok", datos: datos([{ status: "entregado", conteo: 20 }]) });
    renderDona();

    await screen.findByText(/Entregado: 20/);
    expect(screen.queryByText(/Actualizado/)).toBeNull();
  });
});

// Degradar un problema de PERMISOS al vacío de la gráfica convierte «no puedes verlo» en «no
// hubo órdenes», que es una afirmación de negocio que nadie hizo.
describe("Dona por estado — los estados que NO son «sin datos»", () => {
  it.each([
    ["forbidden" as const, TEXTO_PROHIBIDO],
    ["unauthenticated" as const, TEXTO_SESION_NO_VALIDA],
  ])("«%s» se presenta como aviso, sin cifra", async (status, texto) => {
    consultarMock.mockResolvedValue({ status } as never);
    renderDona();

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain(texto);
    // Y ni una cifra: la dona no pinta un desglose que no tiene.
    expect(screen.queryByText(/Entregado: d/)).toBeNull();
  });

  it("un fallo de red se presenta como aviso, no como vacío", async () => {
    consultarMock.mockRejectedValue(new Error("se cayó"));
    renderDona();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

// ⏳ 2026-09-24 (FICHA 455, T2.6; design §2.1; R3/R10/R42): aquí se probaba `etiquetaDeStatus`, que
// HUMANIZABA el código (guiones bajos a espacios + mayúscula). Se retira: la leyenda usa el nombre
// visible de la fuente única (`nombreDeEstado`). Los literales esperados van escritos A MANO.
describe("455 — la leyenda nombra cada status con su nombre visible exacto", () => {
  it("nombres exactos, incluidos los que el código no deja adivinar", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([
        { status: "mensajero_recogiendo_en_bodega", conteo: 3 },
        { status: "devolucion_a_origen_por_rechazo", conteo: 2 },
        { status: "devuelta_a_tienda", conteo: 1 },
      ]),
    });
    renderDona();

    expect(await screen.findByText(/Mensajero recogiendo en la bodega: 3/)).toBeInTheDocument();
    expect(screen.getByText(/Devolución a origen por rechazo: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Devuelta a tienda: 1/)).toBeInTheDocument();
  });

  it("un value que el catálogo no conoce se lee «Estado no reconocido», nunca el código", async () => {
    consultarMock.mockResolvedValue({
      status: "ok",
      datos: datos([{ status: "estatus_inventado_manana", conteo: 4 }]),
    });
    renderDona();

    expect(await screen.findByText(/Estado no reconocido: 4/)).toBeInTheDocument();
    expect(screen.queryByText(/estatus_inventado_manana|Estatus inventado manana/)).toBeNull();
  });
});
