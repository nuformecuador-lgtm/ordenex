// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import ExcelJS from "exceljs";

import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import type { DetallePorGuiaDTO, KardexDTO } from "@/lib/types/libro-kardex";
import { aplicarPeriodo, diaDelMesActual } from "@/tests/fixtures/periodo-calendario";
import { elegirEnBarra } from "@/tests/fixtures/barra-libro-wallet";
import {
  DISPARADOR_DETALLE,
  OPCION_CON_DETALLE,
  abrirSelectorDetalle,
  elegirSoloLosMovimientos,
} from "@/tests/fixtures/descarga-detalle-por-orden";

// =================================================================================================
// FICHA 464 (T8) → FICHA 468 (T13) — LA CAJA (`/wallet`): el libro en Excel como KARDEX y «Movimientos y
// detalle por guía».
// =================================================================================================
// Con detalle (lo de entrada): UNA petición a `libroCajaKardexConDetalleAction` con los filtros y el
// término vigentes y el orden SIEMPRE ascendente (R7, R53); «Solo los movimientos»: UNA a
// `libroCajaKardexAction` y ninguna con detalle (R61), con la MISMA hoja «Movimientos» (R57). El archivo
// se relee con exceljs: los montos son números (R22), las filas fijas van en su sitio (R5, R8, R44) y en
// negrita (R23, R47). Literales a mano (contrato). Sustituye a `WalletCaja464.test.tsx`.
// =================================================================================================

