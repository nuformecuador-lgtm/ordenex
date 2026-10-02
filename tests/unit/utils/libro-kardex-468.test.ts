import { describe, it, expect } from "vitest";

import type { EstadoCuentaDTO, FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED, type WalletMovimientoCategoria } from "@/lib/types/wallet";
import { CATEGORIAS_EFECTIVO, columnaDeCaja } from "@/lib/utils/caja-kardex";
import { LIQUIDEZ_POR_CATEGORIA } from "@/lib/utils/caja-tesoreria";
import { columnaDeCuenta, kardexDeCuenta, ladoQueSube } from "@/lib/utils/estado-cuenta-kardex";
import { afirmarCuadreDelKardex, totalesDe } from "@/lib/utils/libro-kardex";

// Ficha 468 (T5/T6, design §3.1) — la columna de cada fila (R9/R10), los totales (R8) y la afirmacion
// del saldo corrido (R15), puros.

const tipoDe = (c: WalletMovimientoCategoria) => (c.startsWith("ingreso_") ? "ingreso" : "egreso") as "ingreso" | "egreso";

describe("468 — R10: la columna de cada concepto de la caja, recorriendo el SEED entero", () => {
  it("R10: efectivo → Entra/Sale por su tipo; cargo → «Cobrado a tiendas» positivo; reverso de cargo → negativo", () => {
    let cargos = 0;
    let reversos = 0;
    let efectivo = 0;
    for (const categoria of WALLET_MOVIMIENTO_CATEGORIA_SEED) {
      const tipo = tipoDe(categoria);
      const c = columnaDeCaja({ categoria, tipo, monto: "1500.25" });
      if (LIQUIDEZ_POR_CATEGORIA[categoria] === "efectivo") {
        expect(c, categoria).toEqual({ columna: tipo === "ingreso" ? "entra" : "sale", monto: "1500.25" });
        efectivo += 1;
      } else if (tipo === "ingreso") {
        expect(c, categoria).toEqual({ columna: "cobrado_a_tiendas", monto: "1500.25" });
        cargos += 1;
      } else {
        expect(c, categoria).toEqual({ columna: "cobrado_a_tiendas", monto: "-1500.25" });
        reversos += 1;
      }
    }
    // No-vacuidad: las tres ramas existen (7 cargos, 3 reversos y el resto efectivo, ficha 459/461/458-B).
    expect({ cargos, reversos }).toEqual({ cargos: 7, reversos: 3 });
    expect(efectivo).toBe(WALLET_MOVIMIENTO_CATEGORIA_SEED.length - 10);
    expect([...CATEGORIAS_EFECTIVO].sort()).toEqual(
      WALLET_MOVIMIENTO_CATEGORIA_SEED.filter((c) => LIQUIDEZ_POR_CATEGORIA[c] === "efectivo").sort(),
    );
  });

  it("R10: el flete es «Cobrado a tiendas» (no mueve el saldo) y el contra-entrega es «Entra»", () => {
    expect(columnaDeCaja({ categoria: "ingreso_flete", tipo: "ingreso", monto: "1000.00" }).columna).toBe("cobrado_a_tiendas");
    expect(columnaDeCaja({ categoria: "ingreso_cod_recaudado", tipo: "ingreso", monto: "1000.00" }).columna).toBe("entra");
    expect(columnaDeCaja({ categoria: "egreso_pago_mensajero", tipo: "egreso", monto: "1000.00" }).columna).toBe("sale");
  });
});

describe("468 — R9: la columna de cada fila de un estado de cuenta", () => {
  it("R9: tienda y mensajero — el abono sube el saldo (Entra) y el cargo lo baja (Sale)", () => {
    for (const tipo of ["tienda", "mensajero"] as const) {
      expect(ladoQueSube(tipo)).toBe("abono");
      expect(columnaDeCuenta({ abono: "10.00", cargo: null }, ladoQueSube(tipo))).toEqual({ columna: "entra", monto: "10.00" });
      expect(columnaDeCuenta({ abono: null, cargo: "4.00" }, ladoQueSube(tipo))).toEqual({ columna: "sale", monto: "4.00" });
    }
  });

  it("R9: bodega — lo declarado sube lo que tiene por entregar (Entra) y lo recibido lo baja (Sale)", () => {
    expect(ladoQueSube("bodega")).toBe("cargo");
    expect(columnaDeCuenta({ abono: null, cargo: "700.00" }, "cargo")).toEqual({ columna: "entra", monto: "700.00" });
    expect(columnaDeCuenta({ abono: "300.00", cargo: null }, "cargo")).toEqual({ columna: "sale", monto: "300.00" });
  });
});

