// @vitest-environment jsdom
// FICHA 454 (T2.6, R29 + R55) — la bodega satélite con las señales que el servidor pone en cada
// fila (`gestionPendiente`, `ayudaAbierta` de `RecepcionSateliteDTO`, `progress/impl_454_datos.md`):
//
//   · R29: el adminSatelite de la zona ve, junto al chip «En reparto», la nota «<Resultado> ·
//     pendiente de confirmación» o «Ayuda solicitada a la tienda». El chip no cambia.
//   · R55: «Cambiar día de reparto» NO se ofrece sobre una fila con gestión pendiente. En esta
//     pantalla la acción solo existe para `por_recoger` (262/F4), y una gestión pendiente solo
//     existe `en_reparto`: el test lo fija para que una ampliación futura de la acción a
//     `en_reparto` no se la ofrezca a la pendiente sin ponerse rojo. El traspaso (R54) no tiene
//     superficie en la satélite: se comprueba que tampoco aparece.
//
// Componente REAL (`SateliteOrdenesListado`); solo se mockean el borde (Server Actions) y el
// toast. Literales a mano.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";

import type { RecepcionSateliteDTO } from "@/lib/interfaces/services/IRecepcionSateliteService";
import { CAMPOS_BASE_ORDEN } from "@/tests/fixtures/fila-bodega-satelite";

const listarOrderStatusMock = vi.fn();
vi.mock("@/lib/actions/order-status", () => ({
  listarOrderStatus: (...a: unknown[]) => listarOrderStatusMock(...a),
}));
vi.mock("@/lib/actions/incidentes", () => ({ reportarIncidente: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { SateliteOrdenesListado } from "@/app/(app)/recepcion-satelite/_components/SateliteOrdenesListado";

const CAMBIAR_DIA = "Cambiar día de reparto";
const TRASPASAR = /Traspasar/;

function makeOrden(
  over: Partial<RecepcionSateliteDTO> & { id: string },
): RecepcionSateliteDTO {
  return {
    ...CAMPOS_BASE_ORDEN,
    numGuia: 1001,
    numRemision: `REM-${over.id}`,
    estatusValue: "en_reparto",
    destinatario: "Beto Ruiz",
    telefonoDest: "88880000",
    direccion: "Calle 1",
    producto: "Caja mediana",
    montoCobrar: 150,
    tiendaNombre: "Tienda X",
    zonaNombre: "Limón",
    provinciaNombre: "Limón",
    cantonNombre: "Central",
    distritoNombre: "Limón",
    ...over,
  };
}

const PENDIENTE = makeOrden({
  id: "pend",
  gestionPendiente: { resultado: "novedad", registradaAt: "2026-09-23T21:00:00.000Z" },
  ayudaAbierta: false,
});
const CON_AYUDA = makeOrden({ id: "ayuda", gestionPendiente: null, ayudaAbierta: true });
const EN_MANO = makeOrden({ id: "mano", gestionPendiente: null, ayudaAbierta: false });
const POR_RECOGER = makeOrden({
  id: "recoger",
  estatusValue: "mensajero_recogiendo_en_bodega",
  gestionPendiente: null,
  ayudaAbierta: false,
});

function renderListado(ordenes: RecepcionSateliteDTO[]) {
  const onCambiarDiaReparto = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SateliteOrdenesListado
        ordenes={ordenes}
        total={ordenes.length}
        totalSinFiltros={ordenes.length}
        catalogo={null}
        onFiltroChange={vi.fn()}
        obtenerFilasDescarga={async () => ({ status: "ok" as const, filas: [] })}
        zonaNombre="Limón"
        puedeAsignar
        onAsignar={vi.fn()}
        onEnviarACentral={vi.fn()}
        onRecuperar={vi.fn()}
        onDeshacerAsignacion={vi.fn()}
        onCambiarDiaReparto={onCambiarDiaReparto}
      />
    </SWRConfig>,
  );
  return { onCambiarDiaReparto };
}

function filaDe(numRemision: string): HTMLElement {
  return screen.getByText(numRemision).closest("tr") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  listarOrderStatusMock.mockResolvedValue({
    status: "ok",
    estatus: [
      { id: "st-en_reparto", value: "en_reparto" },
      { id: "st-mensajero_recogiendo_en_bodega", value: "mensajero_recogiendo_en_bodega" },
    ],
  });
});

afterEach(() => cleanup());

describe("454/R29 — la bodega satélite pinta la nota junto al chip de estado", () => {
  it("gestión pendiente: «En reparto» + «Devuelta · pendiente de confirmación»", () => {
    renderListado([PENDIENTE, EN_MANO]);
    const fila = filaDe("REM-pend");
    expect(within(fila).getByText("En reparto")).toBeInTheDocument();
    expect(within(fila).getByText("Devuelta · pendiente de confirmación")).toBeInTheDocument();
  });

  it("ayuda abierta: «En reparto» + «Ayuda solicitada a la tienda»", () => {
    renderListado([CON_AYUDA]);
    const fila = filaDe("REM-ayuda");
    expect(within(fila).getByText("En reparto")).toBeInTheDocument();
    expect(within(fila).getByText("Ayuda solicitada a la tienda")).toBeInTheDocument();
  });

  it("en mano: ninguna nota", () => {
    renderListado([EN_MANO]);
    const fila = filaDe("REM-mano");
    expect(within(fila).getByText("En reparto")).toBeInTheDocument();
    expect(within(fila).queryByText(/pendiente de confirmación/)).toBeNull();
    expect(within(fila).queryByText("Ayuda solicitada a la tienda")).toBeNull();
  });
});

describe("454/R54-R55 — la fila con gestión pendiente no ofrece cambio de día ni traspaso", () => {
  it("R55 — marcada la pendiente, no sale «Cambiar día de reparto»; con `mensajero_recogiendo_en_bodega` sí (control)", async () => {
    const user = userEvent.setup();
    const { onCambiarDiaReparto } = renderListado([PENDIENTE, POR_RECOGER]);

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar REM-pend" }));
    expect(screen.getByText(/1 seleccionada\(s\) en esta página/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CAMBIAR_DIA })).toBeNull();

    // Control: la misma barra SÍ la ofrece para la `por_recoger`, y lo que recibe no incluye la
    // pendiente.
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar REM-pend" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar REM-recoger" }));
    await user.click(screen.getByRole("button", { name: CAMBIAR_DIA }));
    expect(onCambiarDiaReparto).toHaveBeenCalledTimes(1);
    expect(onCambiarDiaReparto.mock.calls[0][0].map((o: RecepcionSateliteDTO) => o.id)).toEqual([
      "recoger",
    ]);
  });

  it("R54 — la satélite no ofrece traspaso sobre la pendiente", async () => {
    const user = userEvent.setup();
    renderListado([PENDIENTE]);

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar REM-pend" }));
    expect(screen.queryByRole("button", { name: TRASPASAR })).toBeNull();
    expect(screen.queryByRole("button", { name: CAMBIAR_DIA })).toBeNull();
  });
});
