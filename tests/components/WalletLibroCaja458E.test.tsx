// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
import type { DocumentoCajaDTO, WalletMovimientoDTO } from "@/lib/types/wallet";
import type { RechazoTiendaCobroDTO } from "@/lib/types/rechazo-tienda-cobro";

// =================================================================================================
// FICHA 458-E — EL LIBRO DE CAJA (`/wallet`; maqueta, pantalla 3)
// =================================================================================================
//
// T E.1 (R55–R57): las columnas Fecha · Movimiento y motivo · A quién · Monto (dirección + dueño) ·
//   Registró · Ver; «A quién» y «Registró» leídos EN LOTE por el módulo (`autoriaDelLibroCajaAction`
//   con los ids de la página) y pintados con nombres, nunca ids; la fila anulada dice «Anulado» Y
//   sale tachada (457 R41, 459 R66, 461 R20/R71).
// T E.2 (R53, R54): Todo / Entra / Sale se aplica al pulsarlo y viaja como el `tipo` de siempre a las
//   TRES lecturas (libro, tarjetas + composición, desglose); las tarjetas pintan el resumen del
//   conjunto filtrado; el concepto se pide con la dirección y el periodo del borrador.
// T E.3 (R60): anular desde el panel «Ver» relee libro, tarjetas, composición y desglose con los
//   filtros VIGENTES.
// T E.4 (R61, R73): la cola de cobros por rechazo no ofrece el cobro anulado; su línea del libro dice
//   «Anulado» y su panel, en palabras, que la ganancia bajó y que no se vuelve a ofrecer.

