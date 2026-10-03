// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { SWRConfig } from "swr";
import ExcelJS from "exceljs";

import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { DetallePorGuiaDTO, KardexDTO } from "@/lib/types/libro-kardex";
import { UUID_MENSAJERO, UUID_MOV, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";
import {
  DISPARADOR_DETALLE,
  OPCION_CON_DETALLE,
  abrirSelectorDetalle,
  elegirSoloLosMovimientos,
} from "@/tests/fixtures/descarga-detalle-por-orden";
import { claveDeAmbitoDescarga } from "@/lib/columnas/preferencia-columnas";

// =================================================================================================
// FICHA 464 (T9) → FICHA 468 (T13) — LOS CUATRO ESTADOS DE CUENTA.
//
//  - R24/R25: «Movimientos y detalle por guía» en la tienda y el mensajero de la oficina (el mensajero es
//    NUEVO: la 464 no lo tenía) y en `/mi-wallet`; la bodega satélite solo baja la hoja «Movimientos».
//  - R7/R53: UNA petición por opción, SIEMPRE en orden cronológico ascendente, con la cuenta como id.
//  - R2/R3/R5/R8/R30–R32: las columnas de cada hoja, el saldo inicial arriba y el total abajo.
//  - R57: la hoja «Movimientos» de «Solo los movimientos» es la misma que la de la descarga con detalle.
//  - R56: el tope del detalle es un aviso y ningún archivo.
//  - 464 R2 (sigue): cada superficie con su ámbito de columnas.
//
// Se montan las CUATRO superficies reales; lo que no es la descarga (acciones, pagos, conciliación) se
// sustituye por un hueco, porque aquí no se juzga. Sustituye a `EstadoCuenta464.test.tsx`.
// =================================================================================================

const H = vi.hoisted(() => ({
  ver: vi.fn(),
  kardex: vi.fn(),
  conDetalle: vi.fn(),
  miVer: vi.fn(),
  miKardex: vi.fn(),
  miConDetalle: vi.fn(),
  blob: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => H.ver(...a),
  estadoCuentaKardexAction: (...a: unknown[]) => H.kardex(...a),
  estadoCuentaKardexConDetalleAction: (...a: unknown[]) => H.conDetalle(...a),
  verMiEstadoCuentaAction: (...a: unknown[]) => H.miVer(...a),
  miEstadoCuentaKardexAction: (...a: unknown[]) => H.miKardex(...a),
  miEstadoCuentaKardexConDetalleAction: (...a: unknown[]) => H.miConDetalle(...a),
  verOrdenesDeFilaAction: vi.fn(),
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));
vi.mock("@/lib/actions/wallet-filtros", () => ({
  cierresDeLaCuentaAction: vi.fn(async () => ({ status: "ok", opciones: [], hayMas: false })),
  conceptosConMovimientosAction: vi.fn(async () => ({ status: "ok", conceptos: [] })),
  quienesDelLibroCajaAction: vi.fn(),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));
vi.mock("@/app/(app)/wallet/tiendas/_components/EstadoCuentaAcciones", () => ({ EstadoCuentaAcciones: () => null }));
vi.mock("@/app/(app)/wallet/tiendas/_components/PagosTiendaEstadoCuenta", () => ({ PagosTiendaEstadoCuenta: () => null }));
vi.mock("@/app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones", () => ({ PagoMensajeroAcciones: () => null }));
vi.mock("@/app/(app)/wallet/satelites/_components/ConciliacionSatelite", () => ({ ConciliacionSatelite: () => null }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ success: vi.fn(), error: H.toastError, info: vi.fn(), warning: vi.fn(), show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock("@/components/shared/descargar-blob", () => ({ descargarBlob: (...a: unknown[]) => H.blob(...a) }));

// Ficha 470 (T4.5) — la preparación de descargas corre REAL por defecto (la acción de arriba llega por el
// registro); un caso puede sustituir UNA respuesta para simular el almacén temporal o su fallo.
const P470 = vi.hoisted(() => ({ preparar: vi.fn() }));
vi.mock("@/lib/actions/descargas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/actions/descargas")>();
  P470.preparar.mockImplementation(real.prepararDescargaAction);
  return { ...real, prepararDescargaAction: (...a: unknown[]) => P470.preparar(...a) };
});
const URL_FIRMADA_470 = "https://x.supabase.co/storage/v1/object/sign/descargas/tmp/0b8f7c3e-1a2b-4c3d-8e4f-123456789abc.json.gz?token=t";

import { EstadoCuentaTienda } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { EstadoCuentaMensajero } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { EstadoCuentaSatelite } from "@/app/(app)/wallet/satelites/_components/EstadoCuentaSatelite";
import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";

// Dos filas de la tienda, en orden cronológico (R7): un cobro de COD de un cierre (repartible) y un pago.
const COD = fila({ n: 1, fecha: "2026-09-12", categoria: "cod_recaudado", abono: "30.00", saldoCorrido: "30.00" });
const PAGO = fila({
  n: 2,
  fecha: "2026-09-13",
  categoria: "pago_tienda",
  origenTipo: "pago_tienda",
  chip: "pagos",
  abono: null,
  cargo: "30.00",
  saldoCorrido: "0.00",
  naceDeUnCierre: false,
});
const TIENDA = estado({ filas: [COD, PAGO], total: 2, saldoInicial: "0.00", saldoFinal: "0.00" });
/** El kardex del servidor para esas dos filas (ya calculado: el cliente solo lo coloca). */
const KARDEX: KardexDTO = {
  saldoInicial: "0.00",
  saldoFinal: "0.00",
  totales: { entra: "30.00", sale: "30.00", cobradoATiendas: null },
  conOtrosFiltros: false,
  filas: [
    { monto: { columna: "entra", monto: "30.00" }, saldo: "30.00", ordenes: 2 },
    { monto: { columna: "sale", monto: "30.00" }, saldo: "0.00", ordenes: null },
  ],
};
const POR_GUIA: DetallePorGuiaDTO = {
  bloques: [
    {
      guia: "1001",
      remision: "R-1",
      destinatario: "Ana",
      tiendaNombre: null,
      mensajeroNombre: "Mario Mensajero",
      cierres: ["2026-09-12T20:00:00.000Z"],
      resultados: ["entregado"],
      filas: [{ movimientoId: UUID_MOV(1), cierreFecha: "2026-09-12T20:00:00.000Z", resultados: ["entregado"], monto: { columna: "entra", monto: "10.00" } }],
      total: { entra: "10.00", sale: "0.00", cobradoATiendas: null },
    },
    {
      guia: "1002",
      remision: "R-2",
      destinatario: "Beto",
      tiendaNombre: null,
      mensajeroNombre: "Mario Mensajero",
      cierres: ["2026-09-12T20:00:00.000Z"],
      resultados: ["entregado"],
      filas: [{ movimientoId: UUID_MOV(1), cierreFecha: "2026-09-12T20:00:00.000Z", resultados: ["entregado"], monto: { columna: "entra", monto: "20.00" } }],
      total: { entra: "20.00", sale: "0.00", cobradoATiendas: null },
    },
  ],
  sinGuia: [{ tipo: "movimiento", movimientoId: UUID_MOV(2), motivo: "no_nace_de_un_cierre", monto: { columna: "sale", monto: "30.00" } }],
  totalGeneral: { entra: "30.00", sale: "30.00", cobradoATiendas: null },
};
/** /mi-wallet: el servidor no manda el mensajero (R49). */
const POR_GUIA_MI_WALLET: DetallePorGuiaDTO = {
  ...POR_GUIA,
  bloques: POR_GUIA.bloques.map((b) => ({ ...b, mensajeroNombre: null })),
};

const MENSAJERO_FILA = fila({ n: 3, libro: "mensajero", categoria: "pago_devengado", abono: "500.00", saldoCorrido: "500.00" });
const MENSAJERO = estado({ tipo: "mensajero", nombre: "Mario", filas: [MENSAJERO_FILA], saldoFinal: "500.00" });
const KARDEX_MENSAJERO: KardexDTO = {
  saldoInicial: "0.00",
  saldoFinal: "500.00",
  totales: { entra: "500.00", sale: "0.00", cobradoATiendas: null },
  conOtrosFiltros: false,
  filas: [{ monto: { columna: "entra", monto: "500.00" }, saldo: "500.00", ordenes: 1 }],
};
const POR_GUIA_MENSAJERO: DetallePorGuiaDTO = {
  bloques: [
    {
      guia: "2001",
      remision: "R-9",
      destinatario: "Carla",
      tiendaNombre: "Tienda Uno",
      mensajeroNombre: null,
      cierres: ["2026-09-12T20:00:00.000Z"],
      resultados: ["entregado"],
      filas: [{ movimientoId: UUID_MOV(3), cierreFecha: "2026-09-12T20:00:00.000Z", resultados: ["entregado"], monto: { columna: "entra", monto: "500.00" } }],
      total: { entra: "500.00", sale: "0.00", cobradoATiendas: null },
    },
  ],
  sinGuia: [],
  totalGeneral: { entra: "500.00", sale: "0.00", cobradoATiendas: null },
};

function envolver(nodo: ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{nodo}</SWRConfig>);
}

const SUPERFICIES = {
  tienda: () => envolver(<EstadoCuentaTienda inicial={TIENDA} puedeRegistrar={false} />),
  miWallet: () =>
    envolver(<MiEstadoCuenta inicial={{ ...TIENDA, resumen: null }} cierres={{ opciones: [], hayMas: false, disponible: true }} />),
  mensajero: () => envolver(<EstadoCuentaMensajero inicial={MENSAJERO} puedeRegistrar={false} />),
  satelite: () =>
    envolver(
      <EstadoCuentaSatelite
        inicial={estado({ tipo: "bodega", nombre: "Bodega Norte", filas: [fila({ chip: "declarado", naceDeUnCierre: false })] })}
        puedeConciliar={false}
      />,
    ),
};

async function archivo(): Promise<Array<{ nombre: string; filas: unknown[][] }>> {
  await waitFor(() => expect(H.blob).toHaveBeenCalled());
  const [contenido] = H.blob.mock.calls.at(-1)!;
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(contenido as ArrayBuffer);
  return libro.worksheets.map((h) => {
    const filas: unknown[][] = [];
    h.eachRow((r) => {
      const valores = (r.values as unknown[]).slice(1);
      filas.push(Array.from({ length: h.columnCount }, (_, i) => valores[i] ?? null));
    });
    return { nombre: h.name, filas };
  });
}

const CABECERA_OFICINA = ["Fecha", "Concepto", "Detalle", "Entra", "Sale", "Saldo", "Registró"];
const CABECERA_TIENDA = ["Fecha", "Concepto", "Detalle", "Entra", "Sale", "Saldo"];

function kardexOk(e: EstadoCuentaDTO, kardex: KardexDTO = KARDEX) {
  return { status: "ok", estado: { ...e, page: 1, pageSize: e.filas.length }, kardex };
}

const descargar = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^Descargar Estado de cuenta/ }));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  H.ver.mockImplementation(async () => ({ status: "ok", estado: TIENDA }));
  H.miVer.mockImplementation(async () => ({ status: "ok", estado: TIENDA }));
  H.kardex.mockImplementation(async () => kardexOk(TIENDA));
  H.miKardex.mockImplementation(async () => kardexOk(TIENDA));
  H.conDetalle.mockImplementation(async () => ({ ...kardexOk(TIENDA), porGuia: POR_GUIA }));
  H.miConDetalle.mockImplementation(async () => ({ ...kardexOk(TIENDA), porGuia: POR_GUIA_MI_WALLET }));
});
afterEach(() => cleanup());

