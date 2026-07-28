// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { RolValue } from "@prisma/client";

import OrdenesPage from "@/app/(app)/ordenes/page";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type {
  ListarOrdenesResult,
  OrdenListItemDTO,
} from "@/lib/types/orden";

// `OrdenesListado` usa `useRouter` (navegación al escanear el QR de una etiqueta),
// que exige el App Router montado: se mockea como en el resto de la suite.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// La Server Action se mockea: los tests afirman el render de SWR (carga/datos/
// vacío/error) sin DB ni sesión. `listarOrdenes` es el fetcher de la página.
vi.mock("@/lib/actions/ordenes", () => ({
  listarOrdenes: vi.fn(),
}));

// La página resuelve el actor server-side para decidir si ofrece la carga masiva.
// Devuelve null por defecto: sin adminTienda no hay botón, igual que antes.
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(async () => null),
}));

// Feature 144/TB2.5: la página resuelve el catálogo de filtros server-side. Se
// mockea para que estos tests sigan siendo herméticos (sin DB), igual que
// `listarOrdenes`. La resolución en sí se cubre en `OrdenesPageFiltros.test.tsx`.
vi.mock("@/lib/actions/filtros-ordenes", () => ({
  obtenerCatalogoFiltrosOrdenes: vi.fn(async () => ({
    status: "ok" as const,
    catalogo: {
      zonas: [],
      tiendas: [],
      provincias: [],
      cantones: [],
      distritos: [],
    },
  })),
}));

// Feature 57: el PageHeader del topbar monta el LogoutButton (client:
// useRouter/useToast). Se stubbea para aislar la página; su comportamiento se
// cubre en LogoutButton.test.tsx.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const resolveActorMock = vi.mocked(resolveActorFromSession);

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

/**
 * Renderiza la página REAL con cache de SWR aislada por render (sin fugas entre
 * tests). `OrdenesPage` es un Server Component async: se resuelve su elemento con
 * `await` antes de montarlo (patrón para async server components en RTL).
 */
