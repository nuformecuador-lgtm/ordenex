// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { OrdenesListado } from "@/app/(app)/ordenes/_components/OrdenesListado";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { listarOrderStatus } from "@/lib/actions/order-status";
import {
  listarMensajerosParaAsignacion,
} from "@/lib/actions/ordenes-guia";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 139 (T3.2, R9/R15) — `rechazada` YA NO ofrece salida manual (su única salida
// es la aprobación del cierre); `por_devolver_a_tienda` ofrece "Enviar a la tienda" por
// LOTE (reusa el checkbox de accionesLote + el modal relabelado). Con una sola tabla, esas
// reglas se derivan del ESTADO DE LA ORDEN (`estatusValue`), no de una tab activa. Se stubbean
// los modales de acción (montados por `accionesLote`) para no arrastrar sus dependencias
// (PDF, QR, next/headers) en jsdom: se ejercita SOLO la barra de acción por lote.
vi.mock("@/lib/actions/ordenes", () => ({ listarOrdenes: vi.fn() }));
vi.mock("@/lib/actions/order-status", () => ({ listarOrderStatus: vi.fn() }));
vi.mock("@/lib/actions/ordenes-guia", () => ({
  listarMensajerosParaAsignacion: vi.fn(),
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

function makeOrden(ref: string, estatusValue: string): OrdenListItemDTO {
  return {
    id: `id-${ref}`,
    numGuia: 1000,
    numRemision: ref,
    estatusId: "id-estatus",
    // Las acciones por lote y el bloqueo se derivan del estado de la ORDEN.
    estatusValue,
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

/** Monta el listado del maestro sirviendo `items` (el filtro no se toca aquí). */
function renderListado(
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
        <OrdenesListado accionesLote />
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
});

afterEach(() => {
  cleanup();
});

describe("OrdenesListado — flujo de devolución de rechazadas (R9/R15)", () => {
  it("R15: una orden 'por_devolver_a_tienda' ofrece 'Enviar a la tienda' por lote al seleccionar", async () => {
    const user = userEvent.setup();
    renderListado(
      [{ id: "id-pdt", value: "por_devolver_a_tienda" }],
      [makeOrden("REM-PDT", "por_devolver_a_tienda")],
    );

    // La orden es seleccionable (su estado tiene acción por lote).
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

  it("R9: una orden 'rechazada' NO ofrece salida manual (sin checkbox ni acción por lote)", async () => {
    // IDA Y VUELTA (léase entera): la feature «eliminar orden» (2026-08-26) reexpresó este caso
    // porque entonces "Eliminar" se ofrecía en CUALQUIER estado y la fila sí ganaba casilla. El
    // pedido humano del 2026-08-27 acotó el borrado a las órdenes SIN GESTIÓN: una `rechazada`
    // no lo está, así que vuelve a no tener ninguna acción por lote y vuelve a no tener casilla.
    // El caso recupera su forma original, que es la que dice la verdad hoy.
    renderListado(
      [{ id: "id-rech", value: "rechazada" }],
      [makeOrden("REM-RECH", "rechazada")],
    );

    // La orden se lista…
    const tabla = await screen.findByRole("table");
    expect(within(tabla).getByText("REM-RECH")).toBeInTheDocument();

    // …pero SIN checkbox de selección (su estado no tiene acción por lote, y tampoco se puede
    // eliminar: ya fue gestionada).
    expect(within(tabla).queryByRole("checkbox")).toBeNull();
    // Ni el botón de devolución/envío manual.
    expect(
      screen.queryByRole("button", { name: /devolver a la tienda|enviar a la tienda/i }),
    ).toBeNull();
  });
});

// Con UNA sola tabla para varios estados, las acciones por lote ya no vienen de una tab
// activa: se derivan de la SELECCION (interseccion de las acciones de los estados
// marcados), de modo que nunca se ofrece una accion que descartaria parte del lote.
describe("OrdenesListado — acciones derivadas de la seleccion", () => {
  const ITEMS = [
    makeOrden("REM-POR-RECOGER", "por_recoger"),
    makeOrden("REM-EN-BODEGA", "en_bodega_central"),
  ];
  const CATALOGO = [
    { id: "id-pr", value: "por_recoger" },
    { id: "id-eb", value: "en_bodega_central" },
  ];

  it("con filas de UN solo estado ofrece las acciones de ese estado", async () => {
    const user = userEvent.setup();
    renderListado(CATALOGO, ITEMS);

    await user.click(
      await screen.findByRole("checkbox", {
        name: "Seleccionar orden REM-EN-BODEGA",
      }),
    );

    expect(
      await screen.findByRole("button", { name: "Asignar mensajero" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Imprimir etiquetas" }),
    ).toBeInTheDocument();
  });

  it("al MEZCLAR estados solo sobrevive la accion comun a todos", async () => {
    const user = userEvent.setup();
    renderListado(CATALOGO, ITEMS);

    await user.click(
      await screen.findByRole("checkbox", {
        name: "Seleccionar orden REM-EN-BODEGA",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar orden REM-POR-RECOGER" }),
    );

    // "Imprimir etiquetas" aplica a ambos estados; "Asignar mensajero" solo a uno.
    expect(
      await screen.findByRole("button", { name: "Imprimir etiquetas" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Asignar mensajero" }),
    ).toBeNull();
  });
});
