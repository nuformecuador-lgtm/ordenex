// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { SWRConfig } from "swr";
import ExcelJS from "exceljs";

import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import type { DetalleDeMovimientoLoteDTO } from "@/lib/types/detalle-en-lote";
import { UUID_MOV, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";
import {
  DISPARADOR_DETALLE,
  OPCION_CON_DETALLE,
  abrirSelectorDetalle,
  elegirSoloLosMovimientos,
} from "@/tests/fixtures/descarga-detalle-por-orden";
import { claveDeAmbitoDescarga } from "@/lib/columnas/preferencia-columnas";

// =================================================================================================
// FICHA 464 (T9) — LOS CUATRO ESTADOS DE CUENTA: selector de columnas en todos (R1/R2), el detalle por
// orden solo en la tienda (oficina) y en `/mi-wallet` (R6/R7), la línea del saldo inicial SIN número
// donde la pone el orden (R15), y una sola petición con detalle (R13/R36).
//
// Se montan las CUATRO superficies reales; lo que no es la descarga (acciones, pagos, conciliación) se
// sustituye por un hueco, porque aquí no se juzga.
// =================================================================================================

const H = vi.hoisted(() => ({
  ver: vi.fn(),
  completo: vi.fn(),
  conDetalle: vi.fn(),
  miVer: vi.fn(),
  miCompleto: vi.fn(),
  miConDetalle: vi.fn(),
  blob: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => H.ver(...a),
  verEstadoCuentaCompletoAction: (...a: unknown[]) => H.completo(...a),
  verEstadoCuentaCompletoConDetalleAction: (...a: unknown[]) => H.conDetalle(...a),
  verMiEstadoCuentaAction: (...a: unknown[]) => H.miVer(...a),
  verMiEstadoCuentaCompletoAction: (...a: unknown[]) => H.miCompleto(...a),
  verMiEstadoCuentaCompletoConDetalleAction: (...a: unknown[]) => H.miConDetalle(...a),
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

import { EstadoCuentaTienda } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { EstadoCuentaMensajero } from "@/app/(app)/wallet/mensajeros/_components/EstadoCuentaMensajero";
import { EstadoCuentaSatelite } from "@/app/(app)/wallet/satelites/_components/EstadoCuentaSatelite";
import { MiEstadoCuenta } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";

// Dos filas de la tienda: un cobro de COD de un cierre (con reparto) y un pago (sin reparto).
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
const TIENDA = estado({ filas: [PAGO, COD], total: 2, saldoInicial: "0.00" });
const DETALLE: DetalleDeMovimientoLoteDTO[] = [
  { movimientoId: UUID_MOV(2), modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
  {
    movimientoId: UUID_MOV(1),
    modo: "ordenes",
    cierre: { fecha: "2026-09-12T20:00:00.000Z", mensajeroNombre: "Mario Mensajero" },
    ordenes: [
      { guia: "1001", remision: "R-1", destinatario: "Ana", tiendaNombre: null, resultados: ["entregada"], aporte: "10.00" },
      { guia: "1002", remision: "R-2", destinatario: "Beto", tiendaNombre: null, resultados: ["entregada"], aporte: "20.00" },
    ],
    suma: "30.00",
    cuadra: true,
  },
];

function envolver(nodo: ReactElement) {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{nodo}</SWRConfig>);
}

const SUPERFICIES = {
  tienda: () => envolver(<EstadoCuentaTienda inicial={TIENDA} puedeRegistrar={false} />),
  miWallet: () =>
    envolver(<MiEstadoCuenta inicial={{ ...TIENDA, resumen: null }} cierres={{ opciones: [], hayMas: false, disponible: true }} />),
  mensajero: () =>
    envolver(
      <EstadoCuentaMensajero
        inicial={estado({ tipo: "mensajero", nombre: "Mario", filas: [fila({ libro: "mensajero", categoria: "liquidacion" })] })}
        puedeRegistrar={false}
      />,
    ),
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

const CABECERA_OFICINA = ["Fecha", "Movimiento", "Motivo", "Origen", "Cómo se pagó", "Registró", "Cargo", "Abono", "Saldo", "Estado"];
const CABECERA_TIENDA = ["Fecha", "Movimiento", "Motivo", "Origen", "Cómo se pagó", "Cargo", "Abono", "Saldo", "Estado"];

function completoOk(e: EstadoCuentaDTO) {
  return { status: "ok", estado: { ...e, page: 1, pageSize: e.filas.length } };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  H.ver.mockImplementation(async () => ({ status: "ok", estado: TIENDA }));
  H.miVer.mockImplementation(async () => ({ status: "ok", estado: TIENDA }));
  H.completo.mockImplementation(async () => completoOk(TIENDA));
  H.miCompleto.mockImplementation(async () => completoOk(TIENDA));
  H.conDetalle.mockImplementation(async () => ({ ...completoOk(TIENDA), detalle: DETALLE }));
  H.miConDetalle.mockImplementation(async () => ({ ...completoOk(TIENDA), detalle: DETALLE }));
});
afterEach(() => cleanup());

describe("464 R1/R6/R7 — qué ofrece cada estado de cuenta", () => {
  it("R6: la tienda (oficina) y /mi-wallet ofrecen el detalle por orden, y arrancan con él (R8)", async () => {
    for (const montar of [SUPERFICIES.tienda, SUPERFICIES.miWallet]) {
      const user = userEvent.setup();
      montar();
      await abrirSelectorDetalle(user);
      expect(screen.getByRole("radio", { name: OPCION_CON_DETALLE })).toBeChecked();
      cleanup();
    }
  });

  it("R1/R7: el mensajero y la bodega satélite tienen selector de columnas, pero SIN detalle por orden", () => {
    for (const montar of [SUPERFICIES.mensajero, SUPERFICIES.satelite]) {
      montar();
      expect(screen.getByRole("button", { name: "Elegir columnas de la descarga" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: DISPARADOR_DETALLE })).toBeNull();
      cleanup();
    }
  });
});

describe("464 R2/R4 — cada estado de cuenta con su ámbito y, sin tocar nada, las columnas de siempre", () => {
  it("mensajero y bodega bajan las columnas de siempre; ocultar una en el del mensajero no la oculta en la bodega", async () => {
    const user = userEvent.setup();
    H.completo.mockImplementation(async () =>
      completoOk(estado({ tipo: "mensajero", nombre: "Mario", filas: [fila({ libro: "mensajero" })] })),
    );
    SUPERFICIES.mensajero();
    await user.click(screen.getByRole("button", { name: /^Descargar Estado de cuenta/ }));
    expect((await archivo())[0].filas[0]).toEqual(CABECERA_OFICINA);

    // Se oculta «Motivo» en el del mensajero: queda en SU ámbito.
    await user.click(screen.getByRole("button", { name: "Elegir columnas de la descarga" }));
    await user.click(await screen.findByRole("checkbox", { name: "Motivo" }));
    await user.keyboard("{Escape}");
    expect(window.localStorage.getItem(claveDeAmbitoDescarga("wallet-mensajero-estado-cuenta"))).not.toBeNull();
    expect(window.localStorage.getItem(claveDeAmbitoDescarga("wallet-satelite-estado-cuenta"))).toBeNull();
    cleanup();

    H.blob.mockClear();
    SUPERFICIES.satelite();
    await user.click(screen.getByRole("button", { name: /^Descargar Estado de cuenta/ }));
    expect((await archivo())[0].filas[0]).toEqual(CABECERA_OFICINA);
  });

  it("R4/R9: con «Solo los movimientos», la tienda y /mi-wallet bajan la hoja de siempre por la lectura de siempre", async () => {
    for (const [montar, cabecera, completo, conDetalle] of [
      [SUPERFICIES.tienda, CABECERA_OFICINA, H.completo, H.conDetalle],
      [SUPERFICIES.miWallet, CABECERA_TIENDA, H.miCompleto, H.miConDetalle],
    ] as const) {
      const user = userEvent.setup();
      H.blob.mockClear();
      montar();
      await elegirSoloLosMovimientos(user);
      await user.click(screen.getByRole("button", { name: /^Descargar Estado de cuenta/ }));
      const hojas = await archivo();
      expect(hojas).toHaveLength(1);
      expect(hojas[0].filas[0]).toEqual(cabecera);
      expect(completo).toHaveBeenCalledTimes(1);
      expect(conDetalle).not.toHaveBeenCalled();
      cleanup();
    }
  });
});

describe("464 R10/R13/R15/R36 — con detalle", () => {
  it("tienda (oficina): UNA petición con la cuenta; el saldo inicial es la ÚLTIMA línea («Más recientes») y no lleva número", async () => {
    const user = userEvent.setup();
    SUPERFICIES.tienda();
    await user.click(screen.getByRole("button", { name: /^Descargar Estado de cuenta/ }));
    const hojas = await archivo();
    expect(H.conDetalle).toHaveBeenCalledTimes(1);
    expect(H.conDetalle).toHaveBeenCalledWith({ cuenta: { tipo: "tienda", id: UUID_TIENDA } });
    expect(H.completo).not.toHaveBeenCalled();

    const [movs, detalle] = hojas;
    // El nombre de la principal lo sanea el generador de siempre (31 caracteres como mucho).
    expect(hojas.map((h) => h.nombre)).toEqual(["Estado de cuenta de Tania Tien…", "Detalle por orden"]);
    expect(movs.filas[0]).toEqual(["N.º", ...CABECERA_OFICINA, "Detalle por orden"]);
    expect(movs.filas.slice(1).map((f) => [f[0], f[2], f.at(-1)])).toEqual([
      [1, expect.any(String), expect.stringContaining("no nace del cierre del día")],
      [2, expect.any(String), "2 órdenes"],
      [null, "Saldo inicial", null],
    ]);
    expect(detalle.filas[0]).toEqual([
      "N.º",
      "Fecha",
      "Movimiento",
      "Cierre del",
      "Mensajero",
      "Guía",
      "Remisión",
      "Destinatario",
      "Resultado",
      "Monto",
    ]);
    expect(detalle.filas.slice(1).map((f) => [f[0], f[1], f[2], f[4], f[5], f[9]])).toEqual([
      [2, "2026-09-12", movs.filas[2][2], "Mario Mensajero", "1001", "10.00"],
      [2, "2026-09-12", movs.filas[2][2], "Mario Mensajero", "1002", "20.00"],
    ]);
  });

  it("/mi-wallet con «Más antiguas»: el saldo inicial es la PRIMERA línea, sin número; ninguna cuenta viaja; sin mensajero", async () => {
    const user = userEvent.setup();
    SUPERFICIES.miWallet();
    await user.click(screen.getByRole("button", { name: "Más antiguas" }));
    await waitFor(() => expect(H.miVer).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /^Descargar Estado de cuenta/ }));
    const hojas = await archivo();
    expect(H.miConDetalle).toHaveBeenCalledWith({ sortBy: "fecha", sortDir: "asc" });
    const [movs, detalle] = hojas;
    expect(movs.filas[0]).toEqual(["N.º", ...CABECERA_TIENDA, "Detalle por orden"]);
    expect(movs.filas[1][0]).toBeNull();
    expect(movs.filas[1][2]).toBe("Saldo inicial");
    expect(movs.filas.slice(1).map((f) => f[0])).toEqual([null, 1, 2]);
    expect(detalle.filas[0]).not.toContain("Mensajero");
    expect(JSON.stringify(hojas)).not.toContain("Mario Mensajero");
  });

  it("R39/R43: el tope del detalle y una lectura que falla son un aviso y ningún archivo", async () => {
    const user = userEvent.setup();
    H.conDetalle.mockResolvedValueOnce({ status: "limite_excedido", hoja: "detalle", total: 9000, limite: 5000 });
    SUPERFICIES.tienda();
    const boton = screen.getByRole("button", { name: /^Descargar Estado de cuenta/ });
    await user.click(boton);
    await waitFor(() =>
      expect(H.toastError).toHaveBeenCalledWith(
        "El detalle por orden tendría 9000 filas y la descarga admite hasta 5000. Acota el periodo, o elige «Solo los movimientos» y vuelve a intentarlo.",
      ),
    );
    H.conDetalle.mockRejectedValueOnce(new Error("Failed to fetch"));
    await user.click(boton);
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(2));
    expect(H.toastError.mock.calls[1][0]).toContain("No se pudo leer el estado de cuenta para descargarlo.");
    expect(H.blob).not.toHaveBeenCalled();
  });
});
