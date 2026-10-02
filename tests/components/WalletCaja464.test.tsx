// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import ExcelJS from "exceljs";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import type { DetalleDeMovimientoLoteDTO } from "@/lib/types/detalle-en-lote";
import { aplicarPeriodo, diaDelMesActual } from "@/tests/fixtures/periodo-calendario";
import { elegirEnBarra } from "@/tests/fixtures/barra-libro-wallet";
import {
  DISPARADOR_DETALLE,
  OPCION_CON_DETALLE,
  abrirSelectorDetalle,
  elegirSoloLosMovimientos,
} from "@/tests/fixtures/descarga-detalle-por-orden";

// =================================================================================================
// FICHA 464 (T8) — LA CAJA (`/wallet`): selector de columnas y «Movimientos y detalle por orden».
// =================================================================================================
// Con detalle (lo de entrada, R8): UNA petición a la acción con detalle con los filtros, el término y el
// orden vigentes (R14/R36), y ninguna al completo de siempre. «Solo los movimientos»: la de siempre y
// ninguna con detalle (R13). El archivo se relee con exceljs. Literales a mano (contrato).
// =================================================================================================

const H = vi.hoisted(() => ({
  listar: vi.fn(),
  completo: vi.fn(),
  conDetalle: vi.fn(),
  resumen: vi.fn(),
  desglose: vi.fn(),
  conceptos: vi.fn(),
  quienes: vi.fn(),
  autoria: vi.fn(),
  toastError: vi.fn(),
  blob: vi.fn(),
}));

vi.mock("@/lib/actions/wallet", () => ({
  listarMovimientosAction: (...a: unknown[]) => H.listar(...a),
  listarMovimientosCompletoAction: (...a: unknown[]) => H.completo(...a),
  listarMovimientosCompletoConDetalleAction: (...a: unknown[]) => H.conDetalle(...a),
  verResumenCajaAction: (...a: unknown[]) => H.resumen(...a),
  listarMovimientosDeFilaAction: vi.fn(),
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/wallet",
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: H.toastError, info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: (...a: unknown[]) => H.blob(...a) }));

import { WalletModule } from "@/app/(app)/wallet/_components/WalletModule";

function mov(n: number, over: Partial<WalletMovimientoDTO> = {}): WalletMovimientoDTO {
  return {
    id: `0000000${n}-0000-4000-8000-00000000000${n}`,
    tipo: "ingreso",
    categoria: "ingreso_flete",
    monto: `${n}0.00`,
    origenTipo: "cierre_dia",
    origenId: `cccccccc-0000-4000-8000-00000000000${n}`,
    descripcion: null,
    registradoPor: "99999999-0000-4000-8000-000000000001",
    fechaMovimiento: `2026-09-2${n}T15:00:00.000Z`,
    dueno: "propio",
    documento: null,
    ...over,
  };
}

