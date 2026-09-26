import { describe, it, expect, vi, beforeEach } from "vitest";

import { FORMA_UUID, UUID_TIENDA, estado, fila } from "@/tests/fixtures/estado-cuenta";

// =================================================================================================
// FICHA 458-D (T D.6; R3, R32) — LA DESCARGA DEL ESTADO DE CUENTA.
//
//  - R32: las MISMAS columnas que se ven, con el SALDO CORRIDO y la fila del SALDO INICIAL arriba; el
//    periodo filtrado ENTERO (todas las páginas), no la visible.
//  - R3: ninguna columna ni celda con un identificador; `ref` y `consolidacionId` viajan y no salen.
//  - Por encima del tope de filas NO hay archivo (nunca uno al que le falten filas sin avisar).
// La lista de columnas se afirma LITERAL: es el contrato del archivo.
// Sustituye a `desglose-tienda-descarga-columnas.test.ts` y a los casos del desglose en
// `wallet-mensajero-descarga-columnas.test.ts` / `wallet-tienda-descarga-columnas.test.ts`.
// =================================================================================================

const verEstadoCuentaMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: (...a: unknown[]) => verEstadoCuentaMock(...a),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));

import {
  COLUMNAS_DESCARGA_ESTADO_CUENTA,
  filaDescargaEstadoCuenta,
} from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import { filasDelPeriodo } from "@/components/shared/estado-cuenta/EstadoCuenta";
import { ROTULOS_TIENDA } from "@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda";
import { descargaConfig } from "@/lib/config/descarga";

beforeEach(() => vi.clearAllMocks());

describe("R32 — las columnas del archivo son las de la pantalla, con el saldo corrido", () => {
  it("contrato: Fecha · Movimiento · Motivo · Origen · Registró · Cargo · Abono · Saldo · Estado", () => {
    expect(COLUMNAS_DESCARGA_ESTADO_CUENTA.map((c) => c.encabezado)).toEqual([
      "Fecha",
      "Movimiento",
      "Motivo",
      "Origen",
      "Registró",
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

describe("R32 — el periodo ENTERO, con el saldo inicial arriba", () => {
  it("pide TODAS las páginas del periodo y chip vigentes; la primera fila es el saldo inicial", async () => {
    const p1 = Array.from({ length: 100 }, (_, i) => fila({ n: i + 1, saldoCorrido: `${i + 1}.00` }));
    const p2 = [
      fila({
        n: 200,
        fecha: "2026-09-14",
        categoria: "pago_tienda",
        origenTipo: "pago_tienda",
        chip: "pagos",
        abono: null,
        cargo: "40.00",
        saldoCorrido: "60.00",
        descripcion: "Quincena",
        registro: { nombre: "Ana Admin", automatico: null },
        anulacion: { motivo: "Duplicado", por: "Ana Admin", fecha: "2026-09-15" },
      }),
    ];
    verEstadoCuentaMock.mockImplementation(async (i: { page: number }) => ({
      status: "ok",
      estado: estado({ saldoInicial: "-5.00", filas: i.page === 1 ? p1 : p2, total: 101, page: i.page, pageSize: 100 }),
    }));

    const r = await filasDelPeriodo(
      estado(),
      { desde: "2026-09-01", hasta: "2026-09-30" },
      "pagos",
      ROTULOS_TIENDA,
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(verEstadoCuentaMock).toHaveBeenCalledTimes(2);
    expect(verEstadoCuentaMock).toHaveBeenNthCalledWith(1, {
      cuenta: { tipo: "tienda", id: UUID_TIENDA },
      desde: "2026-09-01",
      hasta: "2026-09-30",
      chip: "pagos",
      page: 1,
      pageSize: 100,
    });
    expect(r.filas).toHaveLength(102);
    expect(r.filas[0]).toEqual({
      fecha: "2026-09-01",
      movimiento: "Saldo inicial del periodo",
      motivo: null,
      origen: null,
      registro: null,
      cargo: null,
      abono: null,
      saldo: "-5.00",
      estado: null,
    });
    // El monto CRUDO (sin símbolo): la hoja lo suma. El estado de anulación, en palabras.
    expect(r.filas[101]).toEqual({
      fecha: "2026-09-14",
      movimiento: "Ordenex le paga a la tienda",
      motivo: "Quincena",
      origen: "Pago de Ordenex a una tienda",
      registro: "Ana Admin",
      cargo: "40.00",
      abono: null,
      saldo: "60.00",
      estado: "Anulado el 2026-09-15 por Ana Admin · Duplicado",
    });
    // R3: ni una celda con forma de uuid, aunque cada fila del servidor traiga su `ref`.
    for (const f of r.filas) expect(JSON.stringify(f)).not.toMatch(FORMA_UUID);
  });

  it("por encima del tope NO hay archivo: se dice cuántas filas hay y cuál es el tope", async () => {
    verEstadoCuentaMock.mockResolvedValue({
      status: "ok",
      estado: estado({ total: descargaConfig.MAX_FILAS + 1 }),
    });
    const r = await filasDelPeriodo(estado(), { desde: "", hasta: "" }, "todo", ROTULOS_TIENDA);
    expect(r.status).toBe("error");
    expect(verEstadoCuentaMock).toHaveBeenCalledTimes(1);
    if (r.status === "error") expect(r.mensaje).toContain(String(descargaConfig.MAX_FILAS));
  });

  it("si el servidor falla, error sin filas", async () => {
    verEstadoCuentaMock.mockResolvedValue({ status: "forbidden" });
    const r = await filasDelPeriodo(estado(), { desde: "", hasta: "" }, "todo", ROTULOS_TIENDA);
    expect(r).toEqual({
      status: "error",
      mensaje: "No se pudo leer el estado de cuenta para descargarlo. Vuelve a intentarlo; el listado no cambió.",
    });
  });

  it("la proyección no lee nada que no esté en la línea ya rotulada", () => {
    expect(
      filaDescargaEstadoCuenta({
        fecha: "2026-09-12",
        movimiento: "Cobro",
        motivo: null,
        origen: null,
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
      registro: null,
      cargo: "1.00",
      abono: null,
      saldo: "0.00",
      estado: null,
    });
  });
});
