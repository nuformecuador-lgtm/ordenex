// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { aplicarPeriodo, diaDelMesActual } from "@/tests/fixtures/periodo-calendario";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
import type { QuienDelLibroCajaOpcionDTO } from "@/lib/types/wallet-filtros";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

// =================================================================================================
// FICHA 458-E — CIERRE DE LA PANTALLA DEL LIBRO DE CAJA (`/wallet`)
// =================================================================================================
//
// R59 «A quién»: el `SelectorBuscable` lee sus opciones del servidor (`quienesDelLibroCajaAction`) al
//   abrirse, con la dirección y el periodo del borrador y la búsqueda escrita; elegir una opción manda
//   su `valor` TAL CUAL como `aQuien` al libro, a las tarjetas + composición, al desglose, a los
//   conceptos y a la descarga. Las tarjetas y el libro filtrados salen de la MISMA entrada y la
//   pantalla pinta los dos de esa respuesta.
// Cierre del panel: el botón que cierra el «Ver» se anuncia «Cerrar», no «Close».
// Autoría: el panel «Ver» usa la autoría que el libro ya leyó (no la pide otra vez); tras anular, la
//   relee el libro (una vez) para que el panel diga quién anuló.

const listarMock = vi.fn();
const completoMock = vi.fn();
const resumenMock = vi.fn();
vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: (...a: unknown[]) => listarMock(...a),
  listarMovimientosCompletoAction: (...a: unknown[]) => completoMock(...a),
  verResumenCajaAction: (...a: unknown[]) => resumenMock(...a),
  listarMovimientosDeFilaAction: vi.fn(),
  registrarMovimientoManualAction: vi.fn(),
}));
const desgloseMock = vi.fn();
vi.mock("@/lib/actions/wallet-egresos", () => ({
  verDesgloseEgresosAction: (...a: unknown[]) => desgloseMock(...a),
  registrarEgresoAdministrativoAction: vi.fn(),
  reversarEgresoAdministrativoAction: vi.fn(),
}));
vi.mock("@/lib/actions/gasto-fijo-plantilla", () => ({
  listarPlantillasPaginadoAction: vi.fn(async () => ({ status: "ok", items: [], page: 1, pageSize: 25, total: 0 })),
  listarPlantillasCompletoAction: vi.fn(),
  crearPlantillaAction: vi.fn(),
  actualizarPlantillaAction: vi.fn(),
  eliminarPlantillaAction: vi.fn(),
  setActivaPlantillaAction: vi.fn(),
}));
vi.mock("@/lib/actions/rechazo-tienda-cobro", () => ({
  listarCobrosRechazoTiendaAction: vi.fn(async () => ({ status: "ok", items: [], total: 0 })),
  aprobarCobroRechazoTiendaAction: vi.fn(),
  rechazarCobroRechazoTiendaAction: vi.fn(),
}));
const autoriaMock = vi.fn();
vi.mock("@/lib/actions/libro-caja-autoria", () => ({
  autoriaDelLibroCajaAction: (...a: unknown[]) => autoriaMock(...a),
}));
const conceptosMock = vi.fn();
const quienesMock = vi.fn();
vi.mock("@/lib/actions/wallet-filtros", () => ({
  conceptosConMovimientosAction: (...a: unknown[]) => conceptosMock(...a),
  cierresDeLaCuentaAction: vi.fn(),
  quienesDelLibroCajaAction: (...a: unknown[]) => quienesMock(...a),
}));
const anularMock = vi.fn();
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: (...a: unknown[]) => anularMock(...a) }));
vi.mock("@/lib/actions/como-quedo", () => ({
  comoQuedoAction: vi.fn(async () => ({ status: "ok", comoQuedo: { caja: null, cuenta: null } })),
}));
vi.mock("@/lib/actions/wallet-comprobante", () => ({
  verComprobanteAction: vi.fn(),
  adjuntarComprobanteAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));

import { WalletModule } from "@/app/(app)/wallet/_components/WalletModule";
import { FILTROS_VACIOS, inputDeFiltros } from "@/app/(app)/wallet/_components/wallet-filtros-input";
import { aQuienDeValor, opcionesDeAQuien, valorDeAQuien } from "@/app/(app)/wallet/_components/a-quien-selector";
import { CAJA_RESUMEN_LABEL, money } from "@/app/(app)/wallet/_components/wallet-labels";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const TIENDA_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MENSAJERO_ID = "0b1c2d3e-4f5a-4b6c-9d8e-7f6a5b4c3d2e";

function fila(id: string, over: Partial<WalletMovimientoDTO>): WalletMovimientoDTO {
  return {
    id,
    tipo: "egreso",
    categoria: "egreso_sueldo",
    monto: "25000.00",
    origenTipo: "gasto",
    origenId: null,
    descripcion: "Sueldo de septiembre",
    registradoPor: "99999999-0000-4000-8000-000000000001",
    fechaMovimiento: "2026-09-20T15:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  };
}

const SUELDO = fila("00000001-0000-4000-8000-000000000001", {
  documento: { tipo: "egreso_caja", anulado: false, tieneComprobante: false },
});
const COBRO = fila("00000002-0000-4000-8000-000000000002", {
  tipo: "ingreso",
  categoria: "ingreso_cobro_tienda",
  origenTipo: "cobro_tienda",
  origenId: "00000009-0000-4000-8000-000000000009",
  monto: "5000.00",
  descripcion: "Material de despacho",
  documento: { tipo: "cobro_tienda", anulado: false, tieneComprobante: false },
});
const PAGO_TIENDA = fila("00000003-0000-4000-8000-000000000003", {
  tipo: "egreso",
  categoria: "egreso_pago_tienda",
  origenTipo: "pago_tienda",
  origenId: "00000008-0000-4000-8000-000000000008",
  monto: "1250.50",
  descripcion: null,
  documento: null,
});

const AUTORIA: Record<string, Omit<AutoriaDeFilaDTO, "movimientoId">> = {
  [SUELDO.id]: {
    aQuien: { nombre: "Juan Pérez", beneficiario: null, cuenta: null, esOrdenex: false },
    registro: { nombre: "Ana Maestra", automatico: null },
    registradoEl: { fecha: "2026-09-20", hora: "09:15" },
    como: null,
    anulacion: null,
  },
  [COBRO.id]: {
    aQuien: { nombre: "Tania Tienda", beneficiario: null, cuenta: { tipo: "tienda", id: TIENDA_ID }, esOrdenex: false },
    registro: { nombre: "Ana Maestra", automatico: null },
    registradoEl: { fecha: "2026-09-20", hora: "09:15" },
    como: null,
    anulacion: null,
  },
  [PAGO_TIENDA.id]: {
    aQuien: { nombre: "Tania Tienda", beneficiario: null, cuenta: { tipo: "tienda", id: TIENDA_ID }, esOrdenex: false },
    registro: { nombre: "Ana Maestra", automatico: null },
    registradoEl: { fecha: "2026-09-20", hora: "09:15" },
    como: null,
    anulacion: null,
  },
};

const RESUMEN = {
  entradas: "18000.00",
  salidas: "25000.00",
  enCaja: "-7000.00",
  signoEnCaja: "negativo" as const,
  ingresosPropios: "5000.00",
  egresosPropios: "25000.00",
  ganancia: "-20000.00",
  signoGanancia: "negativo" as const,
  deTerceros: "10000.00",
  periodoFiltrado: false,
  porcentajeTiendas: "0.00",
  modoComposicion: "dos_bolsillos" as const,
  capital: "3000.00",
  signoCapital: "positivo" as const,
  deOrdenex: "-17000.00",
  signoDeTerceros: "positivo" as const,
  deTercerosAbsoluto: "10000.00",
  estado: "flujo" as const,
  flujoDesde: "2026-08-25",
};
/**
 * Lo que el SERVIDOR devuelve para «Tania Tienda»: el libro son sus dos filas (entra 5000,00 y sale
 * 1250,50) y las tarjetas, esas mismas dos filas sumadas. Cifras distintas de las de sin filtro para
 * que ninguna aserción acierte por casualidad.
 */
const LIBRO_TANIA = [COBRO, PAGO_TIENDA];
const RESUMEN_TANIA = {
  ...RESUMEN,
  entradas: "5000.00",
  salidas: "1250.50",
  enCaja: "3749.50",
  signoEnCaja: "positivo" as const,
  periodoFiltrado: true,
};
const COMPOSICION = {
  ingresos: {
    ingreso_flete: "0.00",
    ingreso_flete_devolucion: "0.00",
    ingreso_comision_cod: "0.00",
    ingreso_iva_flete: "0.00",
    ingreso_iva_flete_devolucion: "0.00",
    ingreso_iva_comision_cod: "0.00",
    ingreso_ajuste: "0.00",
    ingreso_cobro_tienda: "5000.00",
  },
  totalIngresos: "5000.00",
  egresos: {
    egreso_pago_mensajero: "0.00",
    egreso_ajuste: "0.00",
    egreso_reverso_cobro_tienda: "0.00",
    egreso_reverso_flete_devolucion: "0.00",
    egreso_reverso_iva_flete_devolucion: "0.00",
  },
  otrosEgresos: "0.00",
  hayOtrosEgresos: false,
  totalEgresos: "0.00",
};
const DESGLOSE = { gastoFijo: "0.00", gastoVariable: "0.00", sueldo: "25000.00", indemnizacion: "0.00", total: "25000.00" };

const PAGINA = [SUELDO, COBRO];

/** Las opciones del selector tal como las da el servidor (el `valor` es el `aQuien`). */
const OPCIONES: QuienDelLibroCajaOpcionDTO[] = [
  { valor: { nombre: "Juan Pérez" }, clase: "nombre", nombre: "Juan Pérez", movimientos: 1 },
  { valor: { tipo: "mensajero", id: MENSAJERO_ID }, clase: "mensajero", nombre: "Mario Mensajero", movimientos: 4 },
  { valor: { tipo: "tienda", id: TIENDA_ID }, clase: "tienda", nombre: "Tania Tienda", movimientos: 2 },
];

function Envoltura({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

function pintarModulo(movimientos: WalletMovimientoDTO[] = PAGINA) {
  render(
    <Envoltura>
      <WalletModule
        movimientos={movimientos}
        total={movimientos.length}
        page={1}
        pageSize={20}
        resumen={RESUMEN}
        desglose={DESGLOSE}
        composicion={COMPOSICION}
        plantillas={{ items: [], total: 0, pageSize: 25 }}
        cobrosPendientes={{ items: [], total: 0 }}
        cobrosRechazoTienda={{ items: [], total: 0 }}
        puedeDecidirCobros
        puedeDecidirCobrosRechazo
        ahoraIso="2026-09-26T18:00:00.000Z"
      />
    </Envoltura>,
  );
  return userEvent.setup();
}

function tabla(): HTMLElement {
  return screen.getByRole("table", { name: "Libro de movimientos" });
}

function disparadorAQuien(): HTMLElement {
  return screen.getByRole("button", { name: /^A quién: / });
}

async function elegirAQuien(user: ReturnType<typeof userEvent.setup>, rotulo: RegExp) {
  await user.click(disparadorAQuien());
  const lista = await screen.findByRole("listbox", { name: "A quién" });
  await user.click(await within(lista).findByRole("option", { name: rotulo }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({ status: "ok", data: { movimientos: PAGINA, total: PAGINA.length, page: 1, pageSize: 20 } });
  resumenMock.mockResolvedValue({ status: "ok", resumen: RESUMEN, composicion: COMPOSICION });
  desgloseMock.mockResolvedValue({ status: "ok", desglose: DESGLOSE });
  completoMock.mockResolvedValue({ status: "ok", items: PAGINA, total: PAGINA.length });
  conceptosMock.mockResolvedValue({ status: "ok", conceptos: [{ categoria: "ingreso_cobro_tienda", movimientos: 1 }] });
  quienesMock.mockResolvedValue({ status: "ok", opciones: OPCIONES, hayMas: false });
  anularMock.mockResolvedValue({ status: "ok", camino: "egreso_caja" });
  autoriaMock.mockImplementation(async ({ movimientoIds }: { movimientoIds: string[] }) => ({
    status: "ok",
    filas: movimientoIds.filter((id) => AUTORIA[id] !== undefined).map((id) => ({ movimientoId: id, ...AUTORIA[id] })),
  }));
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("458-E R59 — el selector «A quién»", () => {
  it("no lee nada hasta que se abre; al abrirlo pide las opciones y las rotula con nombre, clase y cardinal", async () => {
    const user = pintarModulo();
    expect(disparadorAQuien()).toHaveAccessibleName("A quién: Todos");
    expect(quienesMock).not.toHaveBeenCalled();

    await user.click(disparadorAQuien());
    const lista = await screen.findByRole("listbox", { name: "A quién" });
    // Ancla de CONTENIDO (no de conteo): la última opción ya está pintada.
    await within(lista).findByRole("option", { name: "Tania Tienda · Tienda · 2 movimientos" });
    expect(within(lista).getAllByRole("option")).toHaveLength(OPCIONES.length + 1);
    expect(quienesMock).toHaveBeenCalledWith({});
    const rotulos = within(lista).getAllByRole("option").map((o) => o.textContent);
    expect(rotulos).toEqual([
      "Todos",
      "Juan Pérez · Nombre anotado · 1 movimiento",
      "Mario Mensajero · Mensajero · 4 movimientos",
      "Tania Tienda · Tienda · 2 movimientos",
    ]);
    // H6: el id de la cuenta viaja en el valor y no se pinta en ninguna parte.
    expect(document.body.textContent ?? "").not.toMatch(UUID);
  });

  // FICHA 463 — REESCRITO: «A quién» es de la ZONA DE LA WALLET; sus opciones son las del periodo
  // APLICADO (ya no las del borrador) y no las acota la dirección, que es un filtro del libro.
  it("463: las opciones son las del periodo APLICADO, sin la dirección del libro, y la búsqueda va al servidor", async () => {
    const user = pintarModulo();
    await user.click(screen.getByRole("button", { name: "Sale" }));
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));
    await aplicarPeriodo(user, screen.getByRole("region", { name: "Filtros de toda la wallet" }), 1, 28);
    await waitFor(() => expect(resumenMock).toHaveBeenCalledTimes(1));
    const periodo = { desde: diaDelMesActual(1), hasta: diaDelMesActual(28) };

    await user.click(disparadorAQuien());
    await waitFor(() => expect(quienesMock).toHaveBeenCalledWith(periodo));
    await user.type(screen.getByRole("combobox", { name: "Buscar a quién" }), "tania");
    await waitFor(() => expect(quienesMock).toHaveBeenLastCalledWith({ ...periodo, busqueda: "tania" }));
    for (const [input] of quienesMock.mock.calls) expect(input).not.toHaveProperty("tipo");
  });

  it("dice que hay más cuando el servidor recorta la lista, y lo dice si no la pudo leer", async () => {
    quienesMock.mockResolvedValueOnce({ status: "ok", opciones: OPCIONES, hayMas: true });
    const user = pintarModulo();
    await user.click(disparadorAQuien());
    expect(await screen.findByText(/Hay más nombres de los que caben/)).toBeInTheDocument();
    cleanup();

    quienesMock.mockResolvedValue({ status: "forbidden" });
    const user2 = pintarModulo();
    await user2.click(disparadorAQuien());
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar la lista");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("458-E R59 — elegir «A quién» filtra el libro, las tarjetas, el desglose, los conceptos y la descarga", () => {
  it("por TIENDA: el `valor` del servidor viaja tal cual a las tres lecturas, y las tarjetas y el libro filtrados coinciden", async () => {
    listarMock.mockResolvedValue({ status: "ok", data: { movimientos: LIBRO_TANIA, total: LIBRO_TANIA.length, page: 1, pageSize: 20 } });
    resumenMock.mockResolvedValue({ status: "ok", resumen: RESUMEN_TANIA, composicion: COMPOSICION });
    const user = pintarModulo();

    await elegirAQuien(user, /^Tania Tienda · Tienda/);

    const esperado = { aQuien: { tipo: "tienda", id: TIENDA_ID }, page: 1, pageSize: 20 };
    await waitFor(() => expect(listarMock).toHaveBeenCalledWith(esperado));
    // La MISMA entrada para el libro y para las tarjetas + composición y el desglose.
    expect(resumenMock).toHaveBeenCalledWith(esperado);
    expect(desgloseMock).toHaveBeenCalledWith(esperado);
    expect(listarMock.mock.calls[0][0]).toEqual(resumenMock.mock.calls[0][0]);

    // Lo que se pinta: el libro de Tania y las tarjetas de ese mismo conjunto.
    await waitFor(() => {
      expect(within(tabla()).queryByRole("status")).toBeNull();
      expect(within(tabla()).queryByText("Sueldo de septiembre")).toBeNull();
    });
    expect(within(tabla()).getAllByRole("row").slice(1)).toHaveLength(LIBRO_TANIA.length);
    const principal = screen.getByRole("region", { name: "Resumen de la caja y acciones" });
    // La cifra principal: entradas − salidas del conjunto filtrado.
    expect(principal.textContent).toContain(money(RESUMEN_TANIA.enCaja));
    // Entradas = lo que ENTRA en las filas del libro (5000,00); salidas = lo que SALE (1250,50).
    const entra = LIBRO_TANIA.filter((m) => m.tipo === "ingreso").map((m) => m.monto);
    const sale = LIBRO_TANIA.filter((m) => m.tipo === "egreso").map((m) => m.monto);
    expect(entra).toEqual([RESUMEN_TANIA.entradas]);
    expect(sale).toEqual([RESUMEN_TANIA.salidas]);
    expect(principal.textContent).toContain(money(RESUMEN_TANIA.entradas));
    expect(principal.textContent).toContain(money(RESUMEN_TANIA.salidas));
    // El conteo de la tarjeta es el total del libro filtrado.
    expect(principal.textContent).toContain(`${CAJA_RESUMEN_LABEL.movimientos}`);
    expect(principal.textContent).toMatch(new RegExp(`${CAJA_RESUMEN_LABEL.movimientos}\\D*${LIBRO_TANIA.length}`));

    // El disparador dice lo elegido.
    expect(disparadorAQuien()).toHaveAccessibleName("A quién: Tania Tienda · Tienda · 2 movimientos");

    // Los conceptos del filtro se cuentan para ESE a quién.
    await waitFor(() =>
      expect(conceptosMock).toHaveBeenCalledWith({ libro: "caja", aQuien: { tipo: "tienda", id: TIENDA_ID } }),
    );

    // Y la descarga lleva el mismo filtro.
    await user.click(screen.getByRole("button", { name: "Descargar Libro de movimientos" }));
    await waitFor(() => expect(completoMock).toHaveBeenCalledWith({ aQuien: { tipo: "tienda", id: TIENDA_ID } }));
  });

  // FICHA 463 (R12) — la dirección se suma en el LIBRO; las cifras reciben solo «A quién».
  it("por MENSAJERO, sumado a la dirección elegida en el libro (las cifras, sin la dirección)", async () => {
    const user = pintarModulo();
    await user.click(screen.getByRole("button", { name: "Entra" }));
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Entra" })).toHaveAttribute("aria-pressed", "true"));
    await elegirAQuien(user, /^Mario Mensajero · Mensajero/);
    const aQuien = { tipo: "mensajero", id: MENSAJERO_ID };
    await waitFor(() =>
      expect(listarMock).toHaveBeenCalledWith({ tipo: "ingreso", aQuien, page: 1, pageSize: 20 }),
    );
    expect(resumenMock).toHaveBeenLastCalledWith({ aQuien, page: 1, pageSize: 20 });
    expect(desgloseMock).toHaveBeenLastCalledWith({ aQuien, page: 1, pageSize: 20 });
  });

  // FICHA 463 — la banda con «Limpiar» se retiró: «A quién» se quita eligiendo «Todos» (R20), y el
  // «Limpiar todo» del libro NO lo toca (R30).
  it("por NOMBRE LIBRE; «Todos» quita el filtro y el «Limpiar todo» del libro no lo toca", async () => {
    const user = pintarModulo();
    await elegirAQuien(user, /^Juan Pérez · Nombre anotado/);
    await waitFor(() =>
      expect(listarMock).toHaveBeenLastCalledWith({ aQuien: { nombre: "Juan Pérez" }, page: 1, pageSize: 20 }),
    );

    await elegirAQuien(user, /^Todos$/);
    await waitFor(() => expect(listarMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }));
    expect(disparadorAQuien()).toHaveAccessibleName("A quién: Todos");

    await elegirAQuien(user, /^Juan Pérez · Nombre anotado/);
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(3));
    await user.click(screen.getByRole("button", { name: "Sale" }));
    await waitFor(() =>
      expect(listarMock).toHaveBeenLastCalledWith({ tipo: "egreso", aQuien: { nombre: "Juan Pérez" }, page: 1, pageSize: 20 }),
    );
    await user.click(await screen.findByRole("button", { name: "Limpiar todo" }));
    await waitFor(() =>
      expect(listarMock).toHaveBeenLastCalledWith({ aQuien: { nombre: "Juan Pérez" }, page: 1, pageSize: 20 }),
    );
    expect(disparadorAQuien()).toHaveAccessibleName(/^A quién: Juan Pérez/);
  });

  it("«A quién» se conserva al aplicar el periodo después", async () => {
    const user = pintarModulo();
    await elegirAQuien(user, /^Tania Tienda · Tienda/);
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(disparadorAQuien()).toHaveAccessibleName(/^A quién: Tania Tienda/));
    await aplicarPeriodo(user, screen.getByRole("region", { name: "Filtros de toda la wallet" }), 1, 28);
    await waitFor(() =>
      expect(listarMock).toHaveBeenLastCalledWith({
        aQuien: { tipo: "tienda", id: TIENDA_ID },
        desde: diaDelMesActual(1),
        hasta: diaDelMesActual(28),
        page: 1,
        pageSize: 20,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("458-E R59 — la traducción opción ↔ filtro", () => {
  it("`inputDeFiltros` pone `aQuien` (y nada si no hay)", () => {
    expect(inputDeFiltros(FILTROS_VACIOS)).toEqual({});
    expect(inputDeFiltros({ ...FILTROS_VACIOS, aQuien: { nombre: "Juan Pérez" } })).toEqual({ aQuien: { nombre: "Juan Pérez" } });
  });

  it("el valor de cada opción vuelve a ser EXACTAMENTE su `aQuien`; lo que no es un `aQuien` no filtra", () => {
    for (const o of OPCIONES) expect(aQuienDeValor(valorDeAQuien(o.valor))).toEqual(o.valor);
    expect(opcionesDeAQuien(OPCIONES).map((o) => aQuienDeValor(o.value))).toEqual(OPCIONES.map((o) => o.valor));
    expect(aQuienDeValor(null)).toBeUndefined();
    expect(aQuienDeValor("no-es-json")).toBeUndefined();
    expect(aQuienDeValor(JSON.stringify({ tipo: "tienda", id: "123" }))).toBeUndefined();
    expect(aQuienDeValor(JSON.stringify({ nombre: "x", colado: 1 }))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("458-E — el panel «Ver» usa la autoría del libro y se cierra con «Cerrar»", () => {
  it("abrir «Ver» NO vuelve a leer la autoría: el panel dice lo que el libro ya leyó", async () => {
    const user = pintarModulo();
    await waitFor(() => expect(within(tabla()).getByText("Juan Pérez")).toBeInTheDocument());
    expect(autoriaMock).toHaveBeenCalledTimes(1);

    const filaSueldo = within(tabla()).getAllByRole("row").slice(1)[PAGINA.indexOf(SUELDO)];
    await user.click(within(filaSueldo).getByRole("button", { name: /^Ver Sueldo del / }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Juan Pérez")).toBeInTheDocument();
    expect(autoriaMock).toHaveBeenCalledTimes(1);
  });

  it("tras anular, el libro relee la autoría UNA vez (quién anuló) y el panel no hace su propia lectura", async () => {
    const user = pintarModulo();
    await waitFor(() => expect(autoriaMock).toHaveBeenCalledTimes(1));
    const filaSueldo = within(tabla()).getAllByRole("row").slice(1)[PAGINA.indexOf(SUELDO)];
    await user.click(within(filaSueldo).getByRole("button", { name: /^Ver Sueldo del / }));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Anular…" }));
    const dialogo = await screen.findByRole("dialog", { name: /^Anular / });
    await user.type(within(dialogo).getByLabelText(/^Motivo de la anulación/), "Registrado dos veces");
    await user.click(within(dialogo).getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(anularMock).toHaveBeenCalled());
    await waitFor(() => expect(autoriaMock).toHaveBeenCalledTimes(2));
    // La segunda lectura es la del LIBRO (todos los ids de la página), no la de una fila.
    expect(autoriaMock).toHaveBeenLastCalledWith({ movimientoIds: PAGINA.map((m) => m.id) });
  });

  it("el botón que cierra el panel se anuncia «Cerrar» (nunca «Close»)", async () => {
    const user = pintarModulo();
    const filaSueldo = within(tabla()).getAllByRole("row").slice(1)[PAGINA.indexOf(SUELDO)];
    await user.click(within(filaSueldo).getByRole("button", { name: /^Ver Sueldo del / }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /close/i })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("las primitivas Sheet y Dialog que usa la wallet dicen «Cerrar»", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Panel</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    cleanup();
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Diálogo</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });
});
