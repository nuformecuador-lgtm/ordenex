// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { OrdenesTabs } from "@/app/(app)/ordenes/_components/OrdenesTabs";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { listarOrderStatus } from "@/lib/actions/order-status";
import {
  listarMensajerosParaAsignacion,
  listarZonasBloqueadasPorCierre,
} from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 139 (T3.2, R9/R15) — la tab `rechazada` YA NO ofrece salida manual (su única
// salida es la aprobación del cierre); la tab `por_devolver_a_tienda` ofrece "Enviar a la
// tienda" por LOTE (reusa el checkbox de accionesLote + el modal relabelado). Se stubbean
// los modales de acción (montados por `accionesLote`) para no arrastrar sus dependencias
// (PDF, QR, next/headers) en jsdom: se ejercita SOLO la barra de acción por lote.
vi.mock("@/lib/actions/ordenes", () => ({ listarOrdenes: vi.fn() }));
vi.mock("@/lib/actions/order-status", () => ({ listarOrderStatus: vi.fn() }));
vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn(),
  listarZonasBloqueadasPorCierre: vi.fn(),
}));
vi.mock("@/app/(app)/ordenes/_components/GenerarGuiaModal", () => ({
  GenerarGuiaModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/AsignarBodegaModal", () => ({
  AsignarBodegaModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/EtiquetasGuiaModal", () => ({
  EtiquetasGuiaModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/RecuperarABodegaModal", () => ({
  RecuperarABodegaModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/DevolverATiendaModal", () => ({
  DevolverATiendaModal: () => null,
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const listarOrderStatusMock = vi.mocked(listarOrderStatus);
const listarMensajerosMock = vi.mocked(listarMensajerosParaAsignacion);
const listarZonasBloqueadasMock = vi.mocked(listarZonasBloqueadasPorCierre);

function makeOrden(ref: string): OrdenListItemDTO {
  return {
    id: `id-${ref}`,
    numGuia: 1000,
    numRemision: ref,
    estatusId: "id-estatus",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    zonaEsGam: false, // orden de zona SATÉLITE ya recibida en central: igual elegible
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

/** Monta las tabs del maestro con un catálogo de una sola tab (la de prueba). */
function renderTabs(
  catalogo: { id: string; value: string }[],
  items: OrdenListItemDTO[],
) {
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: catalogo });
  listarOrdenesMock.mockImplementation(async (input) => {
    const { page, pageSize } = input as { page: number; pageSize: number };
    return { status: "ok", items, page, pageSize, total: items.length };
  });
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <OrdenesTabs accionesLote />
      </SWRConfig>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMensajerosMock.mockResolvedValue({
    status: "ok",
    mensajeros: [{ id: "m1", nombre: "Juan" }],
    bloqueadosIds: [],
  });
  listarZonasBloqueadasMock.mockResolvedValue({
    status: "ok",
    zonasBloqueadasIds: [],
  });
});

afterEach(() => {
  cleanup();
});

describe("OrdenesTabs — flujo de devolución de rechazadas (R9/R15)", () => {
  it("R15: la tab 'por_devolver_a_tienda' ofrece 'Enviar a la tienda' por lote al seleccionar", async () => {
    const user = userEvent.setup();
    renderTabs(
      [{ id: "id-pdt", value: "por_devolver_a_tienda" }],
      [makeOrden("REM-PDT")],
    );

    // La orden es seleccionable (la tab tiene acción por lote).
    const checkbox = await screen.findByRole("checkbox", {
      name: "Seleccionar orden REM-PDT",
    });
    await user.click(checkbox);

    // Aparece la barra de acción por lote con "Enviar a la tienda".
    expect(
      await screen.findByRole("button", { name: "Enviar a la tienda" }),
    ).toBeInTheDocument();
    // R9: no reaparece la etiqueta vieja "Devolver a la tienda".
    expect(
      screen.queryByRole("button", { name: "Devolver a la tienda" }),
    ).toBeNull();
  });

  it("R9: la tab 'rechazada' NO ofrece salida manual (sin checkbox ni acción por lote)", async () => {
    renderTabs([{ id: "id-rech", value: "rechazada" }], [makeOrden("REM-RECH")]);

    // La orden se lista…
    const tabla = await screen.findByRole("table");
    expect(within(tabla).getByText("REM-RECH")).toBeInTheDocument();
    // …pero SIN checkbox de selección (la tab no tiene acción por lote).
    expect(within(tabla).queryByRole("checkbox")).toBeNull();
    // Ni el botón de devolución/envío manual.
    expect(
      screen.queryByRole("button", { name: /devolver a la tienda|enviar a la tienda/i }),
    ).toBeNull();
  });
});