const PAGINA = [mov(3), mov(2), mov(1)];
// mov(2) es un sueldo: no nace de un cierre.
const TODOS = [mov(3), mov(2, { tipo: "egreso", categoria: "egreso_sueldo", origenTipo: "gasto", origenId: null }), mov(1)];
const CIERRE = { fecha: "2026-09-21T03:00:00.000Z", mensajeroNombre: "Mario Mensajero" };
const DETALLE: DetalleDeMovimientoLoteDTO[] = [
  {
    movimientoId: TODOS[0].id,
    modo: "ordenes",
    cierre: CIERRE,
    ordenes: [
      { guia: "1001", remision: "R-1", destinatario: "Ana", tiendaNombre: "Tienda Uno", resultados: ["entregado"], aporte: "12.50" },
      { guia: null, remision: "R-2", destinatario: "Beto", tiendaNombre: "Tienda Dos", resultados: ["entregado"], aporte: "17.50" },
    ],
    suma: "30.00",
    cuadra: true,
  },
  { movimientoId: TODOS[1].id, modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  {
    movimientoId: TODOS[2].id,
    modo: "ordenes",
    cierre: CIERRE,
    ordenes: [{ guia: "1003", remision: "R-3", destinatario: "Cata", tiendaNombre: "Tienda Uno", resultados: ["entregado"], aporte: "4.00" }],
    suma: "4.00",
    cuadra: false,
  },
];

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
        total={3}
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

// FICHA 467 — una sola barra, dentro del libro: Periodo, Entra/Sale y orden viven en ella.
const zonaLibro = () => screen.getByRole("region", { name: "Libro de movimientos" });
const zonaWallet = zonaLibro;
const buscador = () => screen.getByRole("searchbox", { name: "Buscar en el libro" });
const descargar = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Descargar Libro de movimientos" }));

async function archivo(): Promise<Array<{ nombre: string; filas: unknown[][] }>> {
  await waitFor(() => expect(H.blob).toHaveBeenCalled());
  const [contenido] = H.blob.mock.calls.at(-1)!;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(contenido as ArrayBuffer);
  return libro.worksheets.map((h) => {
    const filas: unknown[][] = [];
    h.eachRow({ includeEmpty: false }, (r) => {
      const valores = (r.values as unknown[]).slice(1);
      filas.push(Array.from({ length: h.columnCount }, (_, i) => valores[i] ?? null));
    });
    return { nombre: h.name, filas };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  H.listar.mockResolvedValue({ status: "ok", data: { movimientos: PAGINA, total: 3, page: 1, pageSize: 20 } });
  H.completo.mockResolvedValue({ status: "ok", items: TODOS, total: TODOS.length });
  H.conDetalle.mockResolvedValue({ status: "ok", items: TODOS, total: TODOS.length, detalle: DETALLE });
  H.resumen.mockResolvedValue({ status: "ok", resumen: { ...RESUMEN, periodoFiltrado: true }, composicion: COMPOSICION });
  H.desglose.mockResolvedValue({ status: "ok", desglose: DESGLOSE });
  H.conceptos.mockResolvedValue({ status: "ok", conceptos: [] });
  H.quienes.mockResolvedValue({ status: "ok", opciones: [], hayMas: false });
  H.autoria.mockImplementation(async () => ({ status: "ok", filas: [] }));
});
afterEach(() => cleanup());

const CABECERA_DE_SIEMPRE = ["Fecha", "Movimiento", "Motivo y origen", "A quién", "Entra o sale", "Monto", "Dueño", "Registró"];

describe("464 R1/R6/R8 — la caja ofrece el selector con el detalle, y arranca con él", () => {
  it("el selector de la descarga elige qué se descarga, y de entrada está «Movimientos y detalle por orden»", async () => {
    const user = pintar();
    expect(screen.getByRole("button", { name: DISPARADOR_DETALLE })).toBeInTheDocument();
    await abrirSelectorDetalle(user);
    expect(screen.getByRole("radio", { name: OPCION_CON_DETALLE })).toBeChecked();
  });
});

describe("464 R10/R14/R36 — con detalle: UNA petición con los filtros vigentes, dos hojas enlazadas", () => {
  it("periodo + «Sale» + término + «Más antiguas» viajan a la acción con detalle; el completo de siempre no se llama", async () => {
    const user = pintar();
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await elegirEnBarra(user, zonaLibro(), "Entra/Sale", "Sale");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "egreso" })));
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Juan" })), { timeout: 3000 });

    await descargar(user);
    await waitFor(() => expect(H.conDetalle).toHaveBeenCalledTimes(1));
    expect(H.conDetalle).toHaveBeenCalledWith({
      desde: diaDelMesActual(1),
      hasta: diaDelMesActual(28),
      tipo: "egreso",
      q: "Juan",
      sortBy: "fecha",
      sortDir: "asc",
    });
    expect(H.completo).not.toHaveBeenCalled();
    await archivo();
  });

  it("R4/R10/R15/R16/R22/R23: dos hojas; la de movimientos con las columnas de siempre entre «N.º» y «Detalle por orden»", async () => {
    const user = pintar();
    await descargar(user);
    const hojas = await archivo();
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de movimientos", "Detalle por orden"]);
    const [movs, detalle] = hojas;
    expect(movs.filas[0]).toEqual(["N.º", ...CABECERA_DE_SIEMPRE, "Detalle por orden"]);
    expect(movs.filas.slice(1).map((f) => [f[0], f[6], f[9]])).toEqual([
      [1, "30.00", "2 órdenes"],
      [2, "20.00", expect.stringContaining("no nace del cierre del día")],
      [3, "10.00", "1 orden. La suma de las órdenes es 4.00 y no coincide con el monto del movimiento."],
    ]);
    expect(detalle.filas).toEqual([
      ["N.º", "Fecha", "Movimiento", "Cierre del", "Mensajero", "Guía", "Remisión", "Destinatario", "Tienda", "Resultado", "Monto"],
      [1, movs.filas[1][1], movs.filas[1][2], "2026-09-20", "Mario Mensajero", "1001", "R-1", "Ana", "Tienda Uno", expect.any(String), "12.50"],
      [1, movs.filas[1][1], movs.filas[1][2], "2026-09-20", "Mario Mensajero", null, "R-2", "Beto", "Tienda Dos", expect.any(String), "17.50"],
      [3, movs.filas[3][1], movs.filas[3][2], "2026-09-20", "Mario Mensajero", "1003", "R-3", "Cata", "Tienda Uno", expect.any(String), "4.00"],
    ]);
  });
});

