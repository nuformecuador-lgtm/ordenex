// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import { aplicarPeriodo, diaDelMesActual, elegirPeriodo } from "@/tests/fixtures/periodo-calendario";

// =================================================================================================
// FICHA 463 (T7) — LA CAJA (`/wallet`) EN DOS ZONAS DE FILTROS
// =================================================================================================
//
// Zona de la WALLET (antes de las cifras): periodo con «Aplicar» y «A quién». Mueve resumen,
//   composición, desglose y libro (R3, R8, R15–R20).
// Zona del LIBRO (encima de la tabla): buscador canónico, orden, Todo/Entra/Sale y categoría. Relee
//   SOLO el libro; las cifras ni se piden ni cambian (R5, R9, R12, R29–R35).
// La descarga lleva las dos zonas, el término y el orden (R42). Si una lectura falla, la pantalla se
//   queda con lo que tenía (R49).
//
// Los literales de las zonas y del orden se escriben A MANO (contrato, R2/R33).
// =================================================================================================

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
  listarMovimientosCompletoAction: (...a: unknown[]) => H.completo(...a),
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
// R31: la URL trae un término y un periodo; ninguna de las dos zonas debe leerlos.
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
import {
  FILTROS_LIBRO_INICIALES,
  inputDeLibro,
  inputDeWallet,
} from "@/app/(app)/wallet/_components/wallet-filtros-input";

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
const BUSCADO = [mov(2, { descripcion: "Sueldo de Juan" })];

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

const zonaWallet = () => screen.getByRole("region", { name: "Filtros de toda la wallet" });
const zonaLibro = () => screen.getByRole("region", { name: "Filtros del libro de movimientos" });
const buscador = () => screen.getByRole("searchbox", { name: "Buscar en el libro" });
const ganancia = () => screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.ganancia });
const tabla = () => screen.getByRole("table", { name: "Libro de movimientos" });

function paginaOk(movimientos: WalletMovimientoDTO[], total = movimientos.length) {
  return { status: "ok", data: { movimientos, total, page: 1, pageSize: 20 } };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.params = "";
  H.listar.mockResolvedValue(paginaOk(PAGINA, 42));
  H.completo.mockResolvedValue({ status: "ok", items: PAGINA, total: PAGINA.length });
  H.resumen.mockResolvedValue({ status: "ok", resumen: RESUMEN_PERIODO, composicion: COMPOSICION });
  H.desglose.mockResolvedValue({ status: "ok", desglose: DESGLOSE });
  H.conceptos.mockResolvedValue({ status: "ok", conceptos: [{ categoria: "egreso_sueldo", movimientos: 3 }] });
  H.quienes.mockResolvedValue({ status: "ok", opciones: [], hayMas: false });
  H.fila.mockResolvedValue({ status: "ok", data: { movimientos: [], total: 0, page: 1, pageSize: 10 } });
  H.autoria.mockImplementation(async ({ movimientoIds }: { movimientoIds: string[] }) => ({ status: "ok", filas: movimientoIds.map(() => null).filter(Boolean) }));
});

