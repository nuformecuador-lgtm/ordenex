// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { aplicarPeriodo, diaDelMesActual } from "@/tests/fixtures/periodo-calendario";
import {
  alternarCasillas,
  casillasOfrecidas,
  elegirEnBarra,
  ponerCasillas,
  textoDelControl,
} from "@/tests/fixtures/barra-libro-wallet";

const H = vi.hoisted(() => ({
  listar: vi.fn(),
  completo: vi.fn(),
  resumen: vi.fn(),
  desglose: vi.fn(),
  conceptos: vi.fn(),
  quienes: vi.fn(),
  autoria: vi.fn(),
  toastError: vi.fn(),
  fila: vi.fn(),
  params: "",
}));

vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: (...a: unknown[]) => H.listar(...a),
  // Ficha 468: la descarga del libro lee el KARDEX.
  libroCajaKardexAction: (...a: unknown[]) => H.completo(...a),
  verResumenCajaAction: (...a: unknown[]) => H.resumen(...a),
  listarMovimientosDeFilaAction: (...a: unknown[]) => H.fila(...a),
  registrarMovimientoManualAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-egresos", () => ({
  verDesgloseEgresosAction: (...a: unknown[]) => H.desglose(...a),
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
vi.mock("@/lib/actions/libro-caja-autoria", () => ({
  autoriaDelLibroCajaAction: (...a: unknown[]) => H.autoria(...a),
}));
vi.mock("@/lib/actions/wallet-filtros", () => ({
  conceptosConMovimientosAction: (...a: unknown[]) => H.conceptos(...a),
  cierresDeLaCuentaAction: vi.fn(),
  quienesDelLibroCajaAction: (...a: unknown[]) => H.quienes(...a),
}));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));
vi.mock("@/lib/actions/como-quedo", () => ({
  comoQuedoAction: vi.fn(async () => ({ status: "ok", comoQuedo: { caja: null, cuenta: null } })),
}));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
// R30: la URL trae filtros; la barra no debe leerlos.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(H.params),
  usePathname: () => "/wallet",
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: H.toastError, info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));

import { WalletModule } from "@/app/(app)/wallet/_components/WalletModule";
import { CAJA_RESUMEN_LABEL, money } from "@/app/(app)/wallet/_components/wallet-labels";
import { elegirSoloLosMovimientos } from "@/tests/fixtures/descarga-detalle-por-orden";

function mov(n: number, over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id: `0000000${n}-0000-4000-8000-00000000000${n}`,
    tipo: "egreso",
    categoria: "egreso_sueldo",
    monto: `${n}000.00`,
    origenTipo: "gasto",
    origenId: null,
    descripcion: `Movimiento ${n}`,
    registradoPor: "99999999-0000-4000-8000-000000000001",
    fechaMovimiento: `2026-09-2${n}T15:00:00.000Z`,
    dueno: "propio",
    documento: null,
    ...over,
  };
}

const PAGINA = [mov(3), mov(2), mov(1)];

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
const RESUMEN_PERIODO = { ...RESUMEN, ganancia: "-1234.00", periodoFiltrado: true };
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

