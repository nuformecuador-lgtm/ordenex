import { describe, it, expect, vi, beforeEach } from "vitest";

import { FORMA_UUID, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.6; R3, R32) — LA DESCARGA DEL ESTADO DE CUENTA.
//
//  - R32: las MISMAS columnas que se ven, con el SALDO CORRIDO y la fila del SALDO INICIAL arriba; el
//    periodo filtrado ENTERO (periodo, chip y cierre), no la página visible.
//  - TD.6 (458-D, cierre de pantalla): el periodo entero sale de UNA lectura, la acción «completa» del
//    servidor (`verEstadoCuentaCompletoAction` / `verMiEstadoCuentaCompletoAction`), que aplica el
//    tope; por encima, `limite_excedido` y NO hay archivo: se dice con un aviso claro.
//  - R3: ninguna columna ni celda con un identificador; `ref`, `consolidacionId` y el `href` del origen
//    viajan y no salen.
// La lista de columnas se afirma LITERAL: es el contrato del archivo.
// Sustituye a `desglose-tienda-descarga-columnas.test.ts` y a los casos del desglose en
// `wallet-mensajero-descarga-columnas.test.ts` / `wallet-tienda-descarga-columnas.test.ts`.
// =================================================================================================

const verEstadoCuentaMock = vi.fn();
const verEstadoCuentaCompletoMock = vi.fn();
const verMiEstadoCuentaCompletoMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => verEstadoCuentaMock(...a),
  verEstadoCuentaCompletoAction: (...a: unknown[]) => verEstadoCuentaCompletoMock(...a),
  verMiEstadoCuentaAction: vi.fn(),
  verMiEstadoCuentaCompletoAction: (...a: unknown[]) => verMiEstadoCuentaCompletoMock(...a),
  verOrdenesDeFilaAction: vi.fn(),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));

import {
  COLUMNAS_DESCARGA_ESTADO_CUENTA,
  COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
  filaDescargaEstadoCuenta,
} from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import { filasDelPeriodo, lectorDeLaCuenta } from "@/components/shared/estado-cuenta/EstadoCuenta";
import { ROTULOS_TIENDA } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { LECTOR_MI_TIENDA, ROTULOS_MI_WALLET } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";
import { descargaConfig } from "@/lib/config/descarga";

const LECTOR_TIENDA = lectorDeLaCuenta({ tipo: "tienda", id: UUID_TIENDA });
const CIERRE = "5e1d2c3b-4a59-4687-8a9b-0c1d2e3f4a5b";

beforeEach(() => vi.clearAllMocks());

describe("R32 — las columnas del archivo son las de la pantalla, con el saldo corrido", () => {
  it("contrato: Fecha · Movimiento · Motivo · Origen · Cómo se pagó · Registró · Cargo · Abono · Saldo · Estado", () => {
    expect(COLUMNAS_DESCARGA_ESTADO_CUENTA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Movimiento",
      "Motivo",
      "Origen",
      "Cómo se pagó",
      "Registró",
      "Cargo",
      "Abono",
      "Saldo",
      "Estado",
    ]);
  });

  it("R34/R35 — `/mi-wallet`: las mismas SIN «Registró» (la tienda no ve los nombres de Ordenex)", () => {
    expect(COLUMNAS_DESCARGA_MI_ESTADO_CUENTA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Movimiento",
      "Motivo",
      "Origen",
      "Cómo se pagó",
      "Cargo",
      "Abono",
      "Saldo",
      "Estado",
    ]);
  });

  it("R3: ninguna clave de columna es un identificador", () => {
    for (const c of COLUMNAS_DESCARGA_ESTADO_CUENTA) expect(c.clave).not.toMatch(/(^id$|Id$|_id$)/);
  });
});

