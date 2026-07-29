// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { listarOrderStatus } from "@/lib/actions/order-status";
import {
  listarMensajerosParaAsignacion,
  listarZonasBloqueadasPorCierre,
} from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// El bloqueo del checkbox es POR ORDEN: se compara la `zonaId` de cada orden contra
// las zonas con >=1 mensajero con cierre abierto (central GAM y satelites, misma
// regla). Solo se ejercita esa deshabilitacion; los modales de accion (montados por
// `accionesLote`) se stubean para no arrastrar sus dependencias (PDF, QR,
// next/headers) en jsdom.
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
vi.mock("@/app/(app)/ordenes/_components/RecuperarABodegaModal", () => ({
  RecuperarABodegaModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/EtiquetasGuiaModal", () => ({
  EtiquetasGuiaModal: () => null,
}));
vi.mock("@/app/(app)/ordenes/_components/DevolverATiendaModal", () => ({
  DevolverATiendaModal: () => null,
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const listarOrderStatusMock = vi.mocked(listarOrderStatus);
const listarMensajerosMock = vi.mocked(listarMensajerosParaAsignacion);
const listarZonasBloqueadasMock = vi.mocked(listarZonasBloqueadasPorCierre);

// Catalogo minimo: el filtro por estado no se toca en este archivo (el listado sin
// filtro sirve las ordenes del mock), pero el componente lo consulta igual.
const CATALOGO = [{ id: "id-fulfillment", value: "en_fulfillment" }];

const ZONA_GAM = "zona-gam";
const ZONA_SATELITE = "zona-limon";
const ZONA_LIBRE = "zona-libre";

function makeOrden(
  ref: string,
  zonaId: string,
  zonaEsGam: boolean,
): OrdenListItemDTO {
  return {
    id: `id-${ref}`,
    numGuia: null,
    numRemision: ref,
    estatusId: "id-fulfillment",
    // El bloqueo se deriva del estado de la ORDEN (ya no de una tab activa).
    estatusValue: "en_fulfillment",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId,
    zonaEsGam,
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

/** Monta el listado del maestro sirviendo `items` (ordenes en estado de asignacion). */
function renderListado(items: OrdenListItemDTO[]) {
  listarOrdenesMock.mockImplementation(async (input) => {
    const { page, pageSize } = input as { page: number; pageSize: number };
    return { status: "ok", items, page, pageSize, total: items.length };
  });
  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <OrdenesListado accionesLote />
      </SWRConfig>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: CATALOGO });
  listarMensajerosMock.mockResolvedValue({
    status: "ok",
    mensajeros: [{ id: "m1", nombre: "Juan" }],
    bloqueadosIds: [],
  });
  // Por defecto: GAM y una satelite bloqueadas; `zona-libre` no.
  listarZonasBloqueadasMock.mockResolvedValue({
    status: "ok",
    zonasBloqueadasIds: [ZONA_GAM, ZONA_SATELITE],
  });
});

afterEach(() => {
  cleanup();
});

describe("OrdenesListado — bloqueo del checkbox por zona con cierre abierto", () => {
  it("orden de zona SATELITE con >=1 cierre -> checkbox deshabilitado y no seleccionable", async () => {
    renderListado([makeOrden("REM-sat", ZONA_SATELITE, false)]);

    const checkbox = await screen.findByRole("checkbox", {
      name: /No se puede seleccionar la orden REM-sat/i,
    });
    // base-ui marca el deshabilitado con aria-disabled/data-disabled (span, no el
    // atributo nativo `disabled`).
    expect(checkbox).toHaveAttribute("aria-disabled", "true");

    // Lo esencial: al hacer click NO se marca ni aparece la barra de acciones.
    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/seleccionada/i)).not.toBeInTheDocument();
  });

  it("orden de zona GAM (central) con >=1 cierre -> checkbox deshabilitado", async () => {
    renderListado([makeOrden("REM-gam", ZONA_GAM, true)]);

    const checkbox = await screen.findByRole("checkbox", {
      name: /No se puede seleccionar la orden REM-gam/i,
    });
    expect(checkbox).toHaveAttribute("aria-disabled", "true");
  });

  it("orden de zona SIN cierres -> checkbox habilitado y seleccionable", async () => {
    renderListado([makeOrden("REM-libre", ZONA_LIBRE, false)]);

    const checkbox = await screen.findByRole("checkbox", {
      name: "Seleccionar orden REM-libre",
    });
    expect(checkbox).not.toHaveAttribute("aria-disabled", "true");

    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("el bloqueo es POR ORDEN, no global: en la misma tabla conviven bloqueada y libre", async () => {
    renderListado([
      makeOrden("REM-sat", ZONA_SATELITE, false),
      makeOrden("REM-libre", ZONA_LIBRE, false),
    ]);

    const bloqueada = await screen.findByRole("checkbox", {
      name: /No se puede seleccionar la orden REM-sat/i,
    });
    const libre = screen.getByRole("checkbox", {
      name: "Seleccionar orden REM-libre",
    });
    expect(bloqueada).toHaveAttribute("aria-disabled", "true");
    expect(libre).not.toHaveAttribute("aria-disabled", "true");

    // La libre sigue siendo seleccionable pese a que su vecina esta bloqueada.
    await userEvent.click(libre);
    expect(libre).toHaveAttribute("aria-checked", "true");
    expect(bloqueada).toHaveAttribute("aria-checked", "false");
  });

  // `OrdenListItemDTO.zonaId` es `string` (no nullable), asi que el caso "sin zona"
  // solo es alcanzable como dato degradado en runtime; se cubre con "" (falsy) para
  // fijar el criterio: sin zona NO se puede afirmar que este bloqueada -> no se bloquea.
  it("orden sin `zonaId` -> NO se bloquea (no se puede afirmar que su zona lo este)", async () => {
    renderListado([makeOrden("REM-sinzona", "", false)]);

    expect(
      await screen.findByRole("checkbox", {
        name: "Seleccionar orden REM-sinzona",
      }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});
