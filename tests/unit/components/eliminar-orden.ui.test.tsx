// @vitest-environment jsdom
// Feature «eliminar orden» — UI: la acción por lote del listado del maestro y el modal de
// confirmación. Se ejercita el componente REAL; lo único mockeado es el borde (Server Actions),
// el toast y el router, para que lo verificado sea el cableado y no el backend.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import type { OrdenListItemDTO } from "@/lib/types/orden";
import {
  MSG_ORDEN_NO_EXISTE,
  MSG_ORDEN_YA_BORRADA,
} from "@/lib/services/mensajes-eliminar-orden";

const { refreshMock, successMock, errorMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Borde de la feature: UNA sola llamada por lote.
const eliminarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/eliminar-orden", () => ({
  eliminarOrdenes: (...a: unknown[]) => eliminarOrdenesMock(...a),
}));

const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));

const listarOrdenesMock = vi.fn();
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: (...a: unknown[]) => listarOrdenesMock(...a),
}));

vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn().mockResolvedValue({
    status: "ok",
    mensajeros: [],
    bloqueadosIds: [],
  }),
  listarZonasBloqueadasPorCierre: vi
    .fn()
    .mockResolvedValue({ status: "ok", zonasBloqueadasIds: [] }),
}));

vi.mock("html5-qrcode", () => ({ Html5Qrcode: vi.fn() }));

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";
import { eliminarOrdenErrorMessage } from "@/app/(app)/ordenes/_components/eliminar-orden-error-messages";

const ACCION = "Eliminar";

const CATALOGO = [
  { id: "est-en_bodega_central", value: "en_bodega_central" },
  { id: "est-entregada", value: "entregada" },
  { id: "est-por_recoger", value: "por_recoger" },
];

function makeOrden(
  over: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 1001,
    numRemision: `REM-${over.id}`,
    estatusId: "est-en_bodega_central",
    estatusValue: "en_bodega_central",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-1",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    zonaNombre: "San José",
    zonaEsGam: true,
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  } as OrdenListItemDTO;
}

function renderConSwr(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>,
  );
}

function pagina(items: OrdenListItemDTO[]) {
  return { status: "ok", items, page: 1, pageSize: 25, total: items.length };
}

async function seleccionarFila(
  user: ReturnType<typeof userEvent.setup>,
  numRemision: string,
) {
  const checkbox = await screen.findByRole("checkbox", {
    name: `Seleccionar orden ${numRemision}`,
  });
  await user.click(checkbox);
}

/** Marca la fila, abre el modal y confirma. */
async function eliminarDesdeListado(
  user: ReturnType<typeof userEvent.setup>,
  numRemision: string,
) {
  await seleccionarFila(user, numRemision);
  await user.click(await screen.findByRole("button", { name: ACCION }));
  const dialogo = await screen.findByRole("dialog");
  await user.click(within(dialogo).getByRole("button", { name: ACCION }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: CATALOGO });
  listarOrdenesMock.mockResolvedValue(pagina([makeOrden({ id: "o1" })]));
  eliminarOrdenesMock.mockResolvedValue({ status: "ok", eliminadas: 1 });
});

afterEach(() => {
  cleanup();
});

describe("la acción se ofrece en CUALQUIER estado", () => {
  it.each([
    ["en_bodega_central", "est-en_bodega_central"],
    // `entregada` NO tenía ninguna acción por lote: su checkbox estaba bloqueado. Ahora se
    // puede marcar, y esto es lo que lo comprueba.
    ["entregada", "est-entregada"],
    ["por_recoger", "est-por_recoger"],
  ])("estado %s", async (estatusValue, estatusId) => {
    listarOrdenesMock.mockResolvedValue(
      pagina([makeOrden({ id: "o1", estatusValue, estatusId })]),
    );
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote />);

    await seleccionarFila(user, "REM-o1");

    expect(await screen.findByRole("button", { name: ACCION })).toBeInTheDocument();
  });

  it("NO se ofrece sin acciones por lote (rol sin permiso: no hay ni checkbox)", async () => {
    renderConSwr(<OrdenesListado />);

    await screen.findByText("REM-o1");

    expect(screen.queryByRole("checkbox", { name: /Seleccionar orden/ })).toBeNull();
    expect(screen.queryByRole("button", { name: ACCION })).toBeNull();
  });
});

describe("confirmación y llamada al borde", () => {
  it("una sola llamada con el lote completo, y avisa cuántas eliminó el SERVIDOR", async () => {
    listarOrdenesMock.mockResolvedValue(
      pagina([makeOrden({ id: "o1" }), makeOrden({ id: "o2" })]),
    );
    eliminarOrdenesMock.mockResolvedValue({ status: "ok", eliminadas: 2 });
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote />);

    await seleccionarFila(user, "REM-o1");
    await seleccionarFila(user, "REM-o2");
    await user.click(await screen.findByRole("button", { name: ACCION }));
    const dialogo = await screen.findByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: ACCION }));

    await waitFor(() => expect(eliminarOrdenesMock).toHaveBeenCalledTimes(1));
    expect(eliminarOrdenesMock).toHaveBeenCalledWith({ ordenIds: ["o1", "o2"] });
    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("2 orden(es) eliminada(s)."),
    );
  });

  it("NO llama al borde hasta que se confirma (abrir el modal no borra)", async () => {
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote />);

    await seleccionarFila(user, "REM-o1");
    await user.click(await screen.findByRole("button", { name: ACCION }));
    await screen.findByRole("dialog");

    expect(eliminarOrdenesMock).not.toHaveBeenCalled();
  });

  it("un fallo se traduce a un mensaje accionable y NO se anuncia éxito", async () => {
    const fallo = {
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_YA_BORRADA }],
    };
    eliminarOrdenesMock.mockResolvedValue(fallo);
    const user = userEvent.setup();
    renderConSwr(<OrdenesListado accionesLote />);

    await eliminarDesdeListado(user, "REM-o1");

    await waitFor(() =>
      expect(errorMock).toHaveBeenCalledWith(eliminarOrdenErrorMessage(fallo)),
    );
    expect(successMock).not.toHaveBeenCalled();
  });
});

describe("traducción de errores", () => {
  it.each([
    ["forbidden", { status: "forbidden" }],
    ["unauthenticated", { status: "unauthenticated" }],
    ["validation_error", { status: "validation_error", fieldErrors: {} }],
    [
      "conflict/no existe",
      { status: "conflict", detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_NO_EXISTE }] },
    ],
    [
      "conflict/ya borrada",
      { status: "conflict", detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_YA_BORRADA }] },
    ],
  ])("%s tiene un mensaje propio y sin identificadores internos", (_n, resultado) => {
    const mensaje = eliminarOrdenErrorMessage(resultado);
    expect(mensaje.length).toBeGreaterThan(0);
    expect(mensaje).not.toContain("o1");
    // Ningún `value`/motivo crudo del backend se filtra al usuario.
    expect(mensaje).not.toContain("_");
  });

  it("los cinco mensajes son DISTINTOS entre sí", () => {
    const mensajes = [
      eliminarOrdenErrorMessage({ status: "forbidden" }),
      eliminarOrdenErrorMessage({ status: "unauthenticated" }),
      eliminarOrdenErrorMessage({ status: "validation_error", fieldErrors: {} }),
      eliminarOrdenErrorMessage({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_NO_EXISTE }],
      }),
      eliminarOrdenErrorMessage({
        status: "conflict",
        detalle: [{ ordenId: "o1", motivo: MSG_ORDEN_YA_BORRADA }],
      }),
    ];
    expect(new Set(mensajes).size).toBe(mensajes.length);
  });
});