describe("R32 / TD.6 — el periodo ENTERO en UNA lectura, con el saldo inicial arriba", () => {
  it("pide el completo con periodo, chip y cierre vigentes; la primera fila es el saldo inicial", async () => {
    const filas = [
      ...Array.from({ length: 100 }, (_, i) => fila({ n: i + 1, saldoCorrido: `${i + 1}.00` })),
      fila({
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
        anulacion: { motivo: "Duplicado", por: "Ana Admin", fecha: "2026-09-15" },
      }),
    ];
    verEstadoCuentaCompletoMock.mockResolvedValue({
      status: "ok",
      estado: estado({ saldoInicial: "-5.00", filas, total: 101, page: 1, pageSize: 101 }),
    });

    const r = await filasDelPeriodo(
      LECTOR_TIENDA,
      { desde: "2026-09-01", hasta: "2026-09-30", chip: "pagos", cierreId: CIERRE },
      ROTULOS_TIENDA,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // UNA lectura, sin paginar: el tope lo aplica el servidor.
    expect(verEstadoCuentaCompletoMock).toHaveBeenCalledTimes(1);
    expect(verEstadoCuentaMock).not.toHaveBeenCalled();
    expect(verEstadoCuentaCompletoMock).toHaveBeenCalledWith({
      cuenta: { tipo: "tienda", id: UUID_TIENDA },
      desde: "2026-09-01",
      hasta: "2026-09-30",
      chip: "pagos",
      cierreId: CIERRE,
    });
    expect(r.filas).toHaveLength(102);
    expect(r.filas[0]).toEqual({
      fecha: "2026-09-01",
      movimiento: "Saldo inicial del periodo",
      motivo: null,
      origen: null,
      pago: null,
      registro: null,
      cargo: null,
      abono: null,
      saldo: "-5.00",
      estado: null,
    });
    // El monto CRUDO (sin símbolo): la hoja lo suma. El origen CON su entidad (458-D servidor), el
    // método y la referencia, y el estado de anulación, en palabras.
    expect(r.filas[101]).toEqual({
      fecha: "2026-09-14",
      movimiento: "Ordenex le paga a la tienda",
      motivo: "Quincena",
      origen: "Pago de Ordenex a una tienda · 2026-09-14 · SINPE",
      pago: "SINPE · referencia REF-77",
      registro: "Ana Admin",
      cargo: "40.00",
      abono: null,
      saldo: "60.00",
      estado: "Anulado el 2026-09-15 por Ana Admin · Duplicado",
    });
    // R3: ni una celda con forma de uuid, aunque cada fila traiga su `ref` y el origen su `href`.
    for (const f of r.filas) expect(JSON.stringify(f)).not.toMatch(FORMA_UUID);
  });

  it("`limite_excedido`: NO hay archivo y el aviso dice cuántos movimientos hay, el tope y qué hacer", async () => {
    verEstadoCuentaCompletoMock.mockResolvedValue({
      status: "limite_excedido",
      total: descargaConfig.MAX_FILAS + 1,
      limite: descargaConfig.MAX_FILAS,
    });
    const r = await filasDelPeriodo(LECTOR_TIENDA, {}, ROTULOS_TIENDA);
    expect(r).toEqual({
      status: "error",
      mensaje:
        `El estado de cuenta tiene ${descargaConfig.MAX_FILAS + 1} movimientos con estos filtros y la descarga ` +
        `admite hasta ${descargaConfig.MAX_FILAS}. Elegí un periodo más corto, un chip o un cierre y volvé a descargar.`,
    });
    expect(verEstadoCuentaCompletoMock).toHaveBeenCalledTimes(1);
  });

  it("si el servidor falla, error sin filas", async () => {
    verEstadoCuentaCompletoMock.mockResolvedValue({ status: "forbidden" });
    const r = await filasDelPeriodo(LECTOR_TIENDA, {}, ROTULOS_TIENDA);
    expect(r).toEqual({
      status: "error",
      mensaje: "No se pudo leer el estado de cuenta para descargarlo. Vuelve a intentarlo; el listado no cambió.",
    });
  });

  it("R36 — `/mi-wallet` lee SU completo sin ninguna clave de cuenta; lo lee desde la tienda", async () => {
    verMiEstadoCuentaCompletoMock.mockResolvedValue({
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
    });
    const r = await filasDelPeriodo(LECTOR_MI_TIENDA, { chip: "cobros" }, ROTULOS_MI_WALLET);
    expect(verMiEstadoCuentaCompletoMock).toHaveBeenCalledWith({ chip: "cobros" });
    expect(verEstadoCuentaCompletoMock).not.toHaveBeenCalled();
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.filas[1]).toMatchObject({ movimiento: "Ordenex te cobró", origen: "Registro a mano · Material" });
  });

  it("la proyección no lee nada que no esté en la línea ya rotulada", () => {
    expect(
      filaDescargaEstadoCuenta({
        fecha: "2026-09-12",
        movimiento: "Cobro",
        motivo: null,
        origen: null,
        pago: null,
        registro: null,
        cargo: "1.00",
        abono: null,
        saldo: "0.00",
        estado: null,
      }),
    ).toEqual({
      fecha: "2026-09-12",
      movimiento: "Cobro",
      motivo: null,
      origen: null,
      pago: null,
      registro: null,
      cargo: "1.00",
      abono: null,
      saldo: "0.00",
      estado: null,
    });
  });
});
