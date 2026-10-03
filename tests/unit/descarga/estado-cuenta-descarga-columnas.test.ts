import { describe, it, expect, vi, beforeEach } from "vitest";

import { FORMA_UUID, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";
import type { KardexDTO } from "@/lib/types/libro-kardex";

// =================================================================================================
// FICHA 458-D (T D.6; R3, R32) → FICHA 468 (T12/T13; R2, R3, R5–R9, R11, R13, R16, R18, R57) — LA
// DESCARGA DEL ESTADO DE CUENTA.
//
//  - 458-D R32: el periodo filtrado ENTERO (periodo, chip, cierre y término), no la página visible, en
//    UNA lectura del servidor, que aplica el tope; por encima no hay archivo y se dice con un aviso.
//  - 468: la lectura es la del KARDEX (`estadoCuentaKardexAction` / `miEstadoCuentaKardexAction`), SIEMPRE
//    en orden cronológico ascendente (R7); la hoja es Fecha · Concepto · Detalle · Entra · Sale · Saldo ·
//    Registró (R2; sin «Registró» en `/mi-wallet`, R3), con «Saldo al inicio del periodo» arriba (R5) y
//    «Total del periodo» abajo (R8), los montos en la columna que decidió el servidor (R9) y el saldo
//    corrido del servidor (R11).
//  - 458-D R3: ninguna columna ni celda con un identificador; `ref`, `consolidacionId` y el `href` del
//    origen viajan y no salen.
// La lista de columnas se afirma LITERAL: es el contrato del archivo.
// =================================================================================================

const verEstadoCuentaMock = vi.fn();
const kardexMock = vi.fn();
const kardexConDetalleMock = vi.fn();
const miKardexMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => verEstadoCuentaMock(...a),
  estadoCuentaKardexAction: (...a: unknown[]) => kardexMock(...a),
  estadoCuentaKardexConDetalleAction: (...a: unknown[]) => kardexConDetalleMock(...a),
  verMiEstadoCuentaAction: vi.fn(),
  miEstadoCuentaKardexAction: (...a: unknown[]) => miKardexMock(...a),
  miEstadoCuentaKardexConDetalleAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));

import {
  COLUMNAS_DESCARGA_ESTADO_CUENTA,
  COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
} from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import { filasDelPeriodo, lectorDeLaCuenta } from "@/components/shared/estado-cuenta/EstadoCuenta";
import { ROTULOS_TIENDA } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { LECTOR_MI_TIENDA, ROTULOS_MI_WALLET } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";
import { descargaConfig } from "@/lib/config/descarga";

const LECTOR_TIENDA = lectorDeLaCuenta({ tipo: "tienda", id: UUID_TIENDA });
const LECTOR_BODEGA = lectorDeLaCuenta({ tipo: "bodega", id: UUID_TIENDA });
const CIERRE = "5e1d2c3b-4a59-4687-8a9b-0c1d2e3f4a5b";

/** Un kardex del servidor para N filas (los números son los que el servidor decidió; aquí, fijos). */
function kardex(filas: KardexDTO["filas"], extra: Partial<KardexDTO> = {}): KardexDTO {
  return {
    saldoInicial: "-5.00",
    saldoFinal: "60.00",
    totales: { entra: "100.00", sale: "40.00", cobradoATiendas: null },
    conOtrosFiltros: false,
    filas,
    ...extra,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("468 R2/R3 — las columnas del archivo", () => {
  it("contrato (R2): Fecha · Concepto · Detalle · Entra · Sale · Saldo · Registró", () => {
    expect(COLUMNAS_DESCARGA_ESTADO_CUENTA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Concepto",
      "Detalle",
      "Entra",
      "Sale",
      "Saldo",
      "Registró",
    ]);
  });

  it("R3 (458-D R34/R35) — `/mi-wallet`: las mismas SIN «Registró» (la tienda no ve los nombres de Ordenex)", () => {
    expect(COLUMNAS_DESCARGA_MI_ESTADO_CUENTA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Concepto",
      "Detalle",
      "Entra",
      "Sale",
      "Saldo",
    ]);
  });

  it("458-D R3: ninguna clave de columna es un identificador", () => {
    for (const c of COLUMNAS_DESCARGA_ESTADO_CUENTA) expect(c.clave).not.toMatch(/(^id$|Id$|_id$)/);
  });
});

