// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

const detalleMock = vi.fn();
const detalleCompletoMock = vi.fn();
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: (...a: unknown[]) => detalleMock(...a),
  verDetalleDeMiMovimientoCompletoAction: (...a: unknown[]) => detalleCompletoMock(...a),
}));

import { DesgloseTiendaLedger } from "@/app/(app)/mi-wallet/_components/DesgloseTiendaLedger";
import { ToastProvider } from "@/providers/ToastProvider";
import { DETALLE_MI_MOVIMIENTO_VACIO } from "@/app/(app)/mi-wallet/_components/detalle-mi-movimiento-labels";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";

/**
 * Ficha 344 (B7) — ABRIR UNA FILA DEL LIBRO DE LA TIENDA Y VER SUS ÓRDENES.
 *
 * Espejo de `DetalleMovimientoCierre.test.tsx` con las DOS diferencias que son requisito:
 *
 *  - **R15 — el mensajero NO se nombra.** La ficha 335 decidió que a la tienda no se le revela
 *    quién movió su dinero. El servidor manda `mensajeroNombre: null`, y aquí se comprueba que
 *    ni siquiera un payload que lo trajera —un servidor cambiado, un mock equivocado— acabaría
 *    pintándolo: la pantalla no tiene la frase con la que hacerlo.
 *  - **R14 — no hay columna «Tienda»**: todas las órdenes son de la misma.
 */

const FECHA_FILA = "2026-08-14";

/** El nombre que NO puede aparecer en ninguna parte de esta pantalla (R15). */
const MENSAJERO_PROHIBIDO = "Kevin Solano Ramírez";

function movimiento(over: Partial<WalletTiendaMovimientoDTO> = {}): WalletTiendaMovimientoDTO {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    tiendaId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    tipo: "debito",
    categoria: "flete",
    monto: "28800.00",
    origenTipo: "cierre_dia",
    origenId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    descripcion: null,
    fechaMovimiento: `${FECHA_FILA}T10:00:00.000Z`,
    ...over,
  };
}

/** Un pago recibido: no nace de un cierre, así que no se abre (R6). */
const PAGO = movimiento({
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  tipo: "debito",
  categoria: "pago_tienda",
  monto: "4000.00",
  origenTipo: "pago_tienda",
  descripcion: "Transferencia del viernes",
});

const OTRA_DE_CIERRE = movimiento({
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  categoria: "comision_cod",
  monto: "900.00",
});

function orden(over: Partial<OrdenAporteDTO> = {}): OrdenAporteDTO {
  return {
    ordenId: "11111111-1111-4111-8111-111111111111",
    guia: "48127",
    destinatario: "María Fernández",
    tiendaNombre: "Tienda Central",
    resultados: ["entregada"],
    aporte: "1700.00",
    ...over,
  };
}

function pagina(
  ordenes: OrdenAporteDTO[],
  total: number,
  page = 1,
  pageSize = 25,
  extra: { ordenesDelCierre?: number; mensajeroNombre?: string | null } = {},
) {
  return {
    status: "ok" as const,
    data: {
      monto: "28800.00",
      cierre: {
        fecha: `${FECHA_FILA}T00:00:00.000Z`,
        // R15: el SERVIDOR manda `null` en este libro. Es el contrato, y así entra por defecto.
        mensajeroNombre: extra.mensajeroNombre ?? null,
      },
      ordenesDelCierre: extra.ordenesDelCierre ?? 9,
      total,
      page,
      pageSize,
      ordenes,
    },
  };
}

function envolver(nodo: ReactElement) {
  return render(
    <SWRConfig
      value={{
        provider: () => new Map(),
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      }}
    >
      <ToastProvider>{nodo}</ToastProvider>
    </SWRConfig>,
  );
}

function pintar(movimientos: WalletTiendaMovimientoDTO[] = [movimiento()]) {
  return envolver(<DesgloseTiendaLedger movimientos={movimientos} />);
}