function fila(over: Partial<FilaEstadoCuentaDTO>): FilaEstadoCuentaDTO {
  return {
    ref: null,
    consolidacionId: null,
    fecha: "2026-10-01",
    categoria: "x",
    origenTipo: "manual",
    origen: null,
    pago: null,
    descripcion: null,
    registro: { nombre: null, automatico: null },
    cargo: null,
    abono: null,
    saldoCorrido: "0.00",
    chip: "flete" as FilaEstadoCuentaDTO["chip"],
    anulacion: null,
    esContraAsiento: false,
    tieneComprobante: false,
    anulable: false,
    naceDeUnCierre: false,
    ...over,
  };
}

function estado(tipo: "tienda" | "bodega", filas: FilaEstadoCuentaDTO[], saldoInicial: string, saldoFinal: string): EstadoCuentaDTO {
  return {
    cuenta: { tipo, id: "c", nombre: "Cuenta" },
    saldoActual: saldoFinal,
    signo: "positivo",
    sentido: "ordenex_debe",
    saldoInicial,
    abonos: "0.00",
    cargos: "0.00",
    saldoFinal,
    resumen: null,
    filas,
    total: filas.length,
    page: 1,
    pageSize: filas.length,
  };
}

describe("468 — R8/R11/R13/R15: el kardex de una cuenta", () => {
  it("R11/R13/R8: saldo por fila = saldoCorrido; inicial y final de la tarjeta; totales por columna", () => {
    const e = estado(
      "tienda",
      [fila({ abono: "100.00", saldoCorrido: "150.00" }), fila({ cargo: "30.00", saldoCorrido: "120.00" })],
      "50.00",
      "120.00",
    );
    const k = kardexDeCuenta(e, false, [3, null]);
    expect(k).toEqual({
      saldoInicial: "50.00",
      saldoFinal: "120.00",
      totales: { entra: "100.00", sale: "30.00", cobradoATiendas: null },
      conOtrosFiltros: false,
      filas: [
        { monto: { columna: "entra", monto: "100.00" }, saldo: "150.00", ordenes: 3 },
        { monto: { columna: "sale", monto: "30.00" }, saldo: "120.00", ordenes: null },
      ],
    });
  });

  it("R15: sin otros filtros, un saldo que no cuadra fila a fila LANZA (no sale un archivo mentiroso)", () => {
    const e = estado("tienda", [fila({ abono: "100.00", saldoCorrido: "149.99" })], "50.00", "149.99");
    expect(() => kardexDeCuenta(e, false, [null])).toThrow(/fila 1 no cuadra/);
  });

  it("R15: un saldo final distinto de inicial + entra − sale LANZA", () => {
    const e = estado("tienda", [fila({ abono: "100.00", saldoCorrido: "150.00" })], "50.00", "151.00");
    expect(() => kardexDeCuenta(e, false, [null])).toThrow(/saldo final no cuadra/);
  });

  it("R16: con otros filtros NO se afirma (el saldo es el de la cuenta entera y Entra suma solo lo filtrado)", () => {
    const e = estado("tienda", [fila({ abono: "100.00", saldoCorrido: "999.00" })], "50.00", "1200.00");
    expect(kardexDeCuenta(e, true, [null]).conOtrosFiltros).toBe(true);
  });

  it("R9/R15: en la bodega, lo declarado (cargo) sube el saldo y cuadra", () => {
    const e = estado(
      "bodega",
      [fila({ cargo: "700.00", saldoCorrido: "700.00" }), fila({ abono: "300.00", saldoCorrido: "400.00" })],
      "0.00",
      "400.00",
    );
    expect(kardexDeCuenta(e, false, [null, null]).totales).toEqual({ entra: "700.00", sale: "300.00", cobradoATiendas: null });
  });

  it("R15 (caja): «Cobrado a tiendas» no mueve el saldo; los reversos negativos tampoco", () => {
    const filas = [
      { monto: { columna: "entra" as const, monto: "1000.00" }, saldo: "1000.00" },
      { monto: { columna: "cobrado_a_tiendas" as const, monto: "150.00" }, saldo: "1000.00" },
      { monto: { columna: "cobrado_a_tiendas" as const, monto: "-150.00" }, saldo: "1000.00" },
      { monto: { columna: "sale" as const, monto: "250.50" }, saldo: "749.50" },
    ];
    const totales = totalesDe(
      filas.map((f) => f.monto),
      true,
    );
    expect(totales).toEqual({ entra: "1000.00", sale: "250.50", cobradoATiendas: "0.00" });
    expect(() => afirmarCuadreDelKardex({ saldoInicial: "0.00", saldoFinal: "749.50", totales, filas }, "caja")).not.toThrow();
    expect(() => totalesDe([{ columna: "cobrado_a_tiendas", monto: "1.00" }], false)).toThrow(/fuera de la caja/);
  });
});