describe("464 R9/R13 — «Solo los movimientos» es la descarga de siempre", () => {
  it("llama al completo de siempre, NUNCA a la acción con detalle, y baja una hoja con las columnas de siempre", async () => {
    const user = pintar();
    await elegirSoloLosMovimientos(user);
    await descargar(user);
    const hojas = await archivo();
    expect(H.completo).toHaveBeenCalledTimes(1);
    expect(H.conDetalle).not.toHaveBeenCalled();
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de movimientos"]);
    expect(hojas[0].filas[0]).toEqual(CABECERA_DE_SIEMPRE);
  });
});

describe("464 R38/R39/R43 — sin archivo, con aviso", () => {
  it("R39: el detalle pasa del tope ⇒ el aviso del detalle, con sus filas, el tope y qué hacer", async () => {
    H.conDetalle.mockResolvedValue({ status: "limite_excedido", hoja: "detalle", total: 6200, limite: 5000 });
    const user = pintar();
    await descargar(user);
    await waitFor(() =>
      expect(H.toastError).toHaveBeenCalledWith(
        "El detalle por orden tendría 6200 filas y la descarga admite hasta 5000. Acota el periodo, o elige «Solo los movimientos» y vuelve a intentarlo.",
      ),
    );
    expect(H.blob).not.toHaveBeenCalled();
  });

  it("R38: la hoja de movimientos pasa del tope ⇒ el aviso de siempre", async () => {
    H.conDetalle.mockResolvedValue({ status: "limite_excedido", hoja: "movimientos", total: 5001, limite: 5000 });
    const user = pintar();
    await descargar(user);
    await waitFor(() =>
      expect(H.toastError).toHaveBeenCalledWith(expect.stringContaining("La descarga supera el máximo de 5000 filas (hay 5001).")),
    );
    expect(H.blob).not.toHaveBeenCalled();
  });

  it("R43: la lectura lanza ⇒ aviso, sin archivo, y el libro pintado no cambia", async () => {
    H.conDetalle.mockRejectedValue(new Error("Failed to fetch"));
    const user = pintar();
    await descargar(user);
    await waitFor(() =>
      expect(H.toastError).toHaveBeenCalledWith("No se pudo generar el archivo. Vuelve a intentarlo; el listado no cambió."),
    );
    expect(H.blob).not.toHaveBeenCalled();
    expect(within(screen.getByRole("table", { name: "Libro de movimientos" })).getAllByRole("row")).toHaveLength(4);
  });

  it("R43: la autoría no se puede leer ⇒ sin archivo (las columnas «A quién» y «Registró» dirían «nadie»)", async () => {
    const user = pintar();
    // La del libro pintado responde; la de la descarga, no.
    await waitFor(() => expect(H.autoria).toHaveBeenCalled());
    H.autoria.mockResolvedValue({ status: "forbidden" });
    await descargar(user);
    await waitFor(() => expect(H.toastError).toHaveBeenCalled());
    expect(H.blob).not.toHaveBeenCalled();
  });
});