const ABRIR_FLETE = `Ver las órdenes que componen Flete del ${FECHA_FILA}`;
const ABRIR_COMISION = `Ver las órdenes que componen Comisión COD del ${FECHA_FILA}`;
const PANEL_FLETE = `Órdenes que componen Flete del ${FECHA_FILA}`;
const PANEL_COMISION = `Órdenes que componen Comisión COD del ${FECHA_FILA}`;

function abrir(nombre: string) {
  return userEvent.click(screen.getByRole("button", { name: nombre }));
}

function panel(nombre: string): HTMLElement {
  return screen.getByRole("region", { name: nombre });
}

/**
 * Las filas de DATOS del panel. `:scope > tbody > tr` y no `"tbody tr"`: el panel vive dentro de
 * una fila del libro, así que su `<thead>` también es descendiente del `<tbody>` de fuera y un
 * selector de descendencia se traería la cabecera como si fuera un dato.
 */
function filasDeDatos(region: HTMLElement): HTMLTableRowElement[] {
  const tabla = region.querySelector("table");
  return [...(tabla?.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr") ?? [])];
}

function inputDeLlamada(n: number): Record<string, unknown> {
  return detalleMock.mock.calls[n][0] as Record<string, unknown>;
}

beforeEach(() => {
  detalleMock.mockReset();
  detalleCompletoMock.mockReset();
  detalleMock.mockResolvedValue(pagina([orden()], 1));
  detalleCompletoMock.mockResolvedValue({ status: "ok", items: [orden()], total: 1 });
});

afterEach(() => {
  cleanup();
});

describe("Ficha 344 — /mi-wallet: abrir una fila del libro (R1–R8)", () => {
  it("R2: con el libro pintado y sus filas cerradas no se lee ningún detalle", async () => {
    pintar([movimiento(), OTRA_DE_CIERRE, PAGO]);

    expect(
      await screen.findByRole("table", { name: "Desglose de movimientos" }),
    ).toBeInTheDocument();
    expect(detalleMock).not.toHaveBeenCalled();

    // Control de no-vacuidad: el lector está cableado; lo que no ha ocurrido es la lectura.
    await abrir(ABRIR_FLETE);
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(1));
  });

  it("R3/R42: abrir una fila cuesta UNA lectura, con el id del movimiento y la página", async () => {
    pintar([movimiento(), OTRA_DE_CIERRE]);

    await abrir(ABRIR_FLETE);
    await screen.findByRole("region", { name: PANEL_FLETE });

    expect(detalleMock).toHaveBeenCalledTimes(1);
    // Ni `tiendaId`, ni `cierreId`, ni `categoria`: el alcance NO viaja en la entrada.
    expect(inputDeLlamada(0)).toEqual({
      movimientoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      page: 1,
    });
  });

  it("R1: al abrir una fila de cierre se muestran las órdenes que componen su importe", async () => {
    detalleMock.mockResolvedValue(
      pagina(
        [
          orden({ ordenId: "o-1", guia: "48127", aporte: "1700.00" }),
          orden({ ordenId: "o-2", guia: "48128", aporte: "3400.00" }),
        ],
        2,
      ),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));
    expect(await dentro.findByText("₡1.700")).toBeInTheDocument();
    expect(dentro.getByText("₡3.400")).toBeInTheDocument();
  });

  it("R5: el control de abrir nombra SU fila, no un genérico repetido", () => {
    pintar([movimiento(), OTRA_DE_CIERRE]);

    expect(screen.getByRole("button", { name: ABRIR_FLETE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ABRIR_COMISION })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver detalle" })).toBeNull();
  });

  it("R6: una fila que no nace de un cierre NO ofrece control de apertura", () => {
    pintar([movimiento(), PAGO]);

    const aperturas = screen
      .getAllByRole("button")
      .filter((b) => (b.getAttribute("aria-label") ?? "").startsWith("Ver las órdenes"));
    expect(aperturas).toHaveLength(1);
  });

  it("R4: dos filas abiertas mantienen páginas independientes", async () => {
    detalleMock.mockImplementation(async (input: Record<string, unknown>) => {
      const page = Number(input.page);
      return pagina([orden({ ordenId: `p${page}` })], 30, page, 25);
    });
    pintar([movimiento(), OTRA_DE_CIERRE]);

    await abrir(ABRIR_FLETE);
    await screen.findByRole("region", { name: PANEL_FLETE });
    await abrir(ABRIR_COMISION);
    await screen.findByRole("region", { name: PANEL_COMISION });
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(2));

    await userEvent.click(
      within(panel(PANEL_FLETE)).getByRole("button", { name: "Página siguiente" }),
    );
    await waitFor(() => expect(detalleMock).toHaveBeenCalledTimes(3));

    await waitFor(() =>
      expect(within(panel(PANEL_FLETE)).getByText("26-30 de 30")).toBeInTheDocument(),
    );
    expect(within(panel(PANEL_COMISION)).getByText("1-25 de 30")).toBeInTheDocument();
  });

  it("R7: un movimiento ajeno responde «no encontrado» y el fallo se cuenta DENTRO de la fila", async () => {
    // El servidor no distingue «no existe» de «es de otra tienda» (R41): las dos son
    // `not_found`, y la pantalla las cuenta igual, dentro de su fila.
    detalleMock.mockResolvedValue({ status: "not_found" });
    pintar([movimiento(), PAGO]);

    await abrir(ABRIR_FLETE);

    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));
    expect(
      await dentro.findByText(/No se pudo cargar el detalle de este movimiento/),
    ).toBeInTheDocument();
    // El libro entero sigue en pie.
    expect(screen.getByRole("table", { name: "Desglose de movimientos" })).toBeInTheDocument();
    expect(screen.getByText(/Transferencia del viernes/)).toBeInTheDocument();
  });

  it("R8: un detalle sin órdenes muestra su estado vacío explícito", async () => {
    detalleMock.mockResolvedValue(pagina([], 0));
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));
    expect(await dentro.findByText(DETALLE_MI_MOVIMIENTO_VACIO)).toBeInTheDocument();
  });
});

