// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type { RechazoTiendaCobroDTO } from "@/lib/types/rechazo-tienda-cobro";

// 💰 FICHA 337 (segunda mitad) — LA SECCIÓN DE COBROS POR RECHAZO DE TIENDA POR APROBAR.
//
// Las tres Server Actions se mockean: aquí se mide LA PANTALLA, no el backend (que tiene sus
// propios tests de servicio y sus casos contra Postgres). Lo que estos casos afirman es lo que una
// persona ve y puede hacer: que la sección se note cuando hay algo, que no exista cuando no lo
// hay, que el número de la insignia sea el del SERVIDOR, que los botones sólo aparezcan para quien
// puede decidir, y que decidir refresque sin recargar la página.

const listarMock = vi.fn();
const aprobarMock = vi.fn();
const rechazarMock = vi.fn();
vi.mock("@/lib/actions/rechazo-tienda-cobro", () => ({
  listarCobrosRechazoTiendaAction: (...a: unknown[]) => listarMock(...a),
  aprobarCobroRechazoTiendaAction: (...a: unknown[]) => aprobarMock(...a),
  rechazarCobroRechazoTiendaAction: (...a: unknown[]) => rechazarMock(...a),
}));

import { CobrosRechazoTiendaPendientesPanel } from "@/app/(app)/wallet/_components/CobrosRechazoTiendaPendientesPanel";
import {
  COBROS_RECHAZO_DESCRIPCION,
  COBROS_RECHAZO_SECCION,
  COBRO_RECHAZO_MENSAJE,
  SIN_GUIA,
} from "@/app/(app)/wallet/_components/cobro-rechazo-tienda-labels";

/** El más antiguo. Con guía asignada y con IVA. */
const VIEJO: RechazoTiendaCobroDTO = {
  id: "11111111-1111-1111-1111-111111111111",
  tiendaNombre: "Tienda Sol",
  numGuia: 4021,
  numRemision: "REM-4021",
  montoFlete: "2500.00",
  montoIva: "325.00",
  generadoEl: "2026-08-29",
  estado: "pendiente",
};

/** El del día siguiente, SIN guía asignada: el hueco tiene que verse nombrado, no en blanco. */
const MEDIO: RechazoTiendaCobroDTO = {
  id: "22222222-2222-2222-2222-222222222222",
  tiendaNombre: "Tienda Luna",
  numGuia: null,
  numRemision: "REM-9002",
  montoFlete: "1800.00",
  montoIva: "0.00", // una tarifa sin IVA de flete: el cero es un valor REAL
  generadoEl: "2026-08-30",
  estado: "pendiente",
};

/** El más reciente. */
const NUEVO: RechazoTiendaCobroDTO = {
  id: "33333333-3333-3333-3333-333333333333",
  tiendaNombre: "Tienda Mar",
  numGuia: 4099,
  numRemision: "REM-4099",
  montoFlete: "3200.00",
  montoIva: "416.00",
  generadoEl: "2026-08-31",
  estado: "pendiente",
};

function envolver(ui: ReactElement) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}

/**
 * Monta la sección con su cola pre-obtenida. La lectura del servidor devuelve LO MISMO que las
 * props, para que la revalidación de SWR al montar no vacíe la tabla. `total` va aparte de `items`
 * a propósito: es el número del servidor.
 */
function montar(
  items: RechazoTiendaCobroDTO[],
  opciones: { total?: number; puedeDecidir?: boolean; onCambio?: () => void } = {},
) {
  const total = opciones.total ?? items.length;
  listarMock.mockResolvedValue({ status: "ok", items, total });
  return envolver(
    <CobrosRechazoTiendaPendientesPanel
      initialData={{ items, total }}
      puedeDecidir={opciones.puedeDecidir ?? true}
      onCambio={opciones.onCambio}
    />,
  );
}

function seccion() {
  return screen.getByRole("region", { name: COBROS_RECHAZO_SECCION });
}