afterEach(() => cleanup());

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R1/R2/R3/R5 — dos zonas con nombre, alcance y sus controles", () => {
  it("la zona de la wallet va ANTES de las cifras; la del libro, dentro del libro y encima de la tabla", () => {
    pintar();
    const wallet = zonaWallet();
    const libro = zonaLibro();
    // Orden en el documento: zona de la wallet → tarjeta de la ganancia → zona del libro → tabla.
    expect(wallet.compareDocumentPosition(ganancia()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ganancia().compareDocumentPosition(libro) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(libro.compareDocumentPosition(tabla()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const seccionLibro = screen.getByRole("region", { name: "Libro de movimientos" });
    expect(seccionLibro).toContainElement(libro);
  });

  it("R2: cada zona dice su alcance", () => {
    pintar();
    expect(within(zonaWallet()).getByText("Estos filtros cambian toda la wallet")).toBeInTheDocument();
    expect(within(zonaLibro()).getByText("Estos filtros solo afectan al libro de movimientos")).toBeInTheDocument();
  });

  it("R3: la zona de la wallet tiene el periodo y «A quién», y nada más", () => {
    pintar();
    const z = zonaWallet();
    expect(within(z).getByRole("button", { name: "Periodo" })).toBeInTheDocument();
    expect(within(z).getByRole("button", { name: /^A quién: / })).toBeInTheDocument();
    expect(within(z).getByRole("button", { name: "Aplicar" })).toBeInTheDocument();
    expect(within(z).queryByRole("searchbox")).toBeNull();
    expect(within(z).queryByRole("group", { name: "Filtrar por dirección del dinero" })).toBeNull();
    expect(within(z).queryByRole("combobox", { name: "Filtrar por categoría" })).toBeNull();
    expect(within(z).queryByRole("group", { name: "Ordenar el libro" })).toBeNull();
  });

  it("R5/R23/R33: la zona del libro tiene buscador, orden (a la vista, con texto), Todo/Entra/Sale y categoría", () => {
    pintar();
    const z = zonaLibro();
    expect(within(z).getByRole("searchbox", { name: "Buscar en el libro" })).toHaveAttribute(
      "placeholder",
      "Buscar por descripción, nombre o referencia anotada, o quién registró",
    );
    const orden = within(z).getByRole("group", { name: "Ordenar el libro" });
    expect(within(orden).getAllByRole("button").map((b) => b.textContent)).toEqual(["Más recientes", "Más antiguas"]);
    expect(within(z).getByRole("group", { name: "Filtrar por dirección del dinero" })).toBeInTheDocument();
    expect(within(z).getByRole("combobox", { name: "Filtrar por categoría" })).toBeInTheDocument();
    expect(within(z).queryByRole("button", { name: "Periodo" })).toBeNull();
    expect(within(z).queryByRole("button", { name: /^A quién: / })).toBeNull();
  });

  it("R34/R46: se entra en «Más recientes» y sin leer nada (lo pintado es lo del servidor)", () => {
    pintar();
    const orden = within(zonaLibro()).getByRole("group", { name: "Ordenar el libro" });
    expect(within(orden).getByRole("button", { name: "Más recientes" })).toHaveAttribute("aria-pressed", "true");
    expect(within(orden).getByRole("button", { name: "Más antiguas" })).toHaveAttribute("aria-pressed", "false");
    expect(H.listar).not.toHaveBeenCalled();
    expect(H.resumen).not.toHaveBeenCalled();
    expect(ganancia().textContent).toContain(money("-20000.00"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R8/R12/R15/R16/R19 — la zona de la wallet relee TODO, con «Aplicar»", () => {
  it("R15: editar el periodo no lee nada; R16: «Aplicar» relee las tres cosas UNA vez, desde la página 1", async () => {
    const user = pintar();
    await elegirPeriodo(user, zonaWallet(), 1, 28);
    expect(H.listar).not.toHaveBeenCalled();
    expect(H.resumen).not.toHaveBeenCalled();
    expect(H.desglose).not.toHaveBeenCalled();

    await user.click(within(zonaWallet()).getByRole("button", { name: "Aplicar" }));
    const periodo = { desde: diaDelMesActual(1), hasta: diaDelMesActual(28) };
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    expect(H.listar).toHaveBeenCalledTimes(1);
    expect(H.listar).toHaveBeenCalledWith({ ...periodo, page: 1, pageSize: 20 });
    expect(H.resumen).toHaveBeenCalledWith({ ...periodo, page: 1, pageSize: 20 });
    expect(H.desglose).toHaveBeenCalledWith({ ...periodo, page: 1, pageSize: 20 });
    await waitFor(() => expect(ganancia().textContent).toContain(money("-1234.00")));
  });

  it("R17: con el periodo aplicado y sin editar, «Aplicar» está deshabilitado", async () => {
    const user = pintar();
    const aplicar = () => within(zonaWallet()).getByRole("button", { name: "Aplicar" });
    expect(aplicar()).toBeDisabled();
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(aplicar()).toBeDisabled());
  });

  it("R19: «Quitar periodo» vuelve a la wallet sin periodo y CONSERVA el término, los filtros y el orden del libro", async () => {
    const user = pintar();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Sale" }));
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Juan" })), { timeout: 3000 });
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    H.listar.mockClear();
    H.resumen.mockClear();

    await user.click(await within(zonaWallet()).findByRole("button", { name: "Quitar periodo" }));
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    expect(H.resumen).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(H.listar).toHaveBeenCalledWith({ tipo: "egreso", q: "Juan", sortBy: "fecha", sortDir: "asc", page: 1, pageSize: 20 });
  });

  it("R12: el resumen y el desglose NUNCA reciben tipo, categoría, término ni orden", async () => {
    const user = pintar();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Entra" }));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await user.type(buscador(), "Sueldo");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Sueldo" })), { timeout: 3000 });
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    for (const llamada of [...H.resumen.mock.calls, ...H.desglose.mock.calls]) {
      const input = llamada[0] as Record<string, unknown>;
      for (const clave of ["tipo", "categoria", "q", "sortBy", "sortDir"]) expect(input).not.toHaveProperty(clave);
    }
    // Y la traducción, sola: la zona de la wallet no deja pasar nada del libro.
    expect(inputDeWallet({ desde: "2026-09-01", hasta: "" })).toEqual({ desde: "2026-09-01" });
  });

  it("R13: las opciones de la categoría se piden con el periodo APLICADO y la dirección vigente", async () => {
    const user = pintar();
    await waitFor(() => expect(H.conceptos).toHaveBeenCalledWith({ libro: "caja" }));
    await elegirPeriodo(user, zonaWallet(), 1, 28);
    // Editar el periodo (sin aplicar) no cambia las opciones de la categoría.
    expect(H.conceptos).not.toHaveBeenCalledWith(expect.objectContaining({ desde: diaDelMesActual(1) }));
    await user.click(within(zonaWallet()).getByRole("button", { name: "Aplicar" }));
    await waitFor(() =>
      expect(H.conceptos).toHaveBeenCalledWith({ libro: "caja", desde: diaDelMesActual(1), hasta: diaDelMesActual(28) }),
    );
    await user.click(within(zonaLibro()).getByRole("button", { name: "Sale" }));
    await waitFor(() =>
      expect(H.conceptos).toHaveBeenCalledWith({
        libro: "caja",
        tipo: "egreso",
        desde: diaDelMesActual(1),
        hasta: diaDelMesActual(28),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R9/R29/R35 — la zona del libro relee SOLO el libro, desde la página 1", () => {
  it("R9: término, Entra/Sale, categoría y orden ⇒ solo `listarMovimientosAction`; las cifras ni se piden ni cambian", async () => {
    const user = pintar();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(1));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Sale" }));
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(2));
    await user.click(within(zonaLibro()).getByRole("combobox", { name: "Filtrar por categoría" }));
    await user.click(await screen.findByRole("option", { name: "Sueldo (3)" }));
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(3));
    H.listar.mockResolvedValue(paginaOk(BUSCADO, 1));
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(4), { timeout: 3000 });

    expect(H.listar).toHaveBeenLastCalledWith({
      tipo: "egreso",
      categoria: "egreso_sueldo",
      q: "Juan",
      sortBy: "fecha",
      sortDir: "asc",
      page: 1,
      pageSize: 20,
    });
    expect(H.resumen).not.toHaveBeenCalled();
    expect(H.desglose).not.toHaveBeenCalled();
    // Las cifras siguen siendo las de la entrada, y el conteo de la tarjeta, el de la wallet (42).
    expect(ganancia().textContent).toContain(money("-20000.00"));
    const principal = screen.getByRole("region", { name: "Resumen de la caja y acciones" });
    expect(principal.textContent).toMatch(new RegExp(`${CAJA_RESUMEN_LABEL.movimientos}\\D*42`));
    // El libro sí cambió.
    await waitFor(() => {
      expect(within(tabla()).getAllByRole("row").slice(1)).toHaveLength(1);
      expect(within(tabla()).getAllByRole("row")[1].textContent).toContain("2026-09-22");
    });
  });

  it("R24: por debajo de 3 caracteres no se lee y el campo avisa cuántos faltan", async () => {
    const user = pintar();
    await user.type(buscador(), "Ju");
    expect(await within(zonaLibro()).findByText("Escribe al menos 3 caracteres para buscar")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(H.listar).not.toHaveBeenCalled();
  });

  it("R29: cambiar un filtro del libro estando en la página 2 vuelve a la página 1", async () => {
    const user = pintar();
    H.listar.mockResolvedValueOnce({ status: "ok", data: { movimientos: PAGINA, total: 42, page: 2, pageSize: 20 } });
    await user.click(within(screen.getByRole("navigation", { name: "Paginación del libro" })).getByRole("button", { name: /siguiente/i }));
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 }));
    // La página no relee las cifras (son de la wallet entera).
    expect(H.resumen).not.toHaveBeenCalled();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Entra" }));
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith({ tipo: "ingreso", page: 1, pageSize: 20 }));
  });

  it("R35: el orden se pide al SERVIDOR (página 1 del conjunto entero en ese orden), no se reordena la página", async () => {
    const user = pintar();
    const antiguas = [mov(1), mov(2), mov(3)];
    H.listar.mockResolvedValue(paginaOk(antiguas, 42));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() =>
      expect(H.listar).toHaveBeenCalledWith({ sortBy: "fecha", sortDir: "asc", page: 1, pageSize: 20 }),
    );
    // Se pinta lo que manda el servidor, tal cual: primera fila = la primera del servidor.
    await waitFor(() => {
      const filas = within(tabla()).getAllByRole("row").slice(1);
      expect(filas[0].textContent).toContain("2026-09-21");
    });
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más recientes" }));
    // «Más recientes» es el de por defecto: no viaja.
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }));
  });

  it("R30: «Limpiar todo» quita término, dirección y categoría; NO toca el periodo, «A quién» ni el orden", async () => {
    const user = pintar();
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Sale" }));
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Juan" })), { timeout: 3000 });
    H.resumen.mockClear();

    await user.click(within(zonaLibro()).getByRole("button", { name: "Limpiar todo" }));
    await waitFor(() =>
      expect(H.listar).toHaveBeenLastCalledWith({
        desde: diaDelMesActual(1),
        hasta: diaDelMesActual(28),
        sortBy: "fecha",
        sortDir: "asc",
        page: 1,
        pageSize: 20,
      }),
    );
    expect(buscador()).toHaveValue("");
    expect(within(zonaLibro()).getByRole("button", { name: "Más antiguas" })).toHaveAttribute("aria-pressed", "true");
    expect(within(zonaLibro()).getByRole("button", { name: "Todo" })).toHaveAttribute("aria-pressed", "true");
    expect(H.resumen).not.toHaveBeenCalled();
  });

  it("R32: mientras se lee el libro, el buscador NO se deshabilita", async () => {
    let soltar: (v: unknown) => void = () => {};
    H.listar.mockImplementation(() => new Promise((r) => (soltar = r)));
    const user = pintar();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Sale" }));
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(1));
    expect(buscador()).toBeEnabled();
    await user.type(buscador(), "abc");
    expect(buscador()).toHaveValue("abc");
    soltar(paginaOk(PAGINA, 42));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R31 — ninguna zona lee filtros de la URL", () => {
  it("entrar con `?q=` y un periodo en la dirección no filtra nada ni rellena los controles", async () => {
    H.params = "q=sueldo&periodo=,2026-01-01,2026-01-31&tipo=egreso";
    pintar();
    expect(buscador()).toHaveValue("");
    expect(within(zonaWallet()).getByRole("button", { name: "Periodo" })).toHaveTextContent("Cualquier fecha");
    await new Promise((r) => setTimeout(r, 700));
    expect(H.listar).not.toHaveBeenCalled();
    expect(H.resumen).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R42 — la descarga lleva las dos zonas, el término y el orden", () => {
  it("periodo + dirección + término + «Más antiguas» viajan al completo, sin paginar", async () => {
    const user = pintar();
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Sale" }));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Juan" })), { timeout: 3000 });

    await user.click(screen.getByRole("button", { name: "Descargar Libro de movimientos" }));
    await waitFor(() => expect(H.completo).toHaveBeenCalledTimes(1));
    expect(H.completo).toHaveBeenCalledWith({
      desde: diaDelMesActual(1),
      hasta: diaDelMesActual(28),
      tipo: "egreso",
      q: "Juan",
      sortBy: "fecha",
      sortDir: "asc",
    });
  });

  it("`inputDeLibro`: el término por debajo del mínimo y el orden por defecto NO viajan", () => {
    expect(inputDeLibro({ desde: "", hasta: "" }, FILTROS_LIBRO_INICIALES)).toEqual({});
    expect(inputDeLibro({ desde: "", hasta: "" }, { ...FILTROS_LIBRO_INICIALES, termino: "ab" })).toEqual({});
    expect(inputDeLibro({ desde: "", hasta: "" }, { ...FILTROS_LIBRO_INICIALES, termino: " abc " })).toEqual({ q: "abc" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R49 — si una lectura falla, la pantalla se queda con lo que tenía", () => {
  it("falla el libro: aviso en español, mismo libro, mismo orden y las cifras intactas", async () => {
    const user = pintar();
    H.listar.mockResolvedValue({ status: "validation_error" });
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.toastError).toHaveBeenCalledWith("Los filtros no son válidos. Revisá el rango de fechas."));
    expect(within(zonaLibro()).getByRole("button", { name: "Más recientes" })).toHaveAttribute("aria-pressed", "true");
    expect(within(tabla()).getAllByRole("row")[1].textContent).toContain("2026-09-23");
    expect(ganancia().textContent).toContain(money("-20000.00"));
  });

  it("falla la wallet al aplicar un periodo: cifras y libro intactos y el control vuelve a «Cualquier fecha»", async () => {
    const user = pintar();
    H.resumen.mockResolvedValue({ status: "forbidden" });
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.toastError).toHaveBeenCalledWith("No tenés permiso para ver la wallet."));
    expect(ganancia().textContent).toContain(money("-20000.00"));
    await waitFor(() =>
      expect(within(zonaWallet()).getByRole("button", { name: "Periodo" })).toHaveTextContent("Cualquier fecha"),
    );
    expect(within(zonaWallet()).queryByRole("button", { name: "Quitar periodo" })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 R12 (revisión B2) — el detalle de una fila de la composición es de la WALLET", () => {
  it("con Entra/Sale y categoría puestas en el libro, el detalle de la fila recibe solo fila, periodo y página", async () => {
    const user = pintar();
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Sale" }));
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "egreso" })));
    await user.click(within(zonaLibro()).getByRole("combobox", { name: "Filtrar por categoría" }));
    await user.click(await screen.findByRole("option", { name: "Sueldo (3)" }));
    await waitFor(() =>
      expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "egreso", categoria: "egreso_sueldo" })),
    );
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ sortDir: "asc" })));

    await user.click(screen.getByRole("button", { name: "Ver los movimientos de Pagos de Ordenex a mensajeros" }));
    await waitFor(() => expect(H.fila).toHaveBeenCalledTimes(1));

    // El conjunto del detalle es el del importe de esa fila: el periodo de la wallet y nada del libro.
    expect(H.fila).toHaveBeenCalledWith({
      fila: "egreso_pago_mensajero",
      desde: diaDelMesActual(1),
      hasta: diaDelMesActual(28),
      page: 1,
    });
    const input = H.fila.mock.calls[0][0] as Record<string, unknown>;
    for (const clave of ["tipo", "categoria", "q", "sortBy", "sortDir"]) expect(input).not.toHaveProperty(clave);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("463 (revisión m1) — los conmutadores del libro no se tragan un clic mientras se lee", () => {
  it("pulsar «Más antiguas» con una lectura del libro en vuelo se pide y es lo que queda pintado", async () => {
    const pendientes: Array<(v: unknown) => void> = [];
    H.listar.mockImplementation(() => new Promise((r) => pendientes.push(r)));
    const user = pintar();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Sale" }));
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(1));

    // Con «Sale» todavía en vuelo: el clic NO se ignora; se pide el libro con los dos cambios.
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.listar).toHaveBeenCalledTimes(2));
    expect(H.listar).toHaveBeenLastCalledWith({ tipo: "egreso", sortBy: "fecha", sortDir: "asc", page: 1, pageSize: 20 });

    // Llega antes la segunda y después la primera, ya vieja: manda la última pedida.
    pendientes[1](paginaOk([mov(1), mov(2)], 2));
    pendientes[0](paginaOk(PAGINA, 42));
    await waitFor(() =>
      expect(within(zonaLibro()).getByRole("button", { name: "Más antiguas" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(within(zonaLibro()).getByRole("button", { name: "Sale" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(within(tabla()).getAllByRole("row").slice(1)).toHaveLength(2);
      expect(within(tabla()).getAllByRole("row")[1].textContent).toContain("2026-09-21");
    });
  });
});
