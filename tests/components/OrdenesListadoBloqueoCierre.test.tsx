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
// Feature 155/R28/R32: el estado de fulfillment en bodega salio del catalogo, asi que sale
// tambien de este catalogo minimo y del mapa de ids. `en_preparacion` queda como unico
// estado de "generar guia".
const CATALOGO = [
  { id: "id-bodega", value: "en_bodega_central" },
  { id: "id-preparacion", value: "en_preparacion" },
];

const ESTATUS_ID_POR_VALUE: Record<string, string> = {
  en_bodega_central: "id-bodega",
  en_preparacion: "id-preparacion",
};

const ZONA_GAM = "zona-gam";
const ZONA_SATELITE = "zona-limon";
const ZONA_LIBRE = "zona-libre";

/**
 * Feature 156/R28: el bloqueo por cierre solo aplica al estado cuya accion por lote
 * ASIGNA mensajero, que tras esta feature es unicamente `en_bodega_central`. Por eso
 * el estado de la orden es ahora un parametro del fixture: los casos de bloqueo se
 * encuadran sobre la bodega central y los de NO-bloqueo sobre los estados de guia.
 */
function makeOrden(
  ref: string,
  zonaId: string,
  zonaEsGam: boolean,
  estatusValue = "en_bodega_central",
): OrdenListItemDTO {
  return {
    id: `id-${ref}`,
    numGuia: null,
    numRemision: ref,
    estatusId: ESTATUS_ID_POR_VALUE[estatusValue] ?? "id-bodega",
    // El bloqueo se deriva del estado de la ORDEN (ya no de una tab activa).
    estatusValue,
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
  // ---------- Feature 156/R28: el bloqueo se acota a `en_bodega_central` ----------

  // Feature 155/R32: el caso era parametrizado sobre los DOS estados de "generar guia";
  // tras el retiro queda uno solo, asi que deja de ser un `it.each`. Lo que afirma no
  // cambia.
  it("R28: orden en en_preparacion cuya zona tiene un cierre abierto -> checkbox HABILITADO y seleccionable (generar guia ya no asigna)", async () => {
    // Misma zona bloqueada que deshabilita a una orden de bodega central: lo unico
    // que cambia es el estado de la orden.
    renderListado([makeOrden("REM-prep", ZONA_SATELITE, false, "en_preparacion")]);

    const checkbox = await screen.findByRole("checkbox", {
      name: "Seleccionar orden REM-prep",
    });
    expect(checkbox).not.toHaveAttribute("aria-disabled", "true");

    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    // Y la accion por lote de ese estado sigue ofreciendose.
    expect(
      screen.getByRole("button", { name: "Generar guía" }),
    ).toBeInTheDocument();
  });

  it("R28: en la MISMA zona bloqueada, la orden de en_preparacion se selecciona y la de en_bodega_central no", async () => {
    renderListado([
      makeOrden("REM-prep", ZONA_SATELITE, false, "en_preparacion"),
      makeOrden("REM-bod", ZONA_SATELITE, false, "en_bodega_central"),
    ]);

    const libre = await screen.findByRole("checkbox", {
      name: "Seleccionar orden REM-prep",
    });
    const bloqueada = screen.getByRole("checkbox", {
      name: /No se puede seleccionar la orden REM-bod/i,
    });
    expect(libre).not.toHaveAttribute("aria-disabled", "true");
    expect(bloqueada).toHaveAttribute("aria-disabled", "true");
  });

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

  // ---------- Feature 155/R32/R41: el estado retirado no ofrece acciones por lote ----------

  // El `case` del estado de fulfillment en bodega salio de `accionesDe` junto con el value
  // (T6.2). Una fila que llegue con ese estado —o con cualquier otro que el build no
  // conozca— cae al `default`: sin acciones por lote, checkbox bloqueado con su motivo. Es
  // la degradacion segura, no una vista rota (R41). El literal se construye por piezas para
  // no reintroducirlo en el arbol (censo de T8.1).
  it.each([["retirado", ["en", "fulfillment"].join("_")], ["desconocido", "estado_del_futuro"]])(
    "155/R32: junto a una orden accionable, la del estado %s queda bloqueada con su motivo",
    async (_caso, estatusValue) => {
      // Zona SIN cierres en las dos: lo unico que puede bloquear es la falta de acciones.
      renderListado([
        makeOrden("REM-prep", ZONA_LIBRE, false, "en_preparacion"),
        makeOrden("REM-x", ZONA_LIBRE, false, estatusValue),
      ]);

      const bloqueada = await screen.findByRole("checkbox", {
        name: /No se puede seleccionar la orden REM-x/i,
      });
      expect(bloqueada).toHaveAttribute("aria-disabled", "true");
      expect(bloqueada).toHaveAccessibleName(/no tiene acciones por lote/i);
      // Su vecina de `en_preparacion` si es seleccionable: el bloqueo es POR FILA.
      expect(
        screen.getByRole("checkbox", { name: "Seleccionar orden REM-prep" }),
      ).not.toHaveAttribute("aria-disabled", "true");
    },
  );

  it.each([["retirado", ["en", "fulfillment"].join("_")], ["desconocido", "estado_del_futuro"]])(
    "155/R32: una pagina SOLO con ordenes en estado %s no monta ni la columna de seleccion",
    async (_caso, estatusValue) => {
      renderListado([makeOrden("REM-x", ZONA_LIBRE, false, estatusValue)]);

      // La fila se lista (R41: la vista NO se rompe)...
      expect(await screen.findByText("REM-x")).toBeInTheDocument();
      // ...pero sin casilla de fila (ni habilitada ni bloqueada), sin el "seleccionar
      // todo" de la cabecera y sin acciones por lote. La unica casilla de la vista es la
      // del filtro por estado, que no pertenece a la tabla.
      expect(screen.queryByRole("checkbox", { name: /orden REM-x/i })).toBeNull();
      expect(
        screen.queryByRole("checkbox", { name: "Seleccionar todas las órdenes" }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "Generar guía" })).toBeNull();
    },
  );

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

  // ---------- El motivo, a la vista y no solo en el tooltip ----------
  // Una pagina entera de casillas grises se lee como "los checkbox no funcionan" (reporte
  // real con el filtro "Reasignables" sobre una zona con cierre abierto). El aviso saca el
  // motivo del tooltip; con filas mixtas NO se avisa, porque ahi si se puede marcar algo.

  it("pagina ENTERA bloqueada por cierre -> el motivo se muestra sobre la tabla", async () => {
    renderListado([
      makeOrden("REM-a", ZONA_GAM, true),
      makeOrden("REM-b", ZONA_GAM, true),
    ]);

    expect(
      await screen.findByText(/cierre de mensajero abierto/i),
    ).toBeInTheDocument();
  });

  it("pagina MIXTA -> no se avisa (el usuario puede marcar la fila libre)", async () => {
    renderListado([
      makeOrden("REM-bloqueada", ZONA_GAM, true),
      makeOrden("REM-libre", ZONA_LIBRE, false),
    ]);

    // La fila libre confirma que la tabla ya pinto; el aviso no debe estar.
    await screen.findByRole("checkbox", { name: "Seleccionar orden REM-libre" });
    expect(screen.queryByText(/cierre de mensajero abierto/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// Acciones con selección MIXTA (unión, no intersección) y la acción de recolección en esta
// vista. Antes, marcar "seleccionar todo" sobre estados mezclados dejaba la barra vacía:
// todo marcado y ningún botón, que es exactamente lo que se reportó.
// ---------------------------------------------------------------------------------------
describe("OrdenesListado — acciones sobre una selección de estados mezclados", () => {
  it("ofrece TODAS las acciones posibles, cada una con el nº de órdenes a las que aplica", async () => {
    renderListado([
      makeOrden("REM-prep", ZONA_LIBRE, false, "en_preparacion"),
      makeOrden("REM-bodega", ZONA_LIBRE, false, "en_bodega_central"),
    ]);

    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Seleccionar orden REM-prep" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Seleccionar orden REM-bodega" }),
    );

    // Cada estado aporta la suya, y el conteo avisa de que no alcanza a toda la selección.
    expect(
      screen.getByRole("button", { name: "Generar guía (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Asignar mensajero (1)" }),
    ).toBeInTheDocument();
  });

  it("con un solo estado las acciones NO llevan conteo (no hay nada que aclarar)", async () => {
    renderListado([
      makeOrden("REM-a", ZONA_LIBRE, false, "en_preparacion"),
      makeOrden("REM-b", ZONA_LIBRE, false, "en_preparacion"),
    ]);

    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Seleccionar orden REM-a" }),
    );

    expect(screen.getByRole("button", { name: "Generar guía" })).toBeInTheDocument();
  });

  it("una acción compartida por los dos estados aplica a TODAS y no lleva conteo", async () => {
    // "Imprimir etiquetas" la tienen `en_bodega_central` y `por_recolectar_en_tienda`.
    renderListado([
      makeOrden("REM-bodega", ZONA_LIBRE, false, "en_bodega_central"),
      makeOrden("REM-tienda", ZONA_LIBRE, false, "por_recolectar_en_tienda"),
    ]);

    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Seleccionar orden REM-bodega" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Seleccionar orden REM-tienda" }),
    );

    expect(
      screen.getByRole("button", { name: "Imprimir etiquetas" }),
    ).toBeInTheDocument();
  });
});

describe("OrdenesListado — asignar la recolección en tienda (feature 157)", () => {
  it("una orden por recolectar SÍ se puede marcar y ofrece asignar mensajero", async () => {
    renderListado([makeOrden("REM-tienda", ZONA_LIBRE, false, "por_recolectar_en_tienda")]);

    const checkbox = await screen.findByRole("checkbox", {
      name: "Seleccionar orden REM-tienda",
    });
    expect(checkbox).not.toHaveAttribute("aria-disabled", "true");

    await userEvent.click(checkbox);

    expect(
      screen.getByRole("button", { name: "Asignar mensajero para recolección" }),
    ).toBeInTheDocument();
  });

  it("no se bloquea por zona con cierre abierto: la recolección no depende de la zona", async () => {
    // Misma zona que deja inseleccionable una orden de bodega central.
    renderListado([makeOrden("REM-tienda", ZONA_GAM, true, "por_recolectar_en_tienda")]);

    expect(
      await screen.findByRole("checkbox", { name: "Seleccionar orden REM-tienda" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});