async function renderPage(): Promise<ReactElement> {
  const ui = (
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {await OrdenesPage()}
      </SWRConfig>
    </ToastProvider>
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
  it("D1: renderiza las 18 columnas del listado del maestro y una fila por orden mapeando cada celda; Tienda muestra el nombre, no el uuid (R18, R19, R24, R26, R6, R7, R8; feature 30/R14: Zona; feature 49/R29: Acciones)", async () => {
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
      pageSize: 25,
      total: 3,
    });

    await renderPage();

    // Espera la resolución async de SWR.
    await screen.findByText("Tienda Uno");

    // Cabeceras en orden: las 18 columnas ricas del listado del maestro
    // (incluye columna "Zona" propia, "Monto a cobrar", "Flete + IVA",
    // "Fulfillment" y "Comisión + IVA") + "Acciones" (feature 49/R29).
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Nº Guía",
      "Nº Remisión",
      "Estado",
      "Destinatario",
      "Producto",
      "Dirección",
      "Tienda",
      "Zona",
      "Provincia",
      "Cantón",
      "Distrito",
      "Monto a cobrar",
      "Flete + IVA",
      "Fulfillment",
      "Comisión + IVA",
      "Mensajero",
      "Fecha de creación",
      "Tiempo",
      "Acciones",
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
    // Tienda ahora es la columna 7 (índice 6): Producto y Dirección la preceden.
    expect(c1[6]).toHaveTextContent("Tienda Uno"); // tiendaNombre por render-función (R24)

    // Fila 3: sin estatusValue ni relaciones.estatus → placeholder "—" (nunca
    // filtra el uuid interno estatusId a la UI).
    const c3 = within(rows[2]).getAllByRole("cell");
    expect(c3[2]).toHaveTextContent("—");
    expect(c3[6]).toHaveTextContent("Tienda Tres");

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

    await renderPage();

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
      pageSize: 25,
      total: 0,
    });

    await renderPage();

    await screen.findByText("No hay órdenes");
    const rows = bodyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("No hay órdenes");
    // La cabecera sigue presente (18 columnas del listado del maestro + "Acciones" feature 49/R29).
    expect(screen.getAllByRole("columnheader")).toHaveLength(19);
  });

  it("D4: cualquier resultado no-ok o throw del transporte muestra error accesible genérico, sin tabla de datos ni internals (R21)", async () => {
    const noOk: ListarOrdenesResult[] = [
      { status: "unauthenticated" },
      { status: "forbidden" },
      { status: "validation_error", fieldErrors: { page: ["inválido"] } },
    ];

    for (const result of noOk) {
      listarOrdenesMock.mockResolvedValue(result);
      await renderPage();

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
    await renderPage();
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
      pageSize: 25,
      total: 2,
    });

    await renderPage();

    await screen.findByText("2001");
    // Rinde tantas filas como items del mock, ni más ni menos.
    expect(bodyRows()).toHaveLength(items.length);
    expect(screen.getByText("2002")).toBeInTheDocument();
  });

  it("D6: la única acción por fila es 'Ver historial' (botón, no enlace ni filtro); la paginación server-side sí aporta sus controles (R23, feature paginación; feature 49/R29)", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [makeOrden({ id: "o1", numGuia: 3001, destinatario: "Sol" })],
      page: 1,
      pageSize: 25,
      total: 1,
    });

    await renderPage();

    await screen.findByText("Sol");
    // Ahora /ordenes SÍ tiene controles de paginación (feature paginación):
    // existe un <nav> de paginación con botones de navegación.
    expect(
      screen.getByRole("navigation", { name: "Paginación" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    // El único combobox es el selector de tamaño de página (no un filtro de datos).
    expect(
      screen.getByRole("combobox", { name: "Elementos por página" }),
    ).toBeInTheDocument();
    // La acción por fila es un botón "Ver historial" (feature 49); no hay enlaces ni
    // inputs de filtro sobre las filas.
    expect(
      screen.getByRole("button", { name: /Ver historial de la orden/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    // La tabla solo rinde la fila recibida.
    expect(bodyRows()).toHaveLength(1);
  });

  it("carga masiva: el botón se ofrece SOLO al adminTienda", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });
    resolveActorMock.mockResolvedValueOnce({
      usuarioId: "tienda-1",
      rol: RolValue.adminTienda,
    });

    await renderPage();

    expect(
      screen.getByRole("button", { name: /carga masiva/i }),
    ).toBeInTheDocument();
  });

  it("carga masiva: NO se ofrece a otros roles ni sin sesión", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });

    // mensajero/adminSatelite ya NO alcanzan esta pagina (notFound, ver test aparte).
    for (const rol of [RolValue.maestro, RolValue.admin]) {
      resolveActorMock.mockResolvedValueOnce({ usuarioId: "u", rol });
      await renderPage();
      expect(
        screen.queryByRole("button", { name: /carga masiva/i }),
      ).toBeNull();
      cleanup();
    }

    // Sin sesión (actor null): tampoco.
    resolveActorMock.mockResolvedValueOnce(null);
    await renderPage();
    expect(
      screen.queryByRole("button", { name: /carga masiva/i }),
    ).toBeNull();
  });

  it("recepción bodega central (R16): el receptor se ofrece a maestro y admin", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });

    for (const rol of [RolValue.maestro, RolValue.admin]) {
      resolveActorMock.mockResolvedValueOnce({ usuarioId: "u", rol });
      await renderPage();
      // El receptor de bodega central aporta la entrada manual: input "Número de
      // guía" + botón "Recibir" (distinto del escáner de origen del adminTienda,
      // que solo tiene cámara).
      expect(screen.getByLabelText("Número de guía")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Recibir" }),
      ).toBeInTheDocument();
      cleanup();
    }
  });

  it("recepción bodega central (R16): NO se ofrece a adminTienda ni sin sesión", async () => {
    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
    });

    // adminTienda opera la recepción en ORIGEN (cámara), NO la de bodega central:
    // no debe ver la entrada manual de guía.
    resolveActorMock.mockResolvedValueOnce({
      usuarioId: "t1",
      rol: RolValue.adminTienda,
    });
    await renderPage();
    expect(screen.queryByLabelText("Número de guía")).toBeNull();
    expect(screen.queryByRole("button", { name: "Recibir" })).toBeNull();
    cleanup();

    // Sin sesión (actor null): tampoco.
    resolveActorMock.mockResolvedValueOnce(null);
    await renderPage();
    expect(screen.queryByLabelText("Número de guía")).toBeNull();
    expect(screen.queryByRole("button", { name: "Recibir" })).toBeNull();
  });

  it("seguridad: mensajero y adminSatelite NO alcanzan /ordenes (notFound)", async () => {
    // El mensajero opera en /mis-asignaciones y el adminSatelite en /recepcion-satelite;
    // ninguno debe ver el listado plano de todas las ordenes. La pagina llama notFound()
    // -> el Server Component async rechaza al renderse.
    for (const rol of [RolValue.mensajero, RolValue.adminSatelite]) {
      resolveActorMock.mockResolvedValueOnce({ usuarioId: "u", rol });
      await expect(OrdenesPage()).rejects.toThrow();
    }
  });

  it("D7: el fetcher invoca la Server Action con { page, pageSize } y NO hace fetch a rutas API (R18, R20, R31)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("fetch no debe usarse"));

    listarOrdenesMock.mockResolvedValue({
      status: "ok",
      items: [makeOrden({ id: "o1", numGuia: 4001, tiendaNombre: "Tienda F" })],
      page: 1,
      pageSize: 25,
      total: 1,
    });

    await renderPage();

    await screen.findByText("Tienda F");
    // Server-side: la vista pasa { page, pageSize } (feature paginación).
    expect(listarOrdenesMock).toHaveBeenCalled();
    expect(listarOrdenesMock).toHaveBeenCalledWith({ page: 1, pageSize: 25 });
    // No se hace fetch a rutas app/api/*.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