describe("468 R24/R25 — qué ofrece cada estado de cuenta", () => {
  it("R24: la tienda (oficina), el MENSAJERO (nuevo) y /mi-wallet ofrecen el detalle por guía, y arrancan con él", async () => {
    for (const montar of [SUPERFICIES.tienda, SUPERFICIES.mensajero, SUPERFICIES.miWallet]) {
      const user = userEvent.setup();
      montar();
      await abrirSelectorDetalle(user);
      expect(screen.getByRole("radio", { name: OPCION_CON_DETALLE })).toBeChecked();
      cleanup();
    }
  });

  it("R25: la bodega satélite tiene selector de columnas, pero SIN detalle por guía", () => {
    SUPERFICIES.satelite();
    expect(screen.getByRole("button", { name: "Elegir columnas de la descarga" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DISPARADOR_DETALLE })).toBeNull();
  });
});

describe("468 R2/R7/R51 / 464 R2 — la bodega: el kardex de una hoja, su ámbito y sus fijas", () => {
  it("baja Fecha · Concepto · Detalle · Entra · Sale · Saldo · Registró en orden ascendente; ocultar en el mensajero no oculta en la bodega", async () => {
    const user = userEvent.setup();
    const bodega = estado({ tipo: "bodega", nombre: "Bodega Norte", filas: [fila({ chip: "declarado", naceDeUnCierre: false })] });
    H.kardex.mockImplementation(async () =>
      kardexOk(bodega, { ...KARDEX, filas: [{ monto: { columna: "entra", monto: "1000.00" }, saldo: "1000.00", ordenes: null }] }),
    );
    SUPERFICIES.satelite();
    await descargar(user);
    const hojas = await archivo();
    expect(hojas).toHaveLength(1);
    expect(hojas[0].filas[0]).toEqual(CABECERA_OFICINA);
    expect(H.kardex.mock.calls[0][0]).toMatchObject({ sortBy: "fecha", sortDir: "asc" });
    expect(H.conDetalle).not.toHaveBeenCalled();
    // R51: Concepto, Entra, Sale y Saldo no se pueden desmarcar.
    await user.click(screen.getByRole("button", { name: "Elegir columnas de la descarga" }));
    const fija = await screen.findByRole("checkbox", { name: "Saldo" });
    expect(fija.getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    cleanup();

    // 464 R2: se oculta «Detalle» en el del mensajero: queda en SU ámbito.
    H.blob.mockClear();
    SUPERFICIES.mensajero();
    await abrirSelectorDetalle(user);
    await user.click(await screen.findByRole("checkbox", { name: "Detalle" }));
    await user.keyboard("{Escape}");
    expect(window.localStorage.getItem(claveDeAmbitoDescarga("wallet-mensajero-estado-cuenta"))).not.toBeNull();
    expect(window.localStorage.getItem(claveDeAmbitoDescarga("wallet-satelite-estado-cuenta"))).toBeNull();
  });
});

describe("468 R7/R26/R53 — con detalle: UNA petición, dos hojas", () => {
  it("tienda (oficina): UNA petición con la cuenta y el orden ascendente; saldo inicial arriba, total abajo, hoja por guía (R30)", async () => {
    const user = userEvent.setup();
    SUPERFICIES.tienda();
    await descargar(user);
    const hojas = await archivo();
    expect(H.conDetalle).toHaveBeenCalledTimes(1);
    expect(H.conDetalle).toHaveBeenCalledWith({ cuenta: { tipo: "tienda", id: UUID_TIENDA }, sortBy: "fecha", sortDir: "asc" });
    expect(H.kardex).not.toHaveBeenCalled();

    const [movs, guias] = hojas;
    // El nombre de la principal lo sanea el generador de siempre (31 caracteres como mucho).
    expect(hojas.map((h) => h.nombre)).toEqual(["Estado de cuenta de Tania Tien…", "Detalle por guía"]);
    expect(movs.filas[0]).toEqual(CABECERA_OFICINA);
    // [Concepto, Entra, Sale, Saldo]
    expect(movs.filas.slice(1).map((f) => [f[1], f[3], f[4], f[5]])).toEqual([
      ["Saldo al inicio del periodo", null, null, 0],
      [expect.any(String), 30, null, 30],
      [expect.any(String), null, 30, 0],
      ["Total del periodo", 30, 30, 0],
    ]);
    expect(String(movs.filas[2][2])).toMatch(/2 guías$/);
    expect(guias.filas[0]).toEqual([
      "Guía",
      "Remisión",
      "Destinatario",
      "Mensajero",
      "Cierre",
      "Resultado",
      "Concepto",
      "Detalle",
      "Entra",
      "Sale",
    ]);
    // [Guía, Concepto, Entra, Sale]
    expect(guias.filas.slice(1).map((f) => [f[0], f[6], f[8], f[9]])).toEqual([
      ["1001", null, null, null],
      ["1001", movs.filas[2][1], 10, null],
      ["1001", "Total de la guía", 10, 0],
      ["1002", null, null, null],
      ["1002", movs.filas[2][1], 20, null],
      ["1002", "Total de la guía", 20, 0],
      [null, "Movimientos sin guía", null, null],
      [null, movs.filas[3][1], null, 30],
      [null, "TOTAL GENERAL", 30, 30],
    ]);
  });

  it("mensajero (oficina, NUEVO): UNA petición con la cuenta; R31: con «Tienda» y sin «Mensajero»", async () => {
    const user = userEvent.setup();
    H.conDetalle.mockImplementation(async () => ({ ...kardexOk(MENSAJERO, KARDEX_MENSAJERO), porGuia: POR_GUIA_MENSAJERO }));
    SUPERFICIES.mensajero();
    await descargar(user);
    const [movs, guias] = await archivo();
    expect(H.conDetalle).toHaveBeenCalledWith({ cuenta: { tipo: "mensajero", id: UUID_MENSAJERO }, sortBy: "fecha", sortDir: "asc" });
    expect(movs.filas[0]).toEqual(CABECERA_OFICINA);
    expect(guias.filas[0]).toEqual([
      "Guía",
      "Remisión",
      "Destinatario",
      "Tienda",
      "Cierre",
      "Resultado",
      "Concepto",
      "Detalle",
      "Entra",
      "Sale",
    ]);
    expect(guias.filas[1].slice(0, 4)).toEqual(["2001", "R-9", "Carla", "Tienda Uno"]);
  });

  it("/mi-wallet con «Más recientes»: sale igual en orden ascendente; ninguna cuenta viaja; sin mensajero (R32/R49)", async () => {
    const user = userEvent.setup();
    SUPERFICIES.miWallet();
    await descargar(user);
    const hojas = await archivo();
    expect(H.miConDetalle).toHaveBeenCalledWith({ sortBy: "fecha", sortDir: "asc" });
    const [movs, guias] = hojas;
    expect(movs.filas[0]).toEqual(CABECERA_TIENDA);
    expect(movs.filas[1][1]).toBe("Saldo al inicio del periodo");
    expect(guias.filas[0]).not.toContain("Mensajero");
    expect(JSON.stringify(hojas)).not.toContain("Mario Mensajero");
  });
});

describe("468 R57/R61 — «Solo los movimientos»", () => {
  it("la tienda y /mi-wallet piden el kardex SIN detalle y bajan una hoja idéntica a la de la descarga con detalle", async () => {
    for (const [montar, cabecera, kardex, conDetalle] of [
      [SUPERFICIES.tienda, CABECERA_OFICINA, H.kardex, H.conDetalle],
      [SUPERFICIES.miWallet, CABECERA_TIENDA, H.miKardex, H.miConDetalle],
    ] as const) {
      const user = userEvent.setup();
      H.blob.mockClear();
      montar();
      await descargar(user);
      const [conHoja2] = await archivo();
      H.blob.mockClear();
      await elegirSoloLosMovimientos(user);
      await descargar(user);
      const hojas = await archivo();
      expect(hojas).toHaveLength(1);
      expect(hojas[0].filas[0]).toEqual(cabecera);
      expect(hojas[0].filas).toEqual(conHoja2.filas);
      expect(kardex).toHaveBeenCalledTimes(1);
      expect(conDetalle).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });
});

describe("468 R56 / 464 R43 — sin archivo, con aviso", () => {
  it("el tope del detalle y una lectura que falla son un aviso y ningún archivo", async () => {
    const user = userEvent.setup();
    H.conDetalle.mockResolvedValueOnce({ status: "limite_excedido", hoja: "detalle", total: 9000, limite: 5000 });
    SUPERFICIES.mensajero();
    const boton = screen.getByRole("button", { name: /^Descargar Estado de cuenta/ });
    await user.click(boton);
    await waitFor(() =>
      expect(H.toastError).toHaveBeenCalledWith(
        "El detalle por guía tendría 9000 filas y la descarga admite hasta 5000. Acota el periodo, o elige «Solo los movimientos» y vuelve a intentarlo.",
      ),
    );
    H.conDetalle.mockRejectedValueOnce(new Error("Failed to fetch"));
    await user.click(boton);
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(2));
    expect(H.toastError.mock.calls[1][0]).toContain("No se pudo leer el estado de cuenta para descargarlo.");
    expect(H.blob).not.toHaveBeenCalled();
  });
});

describe("470 R15/R16 — el transporte del conjunto falla en el estado de cuenta con detalle por guía", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("R16: la URL firmada ya no se puede leer (caducada) ⇒ aviso, sin archivo", async () => {
    P470.preparar.mockResolvedValueOnce({ modo: "almacen", url: URL_FIRMADA_470 });
    const fetchMock = vi.fn(async () => new Response("expired", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    SUPERFICIES.tienda();
    await descargar(user);
    await waitFor(() => expect(H.toastError).toHaveBeenCalled());
    expect(String(H.toastError.mock.calls.at(-1)?.[0])).toContain("No se pudo leer el estado de cuenta para descargarlo.");
    expect(fetchMock).toHaveBeenCalledWith(URL_FIRMADA_470, expect.objectContaining({ credentials: "omit" }));
    expect(H.blob).not.toHaveBeenCalled();
  });

  it("R15: el almacén o la firma fallan en el servidor ⇒ aviso, sin archivo", async () => {
    P470.preparar.mockResolvedValueOnce({ status: "error", code: "INTERNAL", message: "Error interno" });
    const user = userEvent.setup();
    SUPERFICIES.tienda();
    await descargar(user);
    await waitFor(() => expect(H.toastError).toHaveBeenCalled());
    expect(String(H.toastError.mock.calls.at(-1)?.[0])).toContain("No se pudo leer el estado de cuenta para descargarlo.");
    expect(H.blob).not.toHaveBeenCalled();
  });
});