function Envoltura({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

function pintar() {
  render(
    <Envoltura>
      <WalletModule
        movimientos={PAGINA}
        total={42}
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

// =================================================================================================
// FICHA 467 (T5) — LA BARRA ÚNICA DEL LIBRO DE LA CAJA, IGUAL QUE LA DE `/ordenes`
// =================================================================================================
//
// Las acciones están dobladas (mismas que `WalletCaja463.test.tsx`). Se mide lo que la 467 añade o
// cambia: una sola barra (R1–R3), sus casillas y su orden (R6, R8, R9, R11), qué relee cada filtro
// (R10, R12, R13, R16), el periodo sin botón (R17), «A quién» y Concepto (R18, R20, R23), «Limpiar
// todo» (R25, R26), la coherencia tras un fallo (R27, R28), las lecturas en vuelo (R29), la URL (R30),
// la descarga (R31) y la entrada sin tocar nada (R34). Los literales de contrato van escritos a mano.

const libro = () => screen.getByRole("region", { name: "Libro de movimientos" });
const resumenYAcciones = () => screen.getByRole("region", { name: "Resumen de la caja y acciones" });
const buscador = () => screen.getByRole("searchbox", { name: "Buscar en el libro" });
const ganancia = () => screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.ganancia });
const tabla = () => screen.getByRole("table", { name: "Libro de movimientos" });
const periodoBoton = () => within(libro()).queryByRole("button", { name: "Periodo" });
const aQuienBoton = () => within(libro()).queryByRole("button", { name: /^A quién: / });

const OPCIONES_A_QUIEN = [
  { valor: { nombre: "Juan Pérez" }, nombre: "Juan Pérez", clase: "nombre", movimientos: 1 },
  { valor: { tipo: "tienda", id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" }, nombre: "Tania Tienda", clase: "tienda", movimientos: 2 },
];

function paginaOk(movimientos: WalletMovimientoDTO[], total = movimientos.length) {
  return { status: "ok", data: { movimientos, total, page: 1, pageSize: 20 } };
}

/** Posición de `a` respecto de `b` en el documento: ¿`a` va antes? */
function antes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

async function elegirAQuien(user: ReturnType<typeof userEvent.setup>, rotulo: RegExp) {
  if (aQuienBoton() === null) await ponerCasillas(user, libro(), "A quién");
  await user.click(aQuienBoton() as HTMLElement);
  const lista = await screen.findByRole("listbox", { name: "A quién" });
  await user.click(await within(lista).findByRole("option", { name: rotulo }));
}

beforeEach(() => {
  vi.clearAllMocks();
  H.params = "";
  H.listar.mockResolvedValue(paginaOk(PAGINA, 42));
  H.completo.mockResolvedValue({ status: "ok", items: PAGINA, total: PAGINA.length });
  H.resumen.mockResolvedValue({ status: "ok", resumen: RESUMEN_PERIODO, composicion: COMPOSICION });
  H.desglose.mockResolvedValue({ status: "ok", desglose: DESGLOSE });
  H.conceptos.mockResolvedValue({ status: "ok", conceptos: [{ categoria: "egreso_sueldo", movimientos: 3 }] });
  H.quienes.mockResolvedValue({ status: "ok", opciones: OPCIONES_A_QUIEN, hayMas: false });
  H.fila.mockResolvedValue({ status: "ok", data: { movimientos: [], total: 0, page: 1, pageSize: 10 } });
  H.autoria.mockImplementation(async ({ movimientoIds }: { movimientoIds: string[] }) => ({ status: "ok", filas: movimientoIds.map(() => null).filter(Boolean) }));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R1/R3 — una sola barra, dentro del libro, sin textos de alcance ni «Aplicar»", () => {
  it("R1: el único control de filtros vive en el libro, encima de la tabla; antes de las cifras no hay ninguno", async () => {
    const user = pintar();
    expect(screen.queryByRole("region", { name: "Filtros de toda la wallet" })).toBeNull();
    expect(screen.getAllByRole("searchbox", { name: "Buscar en el libro" })).toHaveLength(1);
    const filtros = within(libro()).getByRole("button", { name: /^Filtros/ });
    expect(antes(ganancia(), filtros)).toBe(true);
    expect(antes(filtros, tabla())).toBe(true);
    const arriba = resumenYAcciones();
    expect(within(arriba).queryByRole("searchbox")).toBeNull();
    expect(within(arriba).queryByRole("combobox")).toBeNull();
    expect(within(arriba).queryByRole("button", { name: /^Filtros|Periodo|^A quién/ })).toBeNull();
    // Con todas las casillas puestas, todos los controles siguen en el libro.
    await ponerCasillas(user, libro(), "Periodo", "A quién", "Entra/Sale", "Concepto");
    expect(within(arriba).queryByRole("button", { name: "Periodo" })).toBeNull();
    expect(periodoBoton()).not.toBeNull();
  });

  it("R3: ni textos de alcance ni «Aplicar» / «Quitar periodo», tampoco con las casillas puestas", async () => {
    const user = pintar();
    await ponerCasillas(user, libro(), "Periodo", "A quién", "Entra/Sale", "Concepto");
    const texto = document.body.textContent ?? "";
    expect(texto).not.toContain("Estos filtros cambian toda la wallet");
    expect(texto).not.toContain("Estos filtros solo afectan al libro de movimientos");
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quitar periodo" })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R2/R4/R9 — el orden de la fila", () => {
  it("R2/R9: orden → Periodo → A quién → Entra/Sale → Concepto → buscador → Filtros → Limpiar todo; Descargar y columnas a continuación", async () => {
    const user = pintar();
    // Se marcan en un orden distinto del de las casillas: los controles salen en el de las casillas (R9).
    await alternarCasillas(user, libro(), "Concepto", "Periodo", "Entra/Sale", "A quién");
    const z = libro();
    const piezas = [
      within(z).getByRole("group", { name: "Ordenar el libro" }),
      within(z).getByRole("button", { name: "Periodo" }),
      within(z).getByRole("button", { name: /^A quién: / }),
      within(z).getByRole("combobox", { name: "Entra/Sale" }),
      within(z).getByRole("combobox", { name: "Concepto" }),
      buscador(),
      within(z).getByRole("button", { name: /^Filtros/ }),
      within(z).getByRole("button", { name: "Limpiar todo" }),
    ];
    for (let i = 1; i < piezas.length; i++) expect(antes(piezas[i - 1], piezas[i])).toBe(true);

    // «Descargar» y el botón de columnas son HERMANOS de la barra en la misma fila de la cabecera, detrás.
    const descargar = within(z).getByRole("button", { name: "Descargar Libro de movimientos" });
    let barra: HTMLElement = buscador();
    while (barra.parentElement !== null && !barra.parentElement.contains(descargar)) barra = barra.parentElement;
    const fila = barra.parentElement as HTMLElement;
    expect(fila.contains(descargar)).toBe(true);
    expect(barra.contains(descargar)).toBe(false);
    expect(antes(barra, descargar)).toBe(true);
    const columnas = within(fila).getByRole("button", { name: /columnas/i });
    expect(antes(descargar, columnas)).toBe(true);
  });

  it("R4: el orden son dos botones de SOLO icono, con su nombre accesible y su texto emergente", () => {
    pintar();
    const orden = within(libro()).getByRole("group", { name: "Ordenar el libro" });
    const botones = within(orden).getAllByRole("button");
    expect(botones.map((b) => b.getAttribute("aria-label"))).toEqual(["Más recientes", "Más antiguas"]);
    for (const b of botones) {
      expect(b.textContent?.trim()).toBe("");
      expect(b.querySelector("svg")).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R6/R8/R11 — las casillas", () => {
  it("R6/R11: «Filtros» ofrece Periodo, A quién, Entra/Sale y Concepto, en ese orden, todas desmarcadas al entrar", async () => {
    const user = pintar();
    const { etiquetas, marcadas } = await casillasOfrecidas(user, libro());
    expect(etiquetas).toEqual(["Periodo", "A quién", "Entra/Sale", "Concepto"]);
    expect(marcadas).toEqual([]);
    // R11: buscador vacío y «Más recientes».
    expect(buscador()).toHaveValue("");
    expect(within(libro()).getByRole("button", { name: "Más recientes" })).toHaveAttribute("aria-pressed", "true");
  });

  it("R8: marcar las cuatro casillas monta sus controles y NO lee nada", async () => {
    const user = pintar();
    await ponerCasillas(user, libro(), "Periodo", "A quién", "Entra/Sale", "Concepto");
    expect(periodoBoton()).not.toBeNull();
    expect(aQuienBoton()).not.toBeNull();
    expect(within(libro()).getByRole("combobox", { name: "Entra/Sale" })).toBeInTheDocument();
    expect(within(libro()).getByRole("combobox", { name: "Concepto" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(H.listar).not.toHaveBeenCalled();
    expect(H.resumen).not.toHaveBeenCalled();
    expect(H.desglose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R10 — desmarcar una casilla con valor quita el filtro, en UNA recarga", () => {
  it("Periodo con valor: 1 lectura de libro y 1 de cifras, sin el periodo", async () => {
    const user = pintar();
    await aplicarPeriodo(user, libro(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    H.listar.mockClear();
    H.resumen.mockClear();
    H.desglose.mockClear();

    await alternarCasillas(user, libro(), "Periodo");
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 700)); // la poda del orquestador no relee
    expect(H.listar).toHaveBeenCalledTimes(1);
    expect(H.resumen).toHaveBeenCalledTimes(1);
    expect(H.listar).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(H.resumen).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it("Concepto con valor (junto a Entra/Sale): 1 lectura de libro y 0 de cifras", async () => {
    const user = pintar();
    await elegirEnBarra(user, libro(), "Entra/Sale", "Sale");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "egreso" })));
    await elegirEnBarra(user, libro(), "Concepto", "Sueldo (3)");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ categoria: "egreso_sueldo" })));
    H.listar.mockClear();

    await alternarCasillas(user, libro(), "Concepto");
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 700));
    expect(H.listar).toHaveBeenCalledTimes(1);
    expect(H.listar).toHaveBeenCalledWith({ tipo: "egreso", page: 1, pageSize: 20 });
    expect(H.resumen).not.toHaveBeenCalled();
  });

  it("la ÚLTIMA casilla con valor (el orquestador se desmonta y ya no emite): igual, 1 lectura", async () => {
    const user = pintar();
    await elegirEnBarra(user, libro(), "Concepto", "Sueldo (3)");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ categoria: "egreso_sueldo" })));
    H.listar.mockClear();

    await alternarCasillas(user, libro(), "Concepto");
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 700));
    expect(H.listar).toHaveBeenCalledTimes(1);
    expect(H.listar).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(within(libro()).queryByRole("combobox", { name: "Concepto" })).toBeNull();
  });

  it("desmarcar una casilla SIN valor no lee nada", async () => {
    const user = pintar();
    await ponerCasillas(user, libro(), "Entra/Sale");
    await alternarCasillas(user, libro(), "Entra/Sale");
    await new Promise((r) => setTimeout(r, 700));
    expect(H.listar).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R12/R13/R16 — qué relee cada filtro", () => {
  it("R12/R16: el Periodo relee cifras y libro desde la página 1; las cifras sin tipo, categoría, término ni orden", async () => {
    const user = pintar();
    // Cada paso espera su lectura antes del siguiente (bajo carga, la espera de 500 ms se alarga).
    await elegirEnBarra(user, libro(), "Entra/Sale", "Sale");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "egreso" })), { timeout: 3000 });
    await elegirEnBarra(user, libro(), "Concepto", "Sueldo (3)");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ categoria: "egreso_sueldo" })), { timeout: 3000 });
    await user.click(within(libro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ sortDir: "asc" })), { timeout: 3000 });
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Juan", tipo: "egreso", categoria: "egreso_sueldo" })), { timeout: 3000 });
    expect(H.resumen).not.toHaveBeenCalled();

    await aplicarPeriodo(user, libro(), 1, 28);
    const periodo = { desde: diaDelMesActual(1), hasta: diaDelMesActual(28) };
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    expect(H.resumen).toHaveBeenCalledWith({ ...periodo, page: 1, pageSize: 20 });
    expect(H.desglose).toHaveBeenCalledWith({ ...periodo, page: 1, pageSize: 20 });
    // (La otra lectura del libro, de una fila, es el conteo de la tarjeta: la wallet sin filtros del libro.)
    expect(H.listar).toHaveBeenCalledWith({ ...periodo, page: 1, pageSize: 1 });
    expect(H.listar).toHaveBeenCalledWith({
      ...periodo,
      tipo: "egreso",
      categoria: "egreso_sueldo",
      q: "Juan",
      sortBy: "fecha",
      sortDir: "asc",
      page: 1,
      pageSize: 20,
    });
    await waitFor(() => expect(ganancia().textContent).toContain(money("-1234.00")));
  });

  it("R12/R18: «A quién» relee cifras y libro con el `valor` del servidor", async () => {
    const user = pintar();
    await elegirAQuien(user, /^Juan Pérez/);
    const esperado = { aQuien: { nombre: "Juan Pérez" }, page: 1, pageSize: 20 };
    await waitFor(() => expect(H.resumen).toHaveBeenCalledWith(esperado));
    expect(H.listar).toHaveBeenCalledWith(esperado);
    expect(H.desglose).toHaveBeenCalledWith(esperado);
  });

  it("R13: Entra/Sale, Concepto, término y orden releen SOLO el libro (página 1) y las cifras ni se piden", async () => {
    const user = pintar();
    await elegirEnBarra(user, libro(), "Entra/Sale", "Entra");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith({ tipo: "ingreso", page: 1, pageSize: 20 }));
    await elegirEnBarra(user, libro(), "Concepto", "Sueldo (3)");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith({ tipo: "ingreso", categoria: "egreso_sueldo", page: 1, pageSize: 20 }));
    await user.click(within(libro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ sortDir: "asc", page: 1 })));
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Juan", page: 1 })), { timeout: 3000 });
    expect(H.resumen).not.toHaveBeenCalled();
    expect(H.desglose).not.toHaveBeenCalled();
    expect(ganancia().textContent).toContain(money("-20000.00"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R17 — el Periodo se aplica solo, sin botón, tras la espera estándar", () => {
  it("un rango de UN día emite a los 500 ms (temporizadores falsos) y no hay «Aplicar»", async () => {
    const user = pintar();
    await ponerCasillas(user, libro(), "Periodo");
    await user.click(periodoBoton() as HTMLElement);
    const cuadricula = (await screen.findAllByRole("grid"))[0];
    const dia12 = within(cuadricula).getByText("12");

    vi.useFakeTimers();
    fireEvent.click(dia12);
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    act(() => vi.advanceTimersByTime(499));
    expect(H.resumen).not.toHaveBeenCalled();
    expect(H.listar).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    const dia = diaDelMesActual(12);
    expect(H.resumen).toHaveBeenCalledTimes(1);
    expect(H.resumen).toHaveBeenCalledWith({ desde: dia, hasta: dia, page: 1, pageSize: 20 });
    expect(H.listar).toHaveBeenCalledWith({ desde: dia, hasta: dia, page: 1, pageSize: 20 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R18/R20/R23 — «A quién» y Concepto", () => {
  it("R18: «A quién» busca en el servidor con el periodo APLICADO", async () => {
    const user = pintar();
    await aplicarPeriodo(user, libro(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await ponerCasillas(user, libro(), "A quién");
    await user.click(aQuienBoton() as HTMLElement);
    const periodo = { desde: diaDelMesActual(1), hasta: diaDelMesActual(28) };
    await waitFor(() => expect(H.quienes).toHaveBeenCalledWith(periodo));
    await user.type(screen.getByRole("combobox", { name: "Buscar a quién" }), "tania");
    await waitFor(() => expect(H.quienes).toHaveBeenLastCalledWith({ ...periodo, busqueda: "tania" }));
  });

  it("R20: Concepto ofrece los conceptos con su número; el elegido sigue ofrecido con 0", async () => {
    const user = pintar();
    await ponerCasillas(user, libro(), "Concepto");
    await user.click(within(libro()).getByRole("combobox", { name: "Concepto" }));
    const lista = await screen.findByRole("listbox");
    expect(within(lista).getAllByRole("option").map((o) => o.textContent)).toEqual(["Sueldo (3)"]);
    await user.click(within(lista).getByRole("option", { name: "Sueldo (3)" }));
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ categoria: "egreso_sueldo" })));

    // Un periodo sin sueldos: el elegido se conserva, con 0.
    H.conceptos.mockResolvedValue({ status: "ok", conceptos: [{ categoria: "ingreso_cobro_tienda", movimientos: 2 }] });
    await aplicarPeriodo(user, libro(), 1, 28);
    await waitFor(() => expect(within(libro()).getByRole("combobox", { name: "Concepto" })).toHaveTextContent("Sueldo (0)"));
  });

  it("R23: cada control dice su nombre DENTRO del disparador y tiene la altura del buscador (h-8)", async () => {
    const user = pintar();
    await ponerCasillas(user, libro(), "Periodo", "A quién", "Entra/Sale", "Concepto");
    expect(textoDelControl(libro(), "Entra/Sale")).toBe("Entra/Sale: Todo");
    expect(textoDelControl(libro(), "Concepto")).toBe("Concepto: Todos");
    expect(aQuienBoton()).toHaveTextContent(/^A quién: Todos$/);
    // La altura: la clase `h-8` del buscador y de cada disparador (la medida real, en la verificación T9).
    const alto = (el: Element) => el.className.split(/\s+/).includes("h-8");
    expect(alto(aQuienBoton() as HTMLElement)).toBe(true);
    expect(alto(within(libro()).getByRole("combobox", { name: "Entra/Sale" }))).toBe(true);
    expect(alto(within(libro()).getByRole("combobox", { name: "Concepto" }))).toBe(true);
    expect(alto(buscador().parentElement as HTMLElement)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R25/R26 — «Limpiar todo»", () => {
  it("R26: con el buscador vacío y sin casillas no aparece; con una casilla (aun vacía), sí", async () => {
    const user = pintar();
    expect(within(libro()).queryByRole("button", { name: "Limpiar todo" })).toBeNull();
    await ponerCasillas(user, libro(), "Entra/Sale");
    expect(within(libro()).getByRole("button", { name: "Limpiar todo" })).toBeInTheDocument();
  });

  it("R25: con Periodo y A quién, vacía todo, desmarca las casillas, conserva el orden y relee cifras y libro UNA vez", async () => {
    const user = pintar();
    await aplicarPeriodo(user, libro(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await elegirAQuien(user, /^Juan Pérez/);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(2));
    await elegirEnBarra(user, libro(), "Entra/Sale", "Sale");
    await user.click(within(libro()).getByRole("button", { name: "Más antiguas" }));
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Juan" })), { timeout: 3000 });
    H.listar.mockClear();
    H.resumen.mockClear();

    await user.click(within(libro()).getByRole("button", { name: "Limpiar todo" }));
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 700));
    expect(H.resumen).toHaveBeenCalledTimes(1);
    expect(H.listar).toHaveBeenCalledTimes(1);
    expect(H.resumen).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(H.listar).toHaveBeenCalledWith({ sortBy: "fecha", sortDir: "asc", page: 1, pageSize: 20 });
    expect(buscador()).toHaveValue("");
    expect(within(libro()).getByRole("button", { name: "Más antiguas" })).toHaveAttribute("aria-pressed", "true");
    expect((await casillasOfrecidas(user, libro())).marcadas).toEqual([]);
    expect(within(libro()).queryByRole("button", { name: "Limpiar todo" })).toBeNull();
  });

  it("R25: sin Periodo ni A quién, solo relee el libro", async () => {
    const user = pintar();
    await elegirEnBarra(user, libro(), "Entra/Sale", "Sale");
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(1));
    await user.click(within(libro()).getByRole("button", { name: "Limpiar todo" }));
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(2));
    expect(H.listar).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(H.resumen).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R27/R28 — lo que filtra se ve, también tras un fallo", () => {
  it("R27/R28: desmarcar Concepto con valor y que la lectura FALLE repone la casilla con su valor; libro y cifras intactos", async () => {
    const user = pintar();
    H.listar.mockResolvedValue(paginaOk([mov(2)], 1));
    await elegirEnBarra(user, libro(), "Concepto", "Sueldo (3)");
    await waitFor(() => {
      expect(within(tabla()).queryByRole("status")).toBeNull();
      expect(within(tabla()).getAllByRole("row").slice(1)).toHaveLength(1);
    });

    H.listar.mockResolvedValue({ status: "validation_error" });
    await alternarCasillas(user, libro(), "Concepto");
    await waitFor(() => expect(H.toastError).toHaveBeenCalledWith("Los filtros no son válidos. Revisá el rango de fechas."));
    // La casilla vuelve, y su control dice el valor que sigue aplicado.
    await waitFor(() => expect(textoDelControl(libro(), "Concepto")).toBe("Concepto: Sueldo (3)"));
    expect((await casillasOfrecidas(user, libro())).marcadas).toEqual(["Concepto"]);
    expect(within(tabla()).getAllByRole("row").slice(1)).toHaveLength(1);
    expect(ganancia().textContent).toContain(money("-20000.00"));
  });

  it("R28: una lectura que LANZA al quitar el Periodo: aviso, cifras y libro intactos, casilla y periodo repuestos", async () => {
    const user = pintar();
    await aplicarPeriodo(user, libro(), 1, 28);
    await waitFor(() => expect(ganancia().textContent).toContain(money("-1234.00")));
    H.resumen.mockRejectedValue(new Error("Failed to fetch"));

    await alternarCasillas(user, libro(), "Periodo");
    await waitFor(() =>
      expect(H.toastError).toHaveBeenCalledWith(
        "No se pudo cargar la caja. Se sigue mostrando lo último que se cargó, con sus filtros.",
      ),
    );
    expect(ganancia().textContent).toContain(money("-1234.00"));
    await waitFor(() => expect(periodoBoton()).not.toBeNull());
    expect(periodoBoton()).not.toHaveTextContent("Cualquier fecha");
  });

  it("R28: un cambio que falla devuelve el control a lo aplicado (Entra/Sale vuelve a «Todo»)", async () => {
    const user = pintar();
    H.listar.mockResolvedValue({ status: "forbidden" });
    await elegirEnBarra(user, libro(), "Entra/Sale", "Sale");
    await waitFor(() => expect(H.toastError).toHaveBeenCalledWith("No tenés permiso para ver la wallet."));
    await waitFor(() => expect(textoDelControl(libro(), "Entra/Sale")).toBe("Entra/Sale: Todo"));
    expect(within(tabla()).getAllByRole("row").slice(1)).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R29 — mientras se lee, nada se deshabilita y solo pinta la última selección", () => {
  it("dos cambios seguidos: se pinta el segundo; ningún control de la barra deshabilitado", async () => {
    const pendientes: Array<(v: unknown) => void> = [];
    H.listar.mockImplementation(() => new Promise((r) => pendientes.push(r)));
    H.resumen.mockImplementation(() => new Promise(() => {}));
    const user = pintar();
    await ponerCasillas(user, libro(), "Periodo", "A quién", "Entra/Sale", "Concepto");
    await elegirEnBarra(user, libro(), "Entra/Sale", "Sale");
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(1));

    // Con la lectura en vuelo, ningún control está deshabilitado.
    const z = libro();
    for (const control of [
      buscador(),
      periodoBoton() as HTMLElement,
      aQuienBoton() as HTMLElement,
      within(z).getByRole("combobox", { name: "Entra/Sale" }),
      within(z).getByRole("button", { name: /^Filtros/ }),
      within(z).getByRole("button", { name: "Más antiguas" }),
      within(z).getByRole("button", { name: "Limpiar todo" }),
    ]) {
      expect(control).toBeEnabled();
      expect(control).not.toHaveAttribute("data-disabled");
    }

    await user.click(within(z).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(2));
    pendientes[1](paginaOk([mov(1), mov(2)], 2));
    pendientes[0](paginaOk(PAGINA, 42));
    await waitFor(() => {
      expect(within(tabla()).getAllByRole("row").slice(1)).toHaveLength(2);
      expect(within(tabla()).getAllByRole("row")[1].textContent).toContain("2026-09-21");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R30/R34 — la entrada", () => {
  it("R30: la URL ni se lee ni marca casillas", async () => {
    H.params = "q=sueldo&periodo=,2026-01-01,2026-01-31&tipo=egreso&categoria=egreso_sueldo&aQuien=x";
    const user = pintar();
    expect(buscador()).toHaveValue("");
    expect((await casillasOfrecidas(user, libro())).marcadas).toEqual([]);
    await new Promise((r) => setTimeout(r, 700));
    expect(H.listar).not.toHaveBeenCalled();
    expect(H.resumen).not.toHaveBeenCalled();
  });

  it("R34: sin tocar la barra, las cifras y la página 1 son las del servidor y no se lee nada", async () => {
    pintar();
    expect(ganancia().textContent).toContain(money("-20000.00"));
    const filas = within(tabla()).getAllByRole("row").slice(1);
    expect(filas).toHaveLength(3);
    expect(filas[0].textContent).toContain("2026-09-23");
    await new Promise((r) => setTimeout(r, 700));
    expect(H.listar).not.toHaveBeenCalled();
    expect(H.resumen).not.toHaveBeenCalled();
    expect(H.desglose).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("467 R31 — la descarga lleva todo lo aplicado", () => {
  it("periodo + A quién + Entra/Sale + Concepto + término + orden viajan al completo, sin paginar", async () => {
    const user = pintar();
    await aplicarPeriodo(user, libro(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await elegirAQuien(user, /^Juan Pérez/);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(2));
    await elegirEnBarra(user, libro(), "Entra/Sale", "Sale");
    await elegirEnBarra(user, libro(), "Concepto", "Sueldo (3)");
    await user.click(within(libro()).getByRole("button", { name: "Más antiguas" }));
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Juan", categoria: "egreso_sueldo" })), { timeout: 3000 });

    await elegirSoloLosMovimientos(user);
    await user.click(screen.getByRole("button", { name: "Descargar Libro de movimientos" }));
    await waitFor(() => expect(H.completo).toHaveBeenCalledTimes(1));
    expect(H.completo).toHaveBeenCalledWith({
      desde: diaDelMesActual(1),
      hasta: diaDelMesActual(28),
      aQuien: { nombre: "Juan Pérez" },
      tipo: "egreso",
      categoria: "egreso_sueldo",
      q: "Juan",
      sortBy: "fecha",
      sortDir: "asc",
    });
  });
});