const H = vi.hoisted(() => ({
  listar: vi.fn(),
  kardex: vi.fn(),
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
  libroCajaKardexAction: (...a: unknown[]) => H.kardex(...a),
  libroCajaKardexConDetalleAction: (...a: unknown[]) => H.conDetalle(...a),
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
// En orden cronológico ascendente, como los devuelve el servidor del kardex (R7). mov(2) es un sueldo:
// no nace de un cierre.
const TODOS = [mov(1), mov(2, { tipo: "egreso", categoria: "egreso_sueldo", origenTipo: "gasto", origenId: null }), mov(3)];
/** El kardex del servidor (ya calculado: el cliente solo lo coloca). */
const KARDEX: KardexDTO = {
  saldoInicial: "500.00",
  saldoFinal: "490.00",
  totales: { entra: "10.00", sale: "20.00", cobradoATiendas: "30.00" },
  conOtrosFiltros: false,
  filas: [
    { monto: { columna: "entra", monto: "10.00" }, saldo: "510.00", ordenes: 1 },
    { monto: { columna: "sale", monto: "20.00" }, saldo: "490.00", ordenes: null },
    { monto: { columna: "cobrado_a_tiendas", monto: "30.00" }, saldo: "490.00", ordenes: 2 },
  ],
};
const POR_GUIA: DetallePorGuiaDTO = {
  bloques: [
    {
      guia: "1001",
      remision: "R-1",
      destinatario: "Ana",
      tiendaNombre: "Tienda Uno",
      mensajeroNombre: "Mario Mensajero",
      cierres: ["2026-09-21T03:00:00.000Z"],
      resultados: ["entregado"],
      filas: [
        { movimientoId: TODOS[0].id, cierreFecha: "2026-09-21T03:00:00.000Z", resultados: ["entregado"], monto: { columna: "entra", monto: "6.00" } },
        { movimientoId: TODOS[2].id, cierreFecha: "2026-09-21T03:00:00.000Z", resultados: ["entregado"], monto: { columna: "cobrado_a_tiendas", monto: "12.50" } },
      ],
      total: { entra: "6.00", sale: "0.00", cobradoATiendas: "12.50" },
    },
    {
      guia: null,
      remision: "R-2",
      destinatario: "Beto",
      tiendaNombre: "Tienda Dos",
      mensajeroNombre: "Mario Mensajero",
      cierres: ["2026-09-21T03:00:00.000Z"],
      resultados: ["entregado"],
      filas: [
        { movimientoId: TODOS[2].id, cierreFecha: "2026-09-21T03:00:00.000Z", resultados: ["entregado"], monto: { columna: "cobrado_a_tiendas", monto: "17.50" } },
      ],
      total: { entra: "0.00", sale: "0.00", cobradoATiendas: "17.50" },
    },
  ],
  sinGuia: [
    { tipo: "movimiento", movimientoId: TODOS[1].id, motivo: "no_nace_de_un_cierre", monto: { columna: "sale", monto: "20.00" } },
    {
      tipo: "diferencia",
      movimientoId: TODOS[0].id,
      cierreFecha: "2026-09-21T03:00:00.000Z",
      montoMovimiento: "10.00",
      sumaGuias: "6.00",
      monto: { columna: "entra", monto: "4.00" },
    },
  ],
  totalGeneral: { entra: "10.00", sale: "20.00", cobradoATiendas: "30.00" },
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

async function archivo(): Promise<Array<{ nombre: string; filas: unknown[][]; negritas: number[] }>> {
  await waitFor(() => expect(H.blob).toHaveBeenCalled());
  const [contenido] = H.blob.mock.calls.at(-1)!;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(contenido as ArrayBuffer);
  return libro.worksheets.map((h) => {
    const filas: unknown[][] = [];
    const negritas: number[] = [];
    h.eachRow({ includeEmpty: false }, (r, n) => {
      const valores = (r.values as unknown[]).slice(1);
      filas.push(Array.from({ length: h.columnCount }, (_, i) => valores[i] ?? null));
      // Índice de fila de DATOS (la 1 es la de encabezados).
      if (n > 1 && r.getCell(1).font?.bold === true) negritas.push(n - 2);
    });
    return { nombre: h.name, filas, negritas };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  H.listar.mockResolvedValue({ status: "ok", data: { movimientos: PAGINA, total: 3, page: 1, pageSize: 20 } });
  H.kardex.mockResolvedValue({ status: "ok", items: TODOS, total: TODOS.length, kardex: KARDEX });
  H.conDetalle.mockResolvedValue({ status: "ok", items: TODOS, total: TODOS.length, kardex: KARDEX, porGuia: POR_GUIA });
  H.resumen.mockResolvedValue({ status: "ok", resumen: { ...RESUMEN, periodoFiltrado: true }, composicion: COMPOSICION });
  H.desglose.mockResolvedValue({ status: "ok", desglose: DESGLOSE });
  H.conceptos.mockResolvedValue({ status: "ok", conceptos: [] });
  H.quienes.mockResolvedValue({ status: "ok", opciones: [], hayMas: false });
  H.autoria.mockImplementation(async () => ({ status: "ok", filas: [] }));
});
afterEach(() => cleanup());

/** R1 — la hoja «Movimientos» de la caja (contrato). */
const CABECERA_KARDEX = [
  "Fecha",
  "Concepto",
  "Detalle",
  "A quién",
  "Es dinero de",
  "Entra",
  "Sale",
  "Cobrado a tiendas",
  "Saldo",
  "Registró",
];

describe("468 R24 — la caja ofrece el selector con el detalle por guía, y arranca con él", () => {
  it("el selector de la descarga elige qué se descarga, y de entrada está «Movimientos y detalle por guía»", async () => {
    const user = pintar();
    expect(screen.getByRole("button", { name: DISPARADOR_DETALLE })).toBeInTheDocument();
    await abrirSelectorDetalle(user);
    expect(screen.getByRole("radio", { name: OPCION_CON_DETALLE })).toBeChecked();
  });
});

describe("468 R7/R53 — con detalle: UNA petición con los filtros vigentes, SIEMPRE en orden cronológico", () => {
  it("periodo + «Sale» + término viajan a la acción con detalle con el orden ascendente aunque la pantalla diga «Más recientes»", async () => {
    const user = pintar();
    await aplicarPeriodo(user, zonaWallet(), 1, 28);
    await waitFor(() => expect(H.resumen).toHaveBeenCalledTimes(1));
    await elegirEnBarra(user, zonaLibro(), "Entra/Sale", "Sale");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: "egreso" })));
    await user.type(buscador(), "Juan");
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ q: "Juan" })), { timeout: 3000 });
    // La pantalla sigue en «Más recientes» (por defecto): el libro paginado no lleva orden.
    expect(H.listar.mock.calls.at(-1)?.[0]).not.toHaveProperty("sortDir");

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
    expect(H.kardex).not.toHaveBeenCalled();
    await archivo();
  });

  it("R7: con «Más antiguas» elegido también sale ascendente (el archivo no hereda el orden de la pantalla)", async () => {
    const user = pintar();
    await user.click(within(zonaLibro()).getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.listar).toHaveBeenLastCalledWith(expect.objectContaining({ sortDir: "asc" })));
    await descargar(user);
    await waitFor(() => expect(H.conDetalle).toHaveBeenCalledTimes(1));
    expect(H.conDetalle.mock.calls[0][0]).toMatchObject({ sortBy: "fecha", sortDir: "asc" });
  });
});

