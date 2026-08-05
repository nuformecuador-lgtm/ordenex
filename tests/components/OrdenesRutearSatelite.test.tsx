// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import { RolValue } from "@prisma/client";

import OrdenesPage from "@/app/(app)/ordenes/page";
import { ToastProvider } from "@/providers/ToastProvider";
import { listarOrdenes } from "@/lib/actions/ordenes";
import { listarOrderStatus } from "@/lib/actions/order-status";
import {
  listarMensajerosParaAsignacion,
  listarZonasBloqueadasPorCierre,
  rutearABodegaSatelite,
} from "@/lib/actions/ordenes-guia";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { OrdenListItemDTO } from "@/lib/types/orden";

/**
 * Hotfix 2026-08-05 — "Rutear a bodega satélite" desapareció de producción.
 *
 * La acción existía entera en backend (`rutearABodegaSatelite` +
 * `GuiaAsignacionService.rutearABodegaSatelite`) y su modal seguía en el repo, pero al
 * borrarse la vista legacy `OrdenesRevisionMaestro` (2026-07-31) se quedó SIN NINGUNA
 * superficie de UI, y nada en la suite se puso rojo: no había un solo test que
 * afirmara que alguien puede DISPARARLA.
 *
 * Por eso estos tests montan la PÁGINA REAL (`app/(app)/ordenes/page.tsx`) y varían el
 * ROL del actor, no la prop `accionesLote`. El eslabón que decide quién ve la acción es
 * `rol → esAccesoTotal(rol) → accionesLote`, y es justo ahí donde vive el bug: pasar la
 * prop a mano lo saltaría y volvería a dejar el agujero abierto (lección del review de
 * la feature 172).
 */

// `notFound` de la página y el `useRouter` de los componentes cliente (navegación al
// escanear el QR de una etiqueta): el App Router no está montado en jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/actions/ordenes", () => ({ listarOrdenes: vi.fn() }));
vi.mock("@/lib/actions/order-status", () => ({ listarOrderStatus: vi.fn() }));
// Módulo completo: lo importan también los otros modales por lote que la página monta.
vi.mock("@/lib/actions/ordenes-guia", () => ({
  generarGuia: vi.fn(),
  asignarDesdeBodega: vi.fn(),
  asignarRecoleccion: vi.fn(),
  desasignarRecoleccion: vi.fn(),
  listarMensajerosParaAsignacion: vi.fn(),
  rutearABodegaSatelite: vi.fn(),
  listarZonasBloqueadasPorCierre: vi.fn(),
}));

// El rol sale SOLO del servidor; aquí se varía por test (es la entrada del eslabón).
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: vi.fn(async () => null),
}));

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

// El PageHeader del topbar monta el LogoutButton (client): se aísla la página.
vi.mock("@/app/_components/LogoutButton", () => ({
  LogoutButton: () => <button data-testid="logout-stub">Salir</button>,
}));

const listarOrdenesMock = vi.mocked(listarOrdenes);
const listarOrderStatusMock = vi.mocked(listarOrderStatus);
const listarMensajerosMock = vi.mocked(listarMensajerosParaAsignacion);
const listarZonasBloqueadasMock = vi.mocked(listarZonasBloqueadasPorCierre);
const rutearMock = vi.mocked(rutearABodegaSatelite);
const resolveActorMock = vi.mocked(resolveActorFromSession);

const ACCION = "Rutear a bodega satélite";

