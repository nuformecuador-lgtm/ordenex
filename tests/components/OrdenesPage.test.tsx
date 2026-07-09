// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import OrdenesPage from "@/app/(app)/ordenes/page";
import { listarOrdenes } from "@/lib/actions/ordenes";
import type {
  ListarOrdenesResult,
  OrdenListItemDTO,
} from "@/lib/types/orden";

// La Server Action se mockea: los tests afirman el render de SWR (carga/datos/
// vacío/error) sin DB ni sesión. `listarOrdenes` es el fetcher de la página.
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: vi.fn(),
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);

/** Construye un `OrdenListItemDTO` completo con overrides legibles por test. */
function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string },
): OrdenListItemDTO {
  return {
    numGuia: 1000,
    numRemision: "REM-000",
    estatusId: "est-id",
    estatusValue: undefined,
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid-000",
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

/** Renderiza la página REAL con cache de SWR aislada por render (sin fugas entre tests). */
function renderPage(): ReactElement {
  const ui = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenesPage />
    </SWRConfig>
  );
  render(ui);
  return ui;
}

/** Filas de datos del `<tbody>` (excluye la cabecera del `<thead>`). */
function bodyRows(): HTMLElement[] {
  const tbody = screen.getByRole("table").querySelector("tbody");
  if (!tbody) throw new Error("tbody no encontrado");
  return within(tbody).getAllByRole("row");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("OrdenesPage", () => {
  it("D1: renderiza las 5 columnas y una fila por orden mapeando cada celda; Tienda muestra el nombre, no el uuid (R18, R19, R24, R26, R6, R7, R8)", async () => {
    const items: OrdenListItemDTO[] = [
      makeOrden({
        id: "o1",
        numGuia: 1001,
        numRemision: "REM-001",
        estatusId: "est-1",
        estatusValue: "En bodega",
        destinatario: "Ana Pérez",
        tiendaId: "tienda-uuid-1",
        tiendaNombre: "Tienda Uno",
      }),
      makeOrden({
        id: "o2",
        numGuia: 1002,
        numRemision: "REM-002",
        estatusId: "est-2",
        estatusValue: "En ruta",
        destinatario: "Beto Ruiz",
        tiendaId: "tienda-uuid-2",
        tiendaNombre: "Tienda Dos",
      }),
      makeOrden({
        id: "o3",
        numGuia: 1003,
        numRemision: "REM-003",
        // Sin estatusValue: la función de render debe caer a estatusId (R6).
        estatusId: "est-3",
        estatusValue: undefined,
        destinatario: "Ceci Mora",
        tiendaId: "tienda-uuid-3",
        tiendaNombre: "Tienda Tres",
      }),
    ];
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items,
      page: 1,
      pageSize: 20,
      total: 3,
    });

    renderPage();

    // Espera la resolución async de SWR.
    await screen.findByText("Tienda Uno");

    // 5 cabeceras en orden.
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Estatus",
      "Destinatario",
      "Tienda",
    ]);

    // 3 filas de datos.
    const rows = bodyRows();
    expect(rows).toHaveLength(3);

    // Fila 1: mapeo campo a campo.
    const c1 = within(rows[0]).getAllByRole("cell");
    expect(c1[0]).toHaveTextContent("1001"); // numGuia por column.id (R8)
    expect(c1[1]).toHaveTextContent("REM-001"); // numRemision por render-string (R7)
    expect(c1[2]).toHaveTextContent("En bodega"); // estatusValue por render-función (R6)
    expect(c1[3]).toHaveTextContent("Ana Pérez"); // destinatario por column.id (R8)
    expect(c1[4]).toHaveTextContent("Tienda Uno"); // tiendaNombre por render-función (R24)

    // Fila 3: sin estatusValue → estatusId legible por la función de render (R6).
    const c3 = within(rows[2]).getAllByRole("cell");
    expect(c3[2]).toHaveTextContent("est-3");
    expect(c3[4]).toHaveTextContent("Tienda Tres");

    // La celda Tienda muestra el NOMBRE, nunca el uuid tiendaId (R24).
    expect(screen.getByText("Tienda Dos")).toBeInTheDocument();
    for (const item of items) {
      expect(screen.queryByText(item.tiendaId)).toBeNull();
    }
  });

  it("D2: muestra el estado de carga (role=status) antes de los datos, distinguible del vacío (R20)", async () => {
    // Promesa que no resuelve: SWR queda en carga.
    listarOrdenesMock.mockReturnValue(
      new Promise<ListarOrdenesResult>(() => {}),
    );

    renderPage();

    expect(screen.getByRole("status")).toBeInTheDocument();
    // No debe confundirse con el estado vacío.
    expect(screen.queryByText("No hay órdenes")).not.toBeInTheDocument();
    // Ni con datos.
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toContainElement(screen.getByRole("status"));
  });

  it("D3: respuesta ok sin items muestra 'No hay órdenes' y ninguna fila de datos (R20)", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });

    renderPage();

    await screen.findByText("No hay órdenes");
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("No hay órdenes");
    // La cabecera sigue presente.
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
  });

  it("D4: cualquier resultado no-ok o throw del transporte muestra error accesible genérico, sin tabla de datos ni internals (R21)", async () => {
    const noOk: ListarOrdenesResult[] = [
      { status: "unauthenticated" },
      { status: "forbidden" },
      { status: "validation_error", fieldErrors: { page: ["inválido"] } },
    ];

    for (const result of noOk) {
      listarOrdenesMock.mockResolvedValue(result);
      renderPage();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("No se pudieron cargar las órdenes");
      // No filtra internals de dominio.
      expect(screen.queryByText(/unauthenticated|forbidden|validation/i)).toBeNull();
      // Sin filas de datos (solo la fila del mensaje de error).
      expect(bodyRows()).toHaveLength(1);

      cleanup();
      vi.clearAllMocks();
    }

    // Throw real del transporte (rechazo de la action) también cae en error.
    listarOrdenesMock.mockRejectedValue(new Error("network down"));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No se pudieron cargar las órdenes");
    expect(screen.queryByText(/network down/i)).toBeNull();
  });

  it("D5: muestra exactamente los items devueltos por la action, sin re-filtrar por rol (R22)", async () => {
    // Simula el subconjunto que el backend ya autorizó para un adminTienda.
    const items: OrdenListItemDTO[] = [
      makeOrden({ id: "a", numGuia: 2001, tiendaNombre: "Mi Tienda" }),
      makeOrden({ id: "b", numGuia: 2002, tiendaNombre: "Mi Tienda" }),
    ];
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items,
      page: 1,
      pageSize: 20,
      total: 2,
    });

    renderPage();

    await screen.findByText("2001");
    // Rinde tantas filas como items del mock, ni más ni menos.
    expect(bodyRows()).toHaveLength(items.length);
    expect(screen.getByText("2002")).toBeInTheDocument();
  });

  it("D6: solo lectura — sin controles de paginación/orden/filtro ni acciones por fila (R23)", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [makeOrden({ id: "o1", numGuia: 3001, destinatario: "Sol" })],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    renderPage();

    await screen.findByText("Sol");
    // Ningún botón (paginación/orden/acción por fila).
    expect(screen.queryByRole("button")).toBeNull();
    // Ningún enlace de acción por fila.
    expect(screen.queryByRole("link")).toBeNull();
    // Ningún control de filtro (input/combobox).
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    // La tabla solo rinde la fila recibida.
    expect(bodyRows()).toHaveLength(1);
  });

  it("D7: el fetcher invoca la Server Action mockeada y NO hace fetch a rutas API (R18)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch no debe usarse"));

    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [makeOrden({ id: "o1", numGuia: 4001, tiendaNombre: "Tienda F" })],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    renderPage();

    await screen.findByText("Tienda F");
    // Usa la Server Action existente, con input vacío (defaults del backend, R23).
    expect(listarOrdenesMock).toHaveBeenCalled();
    expect(listarOrdenesMock).toHaveBeenCalledWith({});
    // No se hace fetch a rutas app/api/*.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