describe("Ficha 344 — /mi-wallet: qué dice el detalle (R9–R14)", () => {
  it("R10/R13/R14: cuatro columnas —guía, destinatario, resultado y aporte—, sin «Tienda»", async () => {
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    const cabeceras = (await dentro.findAllByRole("columnheader")).map((th) =>
      th.textContent?.trim(),
    );
    expect(cabeceras).toEqual(["Guía", "Destinatario", "Resultado", "Aporte"]);
    // R14: la columna «Tienda» NO está, y el nombre de la tienda no se cuela por otra celda.
    expect(cabeceras).not.toContain("Tienda");
    expect(dentro.queryByText("Tienda Central")).toBeNull();

    expect(dentro.getByText("María Fernández")).toBeInTheDocument();
    // R13: la etiqueta legible, nunca el valor del enum.
    expect(dentro.getByText("Entregada")).toBeInTheDocument();
    expect(dentro.queryByText("entregada")).toBeNull();
    expect(dentro.getByText("₡1.700")).toBeInTheDocument();
  });

  it("R11: cada orden lleva enlace al listado de órdenes con SU guía", async () => {
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    const enlace = await dentro.findByRole("link", { name: "Ver en órdenes la guía 48127" });
    expect(enlace).toHaveAttribute("href", "/ordenes?q=48127");
  });

  it("R9/R12: la cabecera dice la fecha del cierre y el «N de M» de ESTA tienda", async () => {
    detalleMock.mockResolvedValue(pagina([orden()], 5, 1, 25, { ordenesDelCierre: 9 }));
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    expect(await dentro.findByText(`Cierre del día ${FECHA_FILA}`)).toBeInTheDocument();
    expect(
      dentro.getByText("5 de 9 órdenes tuyas del cierre aportan a este concepto"),
    ).toBeInTheDocument();
  });
});