// ── Dobles de las lecturas y escrituras que el módulo y sus piezas importan ──

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
const colaRechazoMock = vi.fn();
vi.mock("@/lib/actions/rechazo-tienda-cobro", () => ({
  listarCobrosRechazoTiendaAction: (...a: unknown[]) => colaRechazoMock(...a),
  aprobarCobroRechazoTiendaAction: vi.fn(),
  rechazarCobroRechazoTiendaAction: vi.fn(),
}));
const autoriaMock = vi.fn();
vi.mock("@/lib/actions/libro-caja-autoria", () => ({
  autoriaDelLibroCajaAction: (...a: unknown[]) => autoriaMock(...a),
}));
const conceptosMock = vi.fn();
vi.mock("@/lib/actions/wallet-filtros", () => ({
  conceptosConMovimientosAction: (...a: unknown[]) => conceptosMock(...a),
  cierresDeLaCuentaAction: vi.fn(),
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

import { WalletLedger, type AutoriaDelLibro } from "@/app/(app)/wallet/_components/WalletLedger";
import { WalletModule } from "@/app/(app)/wallet/_components/WalletModule";
import { CAJA_RESUMEN_LABEL, money } from "@/app/(app)/wallet/_components/wallet-labels";
import { COBRO_RECHAZO_TEXTO } from "@/components/shared/wallet/detalle-movimiento-panel-labels";

// ── Datos ──

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let n = 0;
function uuid(): string {
  n += 1;
  return `0000000${n % 10}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function fila(over: Partial<WalletMovimientoDTO>): WalletMovimientoDTO {
  return {
    id: uuid(),
    tipo: "egreso",
    categoria: "egreso_sueldo",
    monto: "25000.00",
    origenTipo: "gasto",
    origenId: null,
    descripcion: "Sueldo de septiembre",
    registradoPor: uuid(),
    fechaMovimiento: "2026-09-20T15:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  };
}

function doc(tipo: DocumentoCajaDTO["tipo"], extra: Partial<DocumentoCajaDTO> = {}): DocumentoCajaDTO {
  return { tipo, anulado: false, tieneComprobante: false, ...extra };
}

const SUELDO = fila({ documento: doc("egreso_caja") });
const COBRO = fila({
  tipo: "ingreso",
  categoria: "ingreso_cobro_tienda",
  origenTipo: "cobro_tienda",
  origenId: uuid(),
  monto: "5000.00",
  descripcion: "Material de despacho",
  documento: doc("cobro_tienda"),
});
const DEL_CIERRE = fila({
  tipo: "ingreso",
  categoria: "ingreso_cod_recaudado",
  origenTipo: "cierre_dia",
  origenId: uuid(),
  monto: "10000.00",
  descripcion: null,
  registradoPor: null,
  dueno: "terceros",
});
const APORTE = fila({
  tipo: "ingreso",
  categoria: "ingreso_aporte_capital",
  origenTipo: "aporte_capital",
  origenId: uuid(),
  monto: "3000.00",
  dueno: "capital",
  documento: doc("aporte_capital"),
});
const ANULADO = fila({ categoria: "egreso_gasto_variable", monto: "999.00", documento: doc("egreso_caja", { anulado: true }) });
const ANULADO_SIN_MOTIVO = fila({
  categoria: "egreso_gasto_variable",
  monto: "888.00",
  documento: doc("egreso_caja", { anulado: true, motivoNoRegistrado: true }),
});

const TIENDA_ID = uuid();
const MENSAJERO_ID = uuid();

/** La autoría que el SERVIDOR resolvería para cada fila (design §3.4). */
const AUTORIA: Record<string, Omit<AutoriaDeFilaDTO, "movimientoId">> = {
  [SUELDO.id]: {
    aQuien: { nombre: "Juan Pérez", beneficiario: null, cuenta: null, esOrdenex: false },
    registro: { nombre: "Ana Maestra", automatico: null },
  },
  [COBRO.id]: {
    aQuien: { nombre: "Tania Tienda", beneficiario: null, cuenta: { tipo: "tienda", id: TIENDA_ID }, esOrdenex: false },
    registro: { nombre: "Ana Maestra", automatico: null },
  },
  [DEL_CIERRE.id]: {
    aQuien: { nombre: "Mario Mensajero", beneficiario: null, cuenta: { tipo: "mensajero", id: MENSAJERO_ID }, esOrdenex: false },
    registro: { nombre: null, automatico: { accion: "aprobacion_cierre", por: "Ana Maestra" } },
  },
  [APORTE.id]: {
    aQuien: { nombre: null, beneficiario: null, cuenta: null, esOrdenex: true },
    registro: { nombre: "Ana Maestra", automatico: null },
  },
  [ANULADO.id]: {
    aQuien: { nombre: null, beneficiario: null, cuenta: null, esOrdenex: false },
    registro: { nombre: null, automatico: { accion: "plantilla_gasto_fijo", por: null } },
  },
  [ANULADO_SIN_MOTIVO.id]: {
    aQuien: { nombre: "Proveedor Uno", beneficiario: null, cuenta: null, esOrdenex: false },
    registro: { nombre: "Ana Maestra", automatico: null },
  },
};

function autoriaOk(filas: WalletMovimientoDTO[]): AutoriaDelLibro {
  return {
    estado: "ok",
    porMovimiento: new Map(filas.map((m) => [m.id, { movimientoId: m.id, ...AUTORIA[m.id] }])),
  };
}

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
/** El resumen del conjunto FILTRADO («Entra»): otras cifras, para que ninguna aserción acierte por casualidad. */
const RESUMEN_ENTRA = { ...RESUMEN, salidas: "0.00", ganancia: "5000.00", signoGanancia: "positivo" as const, periodoFiltrado: true };
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

const PAGINA = [SUELDO, COBRO, DEL_CIERRE, APORTE];

function Envoltura({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}

function pintarModulo(
  movimientos: WalletMovimientoDTO[] = PAGINA,
  cobrosRechazoTienda: { items: RechazoTiendaCobroDTO[]; total: number } = { items: [], total: 0 },
) {
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
        cobrosRechazoTienda={cobrosRechazoTienda}
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

/** Las celdas de la fila del movimiento `m` (en el orden de `filas`), por encabezado. */
function celdasDe(filas: WalletMovimientoDTO[], m: WalletMovimientoDTO): Record<string, HTMLElement> {
  const t = tabla();
  const encabezados = within(t).getAllByRole("columnheader").map((c) => c.textContent ?? "");
  const fila = within(t).getAllByRole("row").slice(1)[filas.indexOf(m)];
  const celdas = within(fila).getAllByRole("cell");
  return Object.fromEntries(encabezados.map((h, i) => [h, celdas[i]]));
}

beforeEach(() => {
  vi.clearAllMocks();
  listarMock.mockResolvedValue({ status: "ok", data: { movimientos: PAGINA, total: PAGINA.length, page: 1, pageSize: 20 } });
  resumenMock.mockResolvedValue({ status: "ok", resumen: RESUMEN, composicion: COMPOSICION });
  desgloseMock.mockResolvedValue({ status: "ok", desglose: DESGLOSE });
  completoMock.mockResolvedValue({ status: "ok", items: PAGINA, total: PAGINA.length });
  conceptosMock.mockResolvedValue({ status: "ok", conceptos: [{ categoria: "ingreso_cobro_tienda", movimientos: 1 }] });
  colaRechazoMock.mockResolvedValue({ status: "ok", items: [], total: 0 });
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
describe("458-E T E.1 — las columnas del libro (R55–R57)", () => {
  const FILAS = [SUELDO, COBRO, DEL_CIERRE, APORTE, ANULADO, ANULADO_SIN_MOTIVO];

  function pintarLibro(autoria: AutoriaDelLibro = autoriaOk(FILAS)) {
    render(
      <Envoltura>
        <WalletLedger movimientos={FILAS} autoria={autoria} />
      </Envoltura>,
    );
  }

  it("R55: Fecha · Movimiento y motivo · A quién · Monto · Registró · Ver, en ese orden", () => {
    pintarLibro();
    const encabezados = within(tabla()).getAllByRole("columnheader").map((c) => c.textContent);
    expect(encabezados).toEqual(["Desglose", "Fecha", "Movimiento y motivo", "A quién", "Monto", "Registró", "Ver"]);
  });

  it("R55: «Movimiento y motivo» dice el concepto desde Ordenex, el origen con su entidad y el motivo", () => {
    pintarLibro();
    const cobro = celdasDe(FILAS, COBRO)["Movimiento y motivo"];
    expect(within(cobro).getByText("Ordenex le cobra a una tienda")).toBeInTheDocument();
    expect(cobro.textContent).toContain("Material de despacho");
    const sueldo = celdasDe(FILAS, SUELDO)["Movimiento y motivo"];
    expect(within(sueldo).getByText("Sueldo")).toBeInTheDocument();
    expect(sueldo.textContent).toContain("Sueldo de septiembre");
  });

  it("R55: «Monto» dice la dirección (Entra / Sale), el importe del servidor y el dueño", () => {
    pintarLibro();
    const sueldo = celdasDe(FILAS, SUELDO).Monto;
    expect(within(sueldo).getByText("Sale")).toBeInTheDocument();
    expect(within(sueldo).getByText(money("25000.00"))).toBeInTheDocument();
    expect(sueldo.querySelector("[data-dueno]")?.textContent).toBe("Ordenex");

    const cierre = celdasDe(FILAS, DEL_CIERRE).Monto;
    expect(within(cierre).getByText("Entra")).toBeInTheDocument();
    expect(cierre.querySelector("[data-dueno]")?.textContent).toBe("Tienda");

    expect(celdasDe(FILAS, APORTE).Monto.querySelector("[data-dueno]")?.textContent).toBe("Ordenex (capital)");
  });

  it("R56: «A quién» nombra la cuenta y enlaza su estado de cuenta; «Ordenex» en el aporte; «—» sin anotación", () => {
    pintarLibro();
    const aQuien = (m: WalletMovimientoDTO) => celdasDe(FILAS, m)["A quién"];

    expect(aQuien(SUELDO).textContent).toBe("Juan Pérez");
    expect(within(aQuien(SUELDO)).queryByRole("link")).toBeNull();

    const tienda = within(aQuien(COBRO)).getByRole("link");
    expect(tienda.getAttribute("href")).toBe(`/wallet/tiendas/${TIENDA_ID}`);
    // «Label in Name»: el nombre accesible EMPIEZA por lo que se ve.
    expect(tienda).toHaveAccessibleName("Tania Tienda · estado de cuenta de la tienda");

    const mensajero = within(aQuien(DEL_CIERRE)).getByRole("link");
    expect(mensajero.getAttribute("href")).toBe(`/wallet/mensajeros/${MENSAJERO_ID}`);
    expect(mensajero).toHaveAccessibleName("Mario Mensajero · estado de cuenta del mensajero");

    expect(aQuien(APORTE).textContent).toBe("Ordenex");
    expect(aQuien(ANULADO).textContent).toBe("—");
  });

  it("R57: «Registró» dice la persona o «Automático · <acción> por <quién>»", () => {
    pintarLibro();
    expect(celdasDe(FILAS, SUELDO)["Registró"].textContent).toBe("Ana Maestra");
    expect(celdasDe(FILAS, DEL_CIERRE)["Registró"].textContent).toBe("Automático · Aprobación del cierre por Ana Maestra");
    expect(celdasDe(FILAS, ANULADO)["Registró"].textContent).toBe("Automático · Plantilla de gasto fijo");
  });

  it("R56/R57: mientras se lee dice «Cargando…» y, si la lectura falla, «No se pudo leer» (nunca «—»)", () => {
    pintarLibro({ estado: "cargando" });
    expect(celdasDe(FILAS, SUELDO)["A quién"].textContent).toBe("Cargando…");
    expect(celdasDe(FILAS, SUELDO)["Registró"].textContent).toBe("Cargando…");
    cleanup();
    pintarLibro({ estado: "error" });
    expect(celdasDe(FILAS, SUELDO)["A quién"].textContent).toBe("No se pudo leer");
    expect(celdasDe(FILAS, SUELDO)["Registró"].textContent).toBe("No se pudo leer");
  });

  it("R71/R72: la fila anulada DICE «Anulado» y sale tachada; la de antes de la 458, «motivo no registrado»", () => {
    pintarLibro();
    const filas = within(tabla()).getAllByRole("row").slice(1);
    const anulada = filas[FILAS.indexOf(ANULADO)];
    expect(within(anulada).getByText("Anulado")).toBeInTheDocument();
    expect(anulada.className).toContain("line-through");
    const sinMotivo = filas[FILAS.indexOf(ANULADO_SIN_MOTIVO)];
    expect(within(sinMotivo).getByText("Anulado · motivo no registrado")).toBeInTheDocument();
    expect(sinMotivo.className).toContain("line-through");
    // Control: una vigente ni lo dice ni se tacha.
    const vigente = filas[FILAS.indexOf(SUELDO)];
    expect(within(vigente).queryByText(/^Anulado/)).toBeNull();
    expect(vigente.className).not.toContain("line-through");
  });

  it("H6/R3: ningún identificador en el texto, los nombres accesibles ni los títulos de la tabla", () => {
    pintarLibro();
    const t = tabla();
    expect(t.textContent ?? "").not.toMatch(UUID);
    for (const el of t.querySelectorAll("*")) {
      for (const atributo of ["aria-label", "title", "placeholder"]) {
        expect(el.getAttribute(atributo) ?? "", atributo).not.toMatch(UUID);
      }
    }
    // Control de no-vacuidad: los ids SÍ están en los datos (y en los `href`, que es donde deben).
    expect(COBRO.id).toMatch(UUID);
    expect(within(t).getAllByRole("link").some((a) => UUID.test(a.getAttribute("href") ?? ""))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("458-E T E.1 — el módulo lee la autoría de la página (R56/R57)", () => {
  it("UNA lectura con los ids de la página y los nombres en las celdas", async () => {
    pintarModulo();
    await waitFor(() => expect(celdasDe(PAGINA, COBRO)["A quién"].textContent).toBe("Tania Tienda"));
    expect(autoriaMock).toHaveBeenCalledTimes(1);
    expect(autoriaMock).toHaveBeenCalledWith({ movimientoIds: PAGINA.map((m) => m.id) });
    expect(celdasDe(PAGINA, DEL_CIERRE)["Registró"].textContent).toBe("Automático · Aprobación del cierre por Ana Maestra");
  });

  it("si el servidor no la da, las celdas lo dicen", async () => {
    autoriaMock.mockResolvedValue({ status: "forbidden" });
    pintarModulo();
    await waitFor(() => expect(celdasDe(PAGINA, SUELDO)["A quién"].textContent).toBe("No se pudo leer"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("458-E T E.2 — filtros Todo / Entra / Sale, concepto y periodo; tarjetas del conjunto (R53, R54)", () => {
  it("R53: las tarjetas pintan el resumen que llegó del servidor", () => {
    pintarModulo();
    const ganancia = screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.ganancia });
    expect(ganancia.textContent).toContain(money("20000.00"));
  });

  it("R54: «Entra» se aplica al pulsarlo y viaja como `tipo` a libro, tarjetas y desglose; las tarjetas cambian", async () => {
    const user = pintarModulo();
    resumenMock.mockResolvedValue({ status: "ok", resumen: RESUMEN_ENTRA, composicion: COMPOSICION });

    const grupo = screen.getByRole("group", { name: "Filtrar por dirección del dinero" });
    expect(within(grupo).getByRole("button", { name: "Todo" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(grupo).getByRole("button", { name: "Entra" }));

    const esperado = { tipo: "ingreso", page: 1, pageSize: 20 };
    await waitFor(() => expect(listarMock).toHaveBeenCalledWith(esperado));
    expect(resumenMock).toHaveBeenCalledWith(esperado);
    expect(desgloseMock).toHaveBeenCalledWith(esperado);
    expect(within(grupo).getByRole("button", { name: "Entra" })).toHaveAttribute("aria-pressed", "true");
    // La tarjeta de la ganancia refleja el conjunto filtrado (el resumen NUEVO del servidor).
    await waitFor(() =>
      expect(screen.getByRole("region", { name: CAJA_RESUMEN_LABEL.ganancia }).textContent).toContain(money("5000.00")),
    );
    // R13 con la dirección: los conceptos del filtro se piden para lo que ENTRA.
    await waitFor(() => expect(conceptosMock).toHaveBeenCalledWith({ libro: "caja", tipo: "ingreso" }));

    await user.click(within(grupo).getByRole("button", { name: "Sale" }));
    await waitFor(() => expect(listarMock).toHaveBeenLastCalledWith({ tipo: "egreso", page: 1, pageSize: 20 }));

    await user.click(within(grupo).getByRole("button", { name: "Todo" }));
    await waitFor(() => expect(listarMock).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 }));
  });

  it("R54: el periodo se suma a la dirección elegida y la descarga lleva los mismos filtros", async () => {
    const user = pintarModulo();
    await user.click(screen.getByRole("button", { name: "Sale" }));
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText("Desde"), "2026-09-01");
    await user.type(screen.getByLabelText("Hasta"), "2026-09-30");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    const esperado = { tipo: "egreso", desde: "2026-09-01", hasta: "2026-09-30" };
    await waitFor(() => expect(listarMock).toHaveBeenLastCalledWith({ ...esperado, page: 1, pageSize: 20 }));
    expect(resumenMock).toHaveBeenLastCalledWith({ ...esperado, page: 1, pageSize: 20 });
    await waitFor(() => expect(conceptosMock).toHaveBeenCalledWith({ libro: "caja", ...esperado }));

    await user.click(screen.getByRole("button", { name: "Descargar Libro de movimientos" }));
    await waitFor(() => expect(completoMock).toHaveBeenCalledWith(esperado));
  });

  it("ya no hay `Select` de tipo: la dirección es el filtro segmentado", () => {
    pintarModulo();
    expect(screen.queryByRole("combobox", { name: "Filtrar por tipo" })).toBeNull();
    expect(screen.queryByText("Todos los tipos")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("458-E T E.3 — «Ver», anular y el refresco del libro (R58, R60)", () => {
  it("R60: anular desde el panel relee libro, tarjetas + composición y desglose con los filtros VIGENTES", async () => {
    const user = pintarModulo();
    await user.click(screen.getByRole("button", { name: "Sale" }));
    await waitFor(() => expect(listarMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(tabla()).queryByRole("status")).not.toBeInTheDocument());
    vi.clearAllMocks();
    listarMock.mockResolvedValue({ status: "ok", data: { movimientos: PAGINA, total: PAGINA.length, page: 1, pageSize: 20 } });
    resumenMock.mockResolvedValue({ status: "ok", resumen: RESUMEN, composicion: COMPOSICION });
    desgloseMock.mockResolvedValue({ status: "ok", desglose: DESGLOSE });
    anularMock.mockResolvedValue({ status: "ok", camino: "egreso_caja" });

    const fila = within(tabla()).getAllByRole("row").slice(1)[PAGINA.indexOf(SUELDO)];
    await user.click(within(fila).getByRole("button", { name: /^Ver Sueldo del / }));
    const panel = await screen.findByRole("dialog");
    // El panel dice a quién y quién lo registró, con la MISMA lectura que la columna.
    await waitFor(() => expect(within(panel).getByText("Juan Pérez")).toBeInTheDocument());
    await user.click(within(panel).getByRole("button", { name: "Anular…" }));
    const dialogo = await screen.findByRole("dialog", { name: /^Anular / });
    await user.type(within(dialogo).getByLabelText(/^Motivo de la anulación/), "Registrado dos veces");
    await user.click(within(dialogo).getByRole("button", { name: "Anular" }));

    await waitFor(() => expect(anularMock).toHaveBeenCalledWith({
      destino: { libro: "caja", movimientoId: SUELDO.id },
      motivo: "Registrado dos veces",
    }));
    const vigentes = { tipo: "egreso", page: 1, pageSize: 20 };
    await waitFor(() => expect(listarMock).toHaveBeenCalledWith(vigentes));
    expect(resumenMock).toHaveBeenCalledWith(vigentes); // tarjetas + composición (misma respuesta)
    expect(desgloseMock).toHaveBeenCalledWith(vigentes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("458-E T E.4 — el cobro por rechazo anulado (R61, R73)", () => {
  const GESTION_ANULADA = uuid();
  const FLETE_ANULADO = fila({
    tipo: "ingreso",
    categoria: "ingreso_flete_devolucion",
    origenTipo: "gestion_orden",
    origenId: GESTION_ANULADA,
    monto: "1800.00",
    descripcion: null,
    registradoPor: null,
    documento: doc("rechazo_tienda_cobro", { anulado: true }),
  });
  /** Otro cobro, PENDIENTE: la cola lo sigue ofreciendo. El anulado (aprobado) no está en ella. */
  const PENDIENTE: RechazoTiendaCobroDTO = {
    id: uuid(),
    tiendaNombre: "Tienda Luna",
    numGuia: 4021,
    numRemision: "REM-4021",
    montoFlete: "2500.00",
    montoIva: "325.00",
    generadoEl: "2026-09-20",
    estado: "pendiente",
  };

  it("la cola ofrece solo el pendiente; la línea anulada dice «Anulado» y su panel, que no se vuelve a ofrecer", async () => {
    colaRechazoMock.mockResolvedValue({ status: "ok", items: [PENDIENTE], total: 1 });
    const filas = [FLETE_ANULADO, SUELDO];
    const user = pintarModulo(filas, { items: [PENDIENTE], total: 1 });

    // La cola (sin cambios de comportamiento): una fila, la del pendiente, con sus dos decisiones.
    const cola = screen.getByRole("region", { name: /cobros por rechazo/i });
    const filasCola = within(cola).getAllByRole("row").slice(1);
    expect(filasCola).toHaveLength(1);
    expect(filasCola[0].textContent).toContain("Tienda Luna");
    expect(within(filasCola[0]).getByRole("button", { name: "Cobrar" })).toBeInTheDocument();
    expect(within(cola).getAllByRole("button", { name: "Cobrar" })).toHaveLength(1);

    // La línea del cobro anulado en el libro: «Anulado», tachada.
    const linea = within(tabla()).getAllByRole("row").slice(1)[0];
    expect(within(linea).getByText("Anulado")).toBeInTheDocument();
    expect(linea.className).toContain("line-through");

    // Su panel lo dice en palabras y no ofrece anularlo otra vez.
    await user.click(within(linea).getByRole("button", { name: /^Ver / }));
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(COBRO_RECHAZO_TEXTO.anulado)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Anular…" })).toBeNull();
  });
});
