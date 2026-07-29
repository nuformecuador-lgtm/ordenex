// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { OrdenesApartado } from "@/app/(app)/ordenes/_components/OrdenesApartado";
import { ORDER_STATUS_LABELS } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { obtenerHistorialOrden } from "@/lib/actions/orden-historial";
import type { OrdenListItemDTO } from "@/lib/types/orden";
import type { OrdenHistorialEntradaDTO } from "@/lib/types/orden-historial";

// Feature 49 (R27/R29): la acción de solo lectura "Ver historial" por fila que el maestro
// y el admin ganan en los apartados de `OrdenesRevisionMaestro`. Se mockean:
//  - `listarOrdenes` (fetcher SWR del apartado): sin DB ni sesión.
//  - `@/lib/actions/orden-historial`: el `HistorialOrdenSheet` reusado importa esta Server
//    Action de forma perezosa al ABRIR el drawer (R28); el mock intercepta ese import
//    dinámico, así el drawer no arrastra `next/headers`/prisma en jsdom.
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: vi.fn(),
}));

vi.mock("@/lib/actions/orden-historial", () => ({
  obtenerHistorialOrden: vi.fn(),
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const obtenerHistorialMock = vi.mocked(obtenerHistorialOrden);

const ENTRADA: OrdenHistorialEntradaDTO = {
  estatusOrigenValue: "en_reparto",
  estatusDestinoValue: "en_bodega_central",
  origenTipo: "liberacion_reprogramada",
  actorNombre: null,
  motivo: null,
  createdAt: new Date("2026-01-03T08:00:00Z"),
};

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: null,
    numRemision: "REM-000",
    estatusId: "est",
    estatusValue: undefined,
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-1",
    provinciaId: "prov-1",
    cantonId: "canton-1",
    distritoId: null,
    producto: "Producto",
    peso: 1,
    notas: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const ORDENES: OrdenListItemDTO[] = [
  makeOrden({ id: "o1", numRemision: "REM-1", estatusId: "id-bodega" }),
  makeOrden({ id: "o2", numRemision: "REM-2", estatusId: "id-bodega" }),
];

function renderApartado(props: Partial<Parameters<typeof OrdenesApartado>[0]> = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenesApartado
        titulo="En bodega"
        estatusValue="en_bodega_central"
        estatusId="id-bodega"
        {...props}
      />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrdenesMock.mockImplementation(async (input) => {
    const { page, pageSize } = input as { page: number; pageSize: number };
    return { status: "ok", items: ORDENES, page, pageSize, total: ORDENES.length };
  });
  // Feature 47 (R15): el `ok` incluye ahora el conteo de intentos derivado y el
  // umbral. Con `intentos: 0` no se pinta el badge (R16) → estos tests del apartado
  // conservan su comportamiento observable.
  obtenerHistorialMock.mockResolvedValue({
    status: "ok",
    entradas: [ENTRADA],
    intentos: 0,
    umbral: 3,
  });
});

afterEach(() => {
  cleanup();
});

describe("OrdenesApartado — acción 'Ver historial' por fila (feature 49, R27/R29)", () => {
  it("sin mostrarHistorial (default): no hay columna 'Acciones' ni botón 'Ver historial'", async () => {
    renderApartado();

    await screen.findByText("REM-1");
    expect(
      screen.queryByRole("columnheader", { name: "Acciones" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Ver historial de la orden/i }),
    ).toBeNull();
  });

  it("R29: con mostrarHistorial añade la columna 'Acciones' y un botón 'Ver historial' por fila", async () => {
    renderApartado({ mostrarHistorial: true });

    await screen.findByText("REM-1");
    expect(
      screen.getByRole("columnheader", { name: "Acciones" }),
    ).toBeInTheDocument();
    // Un disparador por fila, con el aria-label EXACTO del listado plano
    // (`Ver historial de la orden <referencia>`).
    expect(
      screen.getByRole("button", { name: "Ver historial de la orden REM-1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ver historial de la orden REM-2" }),
    ).toBeInTheDocument();
  });

  it("R27/R29/R30: al pulsar 'Ver historial' abre el drawer y muestra el timeline con la etiqueta legible del estado", async () => {
    const user = userEvent.setup();
    renderApartado({ mostrarHistorial: true });

    await screen.findByText("REM-1");
    await user.click(
      screen.getByRole("button", { name: "Ver historial de la orden REM-1" }),
    );

    const dialog = await screen.findByRole("dialog");
    // R30: etiqueta legible del estado destino, no el value crudo (se aserta contra
    // el mapa de presentación, blindado aparte en `EstatusLabel.test.ts`).
    expect(
      await within(dialog).findByText(ORDER_STATUS_LABELS.en_bodega_central),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("en_bodega_central")).toBeNull();
    // R28: la lectura pasó por la Server Action (import perezoso interceptado),
    // con la ordenId de la fila.
    expect(obtenerHistorialMock).toHaveBeenCalledWith("o1");
  });

  it("R27: 'Ver historial' está disponible aunque el apartado NO sea selectable (admin/solo-lectura)", async () => {
    renderApartado({ mostrarHistorial: true, selectable: false });

    await screen.findByText("REM-1");
    // Sin columna de selección (no seleccionable)...
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // ...pero la acción de solo lectura sí aparece por fila.
    expect(
      screen.getByRole("button", { name: "Ver historial de la orden REM-1" }),
    ).toBeInTheDocument();
  });

  it("coexiste con la selección y la acción de lote sin romperlas", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderApartado({
      mostrarHistorial: true,
      selectable: true,
      actionLabel: "Asignar mensajero",
      onAction,
    });

    await screen.findByText("REM-1");
    // La columna de selección convive con la de acciones: checkbox "seleccionar
    // todo" en la cabecera + uno por cada una de las 2 filas.
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Ver historial de la orden REM-1" }),
    ).toBeInTheDocument();

    // La acción de lote sigue operando sobre la selección (no la altera "Ver historial").
    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar orden REM-1" }),
    );
    await user.click(screen.getByRole("button", { name: "Asignar mensajero" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: "o1" }),
    ]);
  });

  it("Sin barra flotante: las acciones de lote son un bloque en el flujo, deshabilitadas sin selección", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderApartado({
      selectable: true,
      actionLabel: "Asignar mensajero",
      onAction,
    });

    await screen.findByText("REM-1");
    const accion = screen.getByRole("button", { name: "Asignar mensajero" });
    // Bloque normal: sin posicionamiento absoluto ni capas/transiciones.
    const bloque = accion.parentElement as HTMLElement;
    expect(bloque.className).toBe("flex flex-wrap items-center justify-end gap-2");
    // Sin selección la acción está visible pero deshabilitada.
    expect(accion).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar orden REM-1" }),
    );

    expect(accion).toBeEnabled();
    await user.click(accion);
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