describe("Ficha 344 — /mi-wallet NO revela quién movió el dinero (R15)", () => {
  it("R15: con el payload del contrato (mensajeroNombre = null) no hay rastro de mensajero", async () => {
    pintar();

    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });
    await within(region).findByText("₡1.700");

    expect(region.textContent ?? "").not.toMatch(/[Mm]ensajer/);
    expect(region.textContent ?? "").not.toContain(MENSAJERO_PROHIBIDO);
  });

  it("R15: aunque el payload TRAJERA el nombre, esta pantalla no lo pinta", async () => {
    // MUTACIÓN QUE ESTE CASO MATA: añadir a este panel la línea del mensajero que sí tiene el de
    // la caja. El caso de arriba no la vería —con `null` no se pinta de todas formas—, así que
    // hace falta éste: el servidor manda `null` HOY, y la pantalla tiene que seguir callada
    // aunque mañana ese `null` se rompa. Dos cierres del mismo hueco, no uno.
    detalleMock.mockResolvedValue(
      pagina([orden()], 1, 1, 25, { mensajeroNombre: MENSAJERO_PROHIBIDO }),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });
    await within(region).findByText("₡1.700");

    expect(region.textContent ?? "").not.toContain(MENSAJERO_PROHIBIDO);
    expect(region.textContent ?? "").not.toMatch(/[Mm]ensajer/);
    // Y el resto del panel SÍ está pintado: no pasa porque el panel esté vacío.
    expect(within(region).getByText(`Cierre del día ${FECHA_FILA}`)).toBeInTheDocument();
  });
});