function makeOrden(
  overrides: Partial<OrdenListItemDTO> & { id: string; numRemision: string },
): OrdenListItemDTO {
  return {
    numGuia: 1000,
    estatusId: "id-bodega",
    estatusValue: "en_bodega_central",
    destinatario: "Destino",
    telefonoDest: "0999999999",
    tiendaId: "tienda-uuid",
    tiendaNombre: "Tienda X",
    zonaId: "zona-satelite-1",
    // NO-GAM: es la orden que SÍ se rutea a una bodega satélite (R13).
    zonaEsGam: false,
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

/** Monta la página REAL con el rol dado y las órdenes dadas. */
async function renderPageComo(
  rol: RolValue | null,
  items: OrdenListItemDTO[],
  catalogo: { id: string; value: string }[],
) {
  resolveActorMock.mockResolvedValue(
    rol === null ? null : { usuarioId: "u-1", rol },
  );
  listarOrderStatusMock.mockResolvedValue({ status: "ok", estatus: catalogo });
  listarOrdenesMock.mockImplementation(async (input) => {
    const { page, pageSize } = input as { page: number; pageSize: number };
    return { status: "ok", items, page, pageSize, total: items.length };
  });

  render(
    <ToastProvider>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        {await OrdenesPage()}
      </SWRConfig>
    </ToastProvider>,
  );
}

const CATALOGO_BODEGA = [{ id: "id-bodega", value: "en_bodega_central" }];

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

describe("/ordenes — 'Rutear a bodega satélite' vuelve a tener superficie (hotfix 2026-08-05)", () => {
  it("acceso total: el MAESTRO ve 'Rutear a bodega satélite' al seleccionar una orden en_bodega_central (eslabón rol → accionesLote, no la prop suelta)", async () => {
    const user = userEvent.setup();
    await renderPageComo(
      RolValue.maestro,
      [makeOrden({ id: "o1", numRemision: "REM-SAT-1" })],
      CATALOGO_BODEGA,
    );

    await user.click(
      await screen.findByRole("checkbox", {
        name: "Seleccionar orden REM-SAT-1",
      }),
    );

    expect(
      await screen.findByRole("button", { name: ACCION }),
    ).toBeInTheDocument();
  });

  it("acceso total: el ADMIN la ve TAMBIÉN — `ROLES_ACCESO_TOTAL` son dos, y este es el caso que el bug de producción dejó sin cubrir", async () => {
    const user = userEvent.setup();
    await renderPageComo(
      RolValue.admin,
      [makeOrden({ id: "o1", numRemision: "REM-SAT-1" })],
      CATALOGO_BODEGA,
    );

    await user.click(
      await screen.findByRole("checkbox", {
        name: "Seleccionar orden REM-SAT-1",
      }),
    );

    expect(
      await screen.findByRole("button", { name: ACCION }),
    ).toBeInTheDocument();
  });

  it("sin acceso total: el adminTienda no alcanza la acción — la página no le da ni selección por lote sobre la MISMA orden", async () => {
    await renderPageComo(
      RolValue.adminTienda,
      [makeOrden({ id: "o1", numRemision: "REM-SAT-1" })],
      CATALOGO_BODEGA,
    );

    // Ancla: la fila YA está pintada (el listado resolvió). El estado transitorio de
    // carga no la cumple, así que la ausencia de abajo se afirma sobre la vista final.
    const tabla = await screen.findByRole("table");
    expect(await within(tabla).findByText("REM-SAT-1")).toBeInTheDocument();

    // Sin checkbox no hay barra de lote, y sin barra no hay forma de disparar el ruteo.
    expect(within(tabla).queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: ACCION })).toBeNull();
  });

  it("origen único: en un estado que NO es en_bodega_central no la ve NADIE, ni maestro ni admin, aunque su barra de lote sí esté arriba (156/R15)", async () => {
    for (const rol of [RolValue.maestro, RolValue.admin]) {
      const user = userEvent.setup();
      await renderPageComo(
        rol,
        [
          makeOrden({
            id: "o1",
            numRemision: "REM-PR-1",
            estatusId: "id-pr",
            estatusValue: "por_recoger",
          }),
        ],
        [{ id: "id-pr", value: "por_recoger" }],
      );

      await user.click(
        await screen.findByRole("checkbox", {
          name: "Seleccionar orden REM-PR-1",
        }),
      );

      // Ancla real: la barra de lote está montada y con SUS acciones. Si la ausencia se
      // afirmara sin esto, pasaría también con la barra sin renderizar todavía.
      expect(
        await screen.findByRole("button", { name: "Deshacer asignación" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: ACCION })).toBeNull();

      cleanup();
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
    }
  });

  it("al confirmar, la Server Action recibe los ordenIds del lote seleccionado, y solo los NO-GAM (30/R13)", async () => {
    const user = userEvent.setup();
    rutearMock.mockResolvedValue({
      status: "ok",
      resultados: [
        { ordenId: "o1", estado: "en_ruta_bodega_satelite" },
        { ordenId: "o2", estado: "en_ruta_bodega_satelite" },
      ],
    });

    await renderPageComo(
      RolValue.maestro,
      [
        makeOrden({ id: "o1", numRemision: "REM-SAT-1" }),
        makeOrden({ id: "o2", numRemision: "REM-SAT-2" }),
        // GAM: comparte estado y checkbox, pero su destino ya es la central. El padre la
        // descarta antes de abrir el modal; el service la rechazaría (defensa en profundidad).
        makeOrden({
          id: "o3",
          numRemision: "REM-GAM-1",
          zonaId: "zona-central",
          zonaEsGam: true,
        }),
      ],
      CATALOGO_BODEGA,
    );

    for (const ref of ["REM-SAT-1", "REM-SAT-2", "REM-GAM-1"]) {
      await user.click(
        await screen.findByRole("checkbox", { name: `Seleccionar orden ${ref}` }),
      );
    }

    await user.click(await screen.findByRole("button", { name: ACCION }));

    // El disparador de la barra y el confirmar del modal comparten etiqueta: se acota al
    // diálogo para no confirmar sobre el botón equivocado.
    const dialogo = await screen.findByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: ACCION }));

    await vi.waitFor(() =>
      expect(rutearMock).toHaveBeenCalledWith({ ordenIds: ["o1", "o2"] }),
    );
    expect(rutearMock).toHaveBeenCalledTimes(1);
  });
});