describe("468 R1/R5/R8/R22/R23/R26/R29/R44/R45/R47 — el archivo con detalle", () => {
  it("R26: dos hojas, «Movimientos» primero; R1/R29: sus columnas", async () => {
    const user = pintar();
    await descargar(user);
    const hojas = await archivo();
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de movimientos", "Detalle por guía"]);
    expect(hojas[0].filas[0]).toEqual(CABECERA_KARDEX);
    expect(hojas[1].filas[0]).toEqual([
      "Guía",
      "Remisión",
      "Destinatario",
      "Tienda",
      "Mensajero",
      "Cierre",
      "Resultado",
      "Concepto",
      "Detalle",
      "Entra",
      "Sale",
      "Cobrado a tiendas",
    ]);
  });

  it("R5/R8/R10/R22/R23: saldo inicial, una fila por movimiento con su monto NUMÉRICO en su columna, el total y el saldo final", async () => {
    const user = pintar();
    await descargar(user);
    const [movs] = await archivo();
    // [Concepto, Entra, Sale, Cobrado a tiendas, Saldo]
    const montos = movs.filas.slice(1).map((f) => [f[1], f[5], f[6], f[7], f[8]]);
    expect(montos).toEqual([
      ["Saldo al inicio del periodo", null, null, null, 500],
      [expect.any(String), 10, null, null, 510],
      [expect.any(String), null, 20, null, 490],
      [expect.any(String), null, null, 30, 490],
      ["Total del periodo", 10, 20, 30, 490],
    ]);
    // R18: el «N guía(s)» al final del Detalle de los repartibles (decisión 3: «guía», no «orden»).
    expect(String(movs.filas[2][2])).toMatch(/ · 1 guía$/);
    expect(String(movs.filas[4][2])).toMatch(/ · 2 guías$/);
    expect(movs.negritas).toEqual([0, 4]);
  });

  it("R34–R44/R47: bloques por guía con su total, «Movimientos sin guía», la diferencia y el TOTAL GENERAL = «Total del periodo» (R45)", async () => {
    const user = pintar();
    await descargar(user);
    const [movs, guias] = await archivo();
    const conceptoDe = (f: unknown[]) => f[7];
    expect(guias.filas.slice(1).map(conceptoDe)).toEqual([
      null,
      movs.filas[2][1],
      movs.filas[4][1],
      "Total de la guía",
      null,
      movs.filas[4][1],
      "Total de la guía",
      "Movimientos sin guía",
      movs.filas[3][1],
      "Diferencia sin repartir",
      "TOTAL GENERAL",
    ]);
    expect(guias.filas[1].slice(0, 7)).toEqual(["1001", "R-1", "Ana", "Tienda Uno", "Mario Mensajero", "2026-09-20", expect.any(String)]);
    expect(guias.filas[5][0]).toBe("Sin guía · remisión R-2");
    const total = (f: unknown[]) => f.slice(-3);
    expect(total(guias.filas.at(-1)!)).toEqual(total(movs.filas.at(-1)!.slice(5, 8)));
    expect(guias.negritas).toEqual([0, 3, 4, 6, 7, 10]);
  });
});

describe("468 R57/R61 — «Solo los movimientos»", () => {
  it("pide el kardex SIN detalle (nunca la acción con detalle) y la hoja «Movimientos» es idéntica a la de la descarga con detalle", async () => {
    const user = pintar();
    await descargar(user);
    const [conDetalle] = await archivo();
    H.blob.mockClear();
    await elegirSoloLosMovimientos(user);
    await descargar(user);
    const hojas = await archivo();
    expect(H.kardex).toHaveBeenCalledTimes(1);
    expect(H.conDetalle).toHaveBeenCalledTimes(1); // solo la primera descarga
    expect(H.kardex.mock.calls[0][0]).toMatchObject({ sortBy: "fecha", sortDir: "asc" });
    expect(hojas.map((h) => h.nombre)).toEqual(["Libro de movimientos"]);
    expect(hojas[0].filas).toEqual(conDetalle.filas);
    expect(hojas[0].negritas).toEqual(conDetalle.negritas);
  });
});

describe("464 R38/R39/R43 → 468 R56 — sin archivo, con aviso", () => {
  it("R56: el detalle pasa del tope ⇒ el aviso del detalle por guía, con sus filas, el tope y qué hacer", async () => {
    H.conDetalle.mockResolvedValue({ status: "limite_excedido", hoja: "detalle", total: 6200, limite: 5000 });
    const user = pintar();
    await descargar(user);
    await waitFor(() =>
      expect(H.toastError).toHaveBeenCalledWith(
        "El detalle por guía tendría 6200 filas y la descarga admite hasta 5000. Acota el periodo, o elige «Solo los movimientos» y vuelve a intentarlo.",
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