describe("Ficha 344 — /mi-wallet: paginación, descarga y sin_reparto", () => {
  it("R25/R28: el total es el del CONJUNTO, no el largo de la página", async () => {
    const veinticinco = Array.from({ length: 25 }, (_, i) =>
      orden({ ordenId: `o-${i}`, guia: `4812${i}` }),
    );
    detalleMock.mockResolvedValue(pagina(veinticinco, 28, 1, 25));
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    // MUTACIÓN QUE ESTE CASO MATA: `const total = ordenes.length` → «1-25 de 25» y sin siguiente.
    expect(await dentro.findByText("1-25 de 28")).toBeInTheDocument();
    expect(dentro.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
  });

  it("R31/R33: el panel monta su descarga y la resuelve con la lectura DEDICADA", async () => {
    detalleMock.mockResolvedValue(pagina([orden({ ordenId: "o-1" })], 3, 1, 25));
    detalleCompletoMock.mockResolvedValue({
      status: "ok",
      items: [orden({ ordenId: "o-1" }), orden({ ordenId: "o-2" }), orden({ ordenId: "o-3" })],
      total: 3,
    });
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    const boton = await dentro.findByRole("button", { name: `Descargar ${PANEL_FLETE}` });
    expect(detalleCompletoMock).not.toHaveBeenCalled();

    await userEvent.click(boton);
    await waitFor(() => expect(detalleCompletoMock).toHaveBeenCalledTimes(1));
    expect(detalleCompletoMock.mock.calls[0][0]).toEqual({
      movimientoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("R48: un concepto sin reparto abre su panel y dice de dónde sale, en vez de callar", async () => {
    detalleMock.mockResolvedValue({ status: "sin_reparto", motivo: "no_nace_de_un_cierre" });
    pintar();

    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });

    // MUTACIÓN QUE ESTE CASO MATA: que la rama `sin_reparto` se quede MUDA.
    expect(await within(region).findByText(/no nace del cierre del día/)).toBeInTheDocument();
    expect((region.textContent ?? "").trim().length).toBeGreaterThan(80);
    expect(within(region).queryByRole("table")).toBeNull();
  });

  it("R47: el panel no pinta ningún subtotal de la página visible", async () => {
    detalleMock.mockResolvedValue(
      pagina(
        [
          orden({ ordenId: "o-1", aporte: "1700.00" }),
          orden({ ordenId: "o-2", aporte: "3400.00" }),
        ],
        2,
      ),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });
    await within(region).findByText("₡1.700");

    expect(within(region).queryByText(/subtotal|total de la p[áa]gina/i)).toBeNull();
    const importes = filasDeDatos(region).map((tr) =>
      tr.querySelectorAll("td")[3]?.textContent?.trim(),
    );
    expect(importes).toEqual(["₡1.700", "₡3.400"]);
  });
});

/**
 * Ficha 344 (T7.1) — LA FORMA DE LA TABLA EN UN TELÉFONO, en el libro de la tienda.
 *
 * Sin este bloque el juego de columnas de móvil es CÓDIGO MUERTO para la suite: el polyfill de
 * `matchMedia` devuelve siempre escritorio, así que ningún caso de arriba lo pisa y borrarlo
 * entero dejaría todo en verde. Es lo que pasó en la ficha 343.
 */
describe("Ficha 344 — /mi-wallet: el detalle en un teléfono (R50/R52)", () => {
  const matchMediaOriginal = window.matchMedia;

  function fingirTelefono() {
    window.matchMedia = ((consulta: string) =>
      ({
        matches: /max-width:\s*767px/.test(consulta),
        media: consulta,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }

  afterEach(() => {
    window.matchMedia = matchMediaOriginal;
  });

  it("en móvil la tabla tiene DOS columnas: «Orden» y «Aporte»", async () => {
    fingirTelefono();
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    const cabeceras = (await dentro.findAllByRole("columnheader")).map((th) =>
      th.textContent?.trim(),
    );
    expect(cabeceras).toEqual(["Orden", "Aporte"]);
  });

  it("R50: el aporte se lee ENTERO — `₡1.700`, `₡3.400` y `₡10.200`", async () => {
    fingirTelefono();
    detalleMock.mockResolvedValue(
      pagina(
        [
          orden({ ordenId: "o-1", aporte: "1700.00" }),
          orden({ ordenId: "o-2", aporte: "3400.00" }),
          orden({ ordenId: "o-3", aporte: "10200.00" }),
        ],
        3,
      ),
    );
    pintar();

    await abrir(ABRIR_FLETE);
    const region = await screen.findByRole("region", { name: PANEL_FLETE });
    await within(region).findByText("₡1.700");

    const importes = filasDeDatos(region).map((tr) =>
      tr.querySelectorAll("td")[1]?.textContent?.trim(),
    );
    expect(importes).toEqual(["₡1.700", "₡3.400", "₡10.200"]);
    expect(within(region).queryByText("₡1.70")).toBeNull();
    expect(within(region).queryByText("₡10.20")).toBeNull();
  });

  it("R52: apilar tres columnas en una no esconde NINGÚN dato (y sigue sin haber tienda)", async () => {
    fingirTelefono();
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    expect(
      await dentro.findByRole("link", { name: "Ver en órdenes la guía 48127" }),
    ).toBeInTheDocument();
    expect(dentro.getByText("María Fernández")).toBeInTheDocument();
    expect(dentro.getByText("Entregada")).toBeInTheDocument();
    expect(dentro.getByText("₡1.700")).toBeInTheDocument();
    // R14 también en el teléfono: la tienda no aparece ni apilada.
    expect(dentro.queryByText("Tienda Central")).toBeNull();
  });

  it("en escritorio NO cambia nada: las cuatro columnas de siempre", async () => {
    pintar();

    await abrir(ABRIR_FLETE);
    const dentro = within(await screen.findByRole("region", { name: PANEL_FLETE }));

    const cabeceras = (await dentro.findAllByRole("columnheader")).map((th) =>
      th.textContent?.trim(),
    );
    expect(cabeceras).toEqual(["Guía", "Destinatario", "Resultado", "Aporte"]);
  });
});