describe("468 / 458-D R32 — el periodo ENTERO en UNA lectura del kardex, en orden cronológico", () => {
  it("R7: pide el kardex con periodo, chip, cierre y término vigentes y el orden ascendente; saldo inicial arriba, total abajo", async () => {
    const pago = fila({
      n: 200,
      fecha: "2026-09-14",
      categoria: "pago_tienda",
      origenTipo: "pago_tienda",
      origen: {
        texto: "Pago de Ordenex a una tienda · 2026-09-14 · SINPE",
        enlace: { etiqueta: "Ver el pago", href: `/wallet/tiendas/${UUID_TIENDA}` },
      },
      pago: { metodo: "SINPE", referencia: "REF-77" },
      chip: "pagos",
      abono: null,
      cargo: "40.00",
      saldoCorrido: "60.00",
      descripcion: "Quincena",
      registro: { nombre: "Ana Admin", automatico: null },
      anulacion: { motivo: "Duplicado", por: "Ana Admin", fecha: "2026-09-15", hora: "10:30" },
    });
    const filas = [fila({ n: 1, saldoCorrido: "100.00" }), pago];
    kardexMock.mockResolvedValue({
      status: "ok",
      estado: estado({ saldoInicial: "-5.00", filas, total: 2, page: 1, pageSize: 2 }),
      kardex: kardex(
        [
          { monto: { columna: "entra", monto: "100.00" }, saldo: "100.00", ordenes: 2 },
          { monto: { columna: "sale", monto: "40.00" }, saldo: "60.00", ordenes: null },
        ],
        { conOtrosFiltros: true },
      ),
    });

    const r = await filasDelPeriodo(
      LECTOR_TIENDA,
      { desde: "2026-09-01", hasta: "2026-09-30", chip: "pagos", cierreId: CIERRE, q: "quincena", sortBy: "fecha", sortDir: "desc" },
      ROTULOS_TIENDA,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // UNA lectura, sin paginar: el tope lo aplica el servidor. El orden se fuerza a ascendente (R7).
    expect(kardexMock).toHaveBeenCalledTimes(1);
    expect(verEstadoCuentaMock).not.toHaveBeenCalled();
    expect(kardexConDetalleMock).not.toHaveBeenCalled();
    expect(kardexMock).toHaveBeenCalledWith({
      cuenta: { tipo: "tienda", id: UUID_TIENDA },
      desde: "2026-09-01",
      hasta: "2026-09-30",
      chip: "pagos",
      cierreId: CIERRE,
      q: "quincena",
      sortBy: "fecha",
      sortDir: "asc",
    });
    // Saldo inicial + 2 movimientos + total + aviso de filtros (R16).
    expect(r.filas).toHaveLength(5);
    expect(r.filasDestacadas).toEqual([0, 3]);
    expect(r.filas[0]).toEqual({
      fecha: "2026-09-01",
      concepto: "Saldo al inicio del periodo",
      detalle: null,
      entra: null,
      sale: null,
      cobradoATiendas: null,
      saldo: "-5.00",
    });
    // El monto CRUDO en SU columna (R9), el saldo corrido del servidor (R11) y, en «Detalle» (R18), el
    // origen con su entidad, la descripción, el pago y el estado de anulación, en palabras.
    expect(r.filas[2]).toEqual({
      fecha: "2026-09-14",
      concepto: "Ordenex le paga a la tienda",
      detalle:
        "Pago de Ordenex a una tienda · 2026-09-14 · SINPE · Quincena · SINPE · referencia REF-77 · Anulado el 2026-09-15 por Ana Admin · Duplicado",
      registro: "Ana Admin",
      entra: null,
      sale: "40.00",
      cobradoATiendas: null,
      saldo: "60.00",
    });
    expect(String(r.filas[1].detalle)).toMatch(/ · 2 guías$/);
    expect(r.filas[3]).toMatchObject({ concepto: "Total del periodo", entra: "100.00", sale: "40.00", saldo: "60.00" });
    expect(r.filas[4].concepto).toBe(
      "Con filtros: Entra y Sale suman solo los movimientos de esta hoja; el saldo es el de toda la cuenta.",
    );
    // 458-D R3: ni una celda con forma de uuid, aunque cada fila traiga su `ref` y el origen su `href`.
    for (const f of r.filas) expect(JSON.stringify(f)).not.toMatch(FORMA_UUID);
  });

  it("`limite_excedido`: NO hay archivo y el aviso dice cuántos movimientos hay, el tope y qué hacer", async () => {
    kardexMock.mockResolvedValue({
      status: "limite_excedido",
      hoja: "movimientos",
      total: descargaConfig.MAX_FILAS + 1,
      limite: descargaConfig.MAX_FILAS,
    });
    const r = await filasDelPeriodo(LECTOR_TIENDA, {}, ROTULOS_TIENDA);
    expect(r).toEqual({
      status: "error",
      mensaje:
        `El estado de cuenta tiene ${descargaConfig.MAX_FILAS + 1} movimientos con estos filtros y la descarga ` +
        `admite hasta ${descargaConfig.MAX_FILAS}. Elegí un periodo más corto, un tipo de movimiento o un cierre y volvé a descargar.`,
    });
    expect(kardexMock).toHaveBeenCalledTimes(1);
  });

  it("si el servidor falla, error sin filas", async () => {
    kardexMock.mockResolvedValue({ status: "forbidden" });
    const r = await filasDelPeriodo(LECTOR_TIENDA, {}, ROTULOS_TIENDA);
    expect(r).toEqual({
      status: "error",
      mensaje: "No se pudo leer el estado de cuenta para descargarlo. Vuelve a intentarlo; el listado no cambió.",
    });
  });

  it("R25: la bodega satélite no tiene lector con detalle (su libro son consolidaciones)", () => {
    expect(LECTOR_BODEGA.leerKardexConDetalle).toBeUndefined();
    expect(LECTOR_TIENDA.leerKardexConDetalle).toBeDefined();
    expect(lectorDeLaCuenta({ tipo: "mensajero", id: UUID_TIENDA }).leerKardexConDetalle).toBeDefined();
  });

  it("458-D R36 — `/mi-wallet` lee SU kardex sin ninguna clave de cuenta; lo lee desde la tienda", async () => {
    miKardexMock.mockResolvedValue({
      status: "ok",
      estado: estado({
        filas: [
          fila({
            categoria: "cobro_manual",
            origenTipo: "manual",
            origen: { texto: "Registro a mano · Material", enlace: null },
            chip: "cobros",
            abono: null,
            cargo: "500.00",
            saldoCorrido: "500.00",
            registro: { nombre: null, automatico: null },
          }),
        ],
      }),
      kardex: kardex([{ monto: { columna: "sale", monto: "500.00" }, saldo: "500.00", ordenes: null }]),
    });
    const r = await filasDelPeriodo(LECTOR_MI_TIENDA, { chip: "cobros" }, ROTULOS_MI_WALLET);
    expect(miKardexMock).toHaveBeenCalledWith({ chip: "cobros", sortBy: "fecha", sortDir: "asc" });
    expect(kardexMock).not.toHaveBeenCalled();
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.filas[1]).toMatchObject({ concepto: "Ordenex te cobró", detalle: "Registro a mano · Material", sale: "500.00" });
  });
});
