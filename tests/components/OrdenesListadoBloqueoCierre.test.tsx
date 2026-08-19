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
});

afterEach(() => {
  cleanup();
});

// Pedido humano 2026-08-18 — EL GATE POR ZONA SE RETIRO. Este bloque tenia siete casos que
// afirmaban el deshabilitado del checkbox cuando la zona de la orden tenia >=1 mensajero con
// cierre abierto (GAM, satelite, mixto, aviso sobre la tabla...). La regla ya no existe: el
// servidor dejo de rechazar esa asignacion, asi que la UI dejo de prohibirla.
//
// No se borra el archivo: lo que queda fija LO CONTRARIO — que con zonas bloqueadas por cierre
// la orden se sigue pudiendo marcar— y ademas cubre que el resto de motivos de bloqueo (los que
// NO son el cierre) siguen vivos. Un archivo vacio dejaria la retirada sin testigo.
describe("OrdenesListado — el cierre abierto ya NO bloquea el checkbox", () => {
  it("orden en zona con cierre abierto -> checkbox HABILITADO y seleccionable", async () => {
    // El mock de zonas sigue devolviendo GAM y la satelite como "bloqueadas": el punto es que
    // el componente ya no las mira.
    renderListado([makeOrden("REM-sat", ZONA_SATELITE, false)]);

    const checkbox = await screen.findByRole("checkbox", {
      name: "Seleccionar orden REM-sat",
    });
    expect(checkbox).not.toHaveAttribute("aria-disabled", "true");

    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("lo mismo en la zona GAM (central): se marca igual", async () => {
    renderListado([makeOrden("REM-gam", ZONA_GAM, true)]);

    const checkbox = await screen.findByRole("checkbox", {
      name: "Seleccionar orden REM-gam",
    });
    expect(checkbox).not.toHaveAttribute("aria-disabled", "true");
  });

  it("el aviso de \"pagina bloqueada por cierre\" ya no aparece", async () => {
    renderListado([
      makeOrden("REM-a", ZONA_SATELITE, false),
      makeOrden("REM-b", ZONA_GAM, true),
    ]);
    await screen.findByRole("checkbox", { name: "Seleccionar orden REM-a" });

    expect(screen.queryByText(/cierre de mensajero abierto/i)).toBeNull();
  });
});

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