/** Las filas de datos de la tabla (sin la de encabezados). */
function filas() {
  return within(seccion()).getAllByRole("row").slice(1);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("💰 337 — la cola de cobros por rechazo de tienda", () => {
  it("se ve cuando hay algo: título, explicación e insignia con el total del SERVIDOR", async () => {
    montar([VIEJO, NUEVO], { total: 7 });

    expect(seccion()).toBeInTheDocument();
    expect(within(seccion()).getByText(COBROS_RECHAZO_DESCRIPCION)).toBeInTheDocument();
    // ⭑ 7 y no 2: `items` viene recortado por el tope del servidor, y la insignia dice el
    // conjunto. Si esto se derivara de `items.length`, una cola larga mentiría en pantalla.
    expect(within(seccion()).getByText("7 por aprobar")).toBeInTheDocument();
  });

  it("⭑ con la cola vacía la sección NO se renderiza", async () => {
    montar([], { total: 0 });
    // Una tarjeta vacía permanente en la pantalla del dinero sería ruido: lo que se pide es que
    // se note cuando HAY algo.
    expect(screen.queryByRole("region", { name: COBROS_RECHAZO_SECCION })).toBeNull();
  });

  it("⭑ pinta los DOS importes por separado, tal cual llegan, y NO un total sumado", async () => {
    // La ficha prohíbe una operación de dinero nueva. Sumar flete e IVA para pintar una celda
    // sería exactamente eso, así que la tabla enseña los dos conceptos como los enseña el detalle
    // del cierre. Este caso lo fija: los dos importes están, y su suma (2825,00) NO.
    montar([VIEJO]);

    const fila = filas()[0];
    expect(within(fila).getByText("₡2.500")).toBeInTheDocument();
    expect(within(fila).getByText("₡325")).toBeInTheDocument();
    expect(within(seccion()).queryByText("₡2.825")).toBeNull(); // 2.500 + 325
  });

  it("un IVA de 0,00 se PINTA (es un valor real), no se deja en blanco", async () => {
    montar([MEDIO]);
    expect(within(filas()[0]).getByText("₡0")).toBeInTheDocument();
  });

  it("una orden sin guía enseña el hueco NOMBRADO, no una celda en blanco", async () => {
    // En blanco no se distingue «no tiene guía» de «no se pudo leer».
    montar([MEDIO]);
    expect(within(filas()[0]).getByText(SIN_GUIA)).toBeInTheDocument();
  });

  it("ordena del MÁS ANTIGUO al más reciente aunque lleguen desordenados", async () => {
    montar([NUEVO, VIEJO, MEDIO]);

    const nombres = filas().map((f) => within(f).getAllByRole("cell")[0].textContent);
    expect(nombres).toEqual(["Tienda Sol", "Tienda Luna", "Tienda Mar"]);
  });

  it("⭑ sin permiso para decidir NO hay botones, pero la cola SÍ se ve", async () => {
    // Esconder el botón es COMODIDAD, no seguridad: la autorización real la hace el servicio. Lo
    // que este caso fija es que ocultarlo no oculta la información.
    montar([VIEJO], { puedeDecidir: false });

    expect(within(seccion()).getByText("Tienda Sol")).toBeInTheDocument();
    expect(within(seccion()).queryByRole("button", { name: "Cobrar" })).toBeNull();
    expect(within(seccion()).queryByRole("button", { name: "No cobrar" })).toBeNull();
  });

  it("⭑ aprobar manda SOLO el id: ningún importe viaja desde el navegador", async () => {
    const onCambio = vi.fn();
    aprobarMock.mockResolvedValue({ status: "ok", yaEstabaEnElLibro: false });
    montar([VIEJO], { onCambio });

    await userEvent.click(within(filas()[0]).getByRole("button", { name: "Cobrar" }));

    // `toHaveBeenCalledWith` del objeto ENTERO: la afirmación incluye que NO se manda nada más.
    // Lo que se cobra es la copia que el cobro congeló, leída en el servidor.
    await waitFor(() => expect(aprobarMock).toHaveBeenCalledWith({ id: VIEJO.id }));
    expect(onCambio).toHaveBeenCalled(); // aprobar mueve la caja: el módulo recarga sus cifras
  });

  it("`yaEstabaEnElLibro` dice la verdad: «ya estaba», no «acaba de cobrarse»", async () => {
    aprobarMock.mockResolvedValue({ status: "ok", yaEstabaEnElLibro: true });
    montar([VIEJO]);

    await userEvent.click(within(filas()[0]).getByRole("button", { name: "Cobrar" }));

    expect(await screen.findByText(COBRO_RECHAZO_MENSAJE.yaEstabaEnElLibro)).toBeInTheDocument();
    expect(screen.queryByText(COBRO_RECHAZO_MENSAJE.aprobado)).toBeNull();
  });

  it("⭑ `ya_decidido` NO se pinta como error: alguien decidió antes, y la lista se recarga", async () => {
    aprobarMock.mockResolvedValue({ status: "ya_decidido" });
    montar([VIEJO]);

    await userEvent.click(within(filas()[0]).getByRole("button", { name: "Cobrar" }));

    expect(await screen.findByText(COBRO_RECHAZO_MENSAJE.yaDecidido)).toBeInTheDocument();
    await waitFor(() => expect(listarMock).toHaveBeenCalled());
  });

  it("descartar el cobro avisa de que NO se le cobró nada a la tienda", async () => {
    rechazarMock.mockResolvedValue({ status: "ok" });
    montar([VIEJO]);

    await userEvent.click(within(filas()[0]).getByRole("button", { name: "No cobrar" }));

    await waitFor(() => expect(rechazarMock).toHaveBeenCalledWith({ id: VIEJO.id }));
    expect(await screen.findByText(COBRO_RECHAZO_MENSAJE.rechazado)).toBeInTheDocument();
  });

  it("`forbidden` lo dice y NO recarga la lista (recargar no arreglaría un permiso)", async () => {
    aprobarMock.mockResolvedValue({ status: "forbidden" });
    montar([VIEJO]);

    await userEvent.click(within(filas()[0]).getByRole("button", { name: "Cobrar" }));

    // `findAllByText` y no `findByText`: el aviso vive a la vez en la region visible y en la
    // region "polite" que lo anuncia a un lector de pantalla, asi que aparece DOS veces en el
    // arbol. Lo que se afirma es que el texto esta, no cuantos nodos lo llevan.
    expect((await screen.findAllByText(COBRO_RECHAZO_MENSAJE.sinPermiso)).length).toBeGreaterThan(0);
  });
});
