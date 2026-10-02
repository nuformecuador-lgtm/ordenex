import { describe, it, expect } from "vitest";

import type { DetalleDeMovimientoLoteDTO, OrdenDelLoteDTO } from "@/lib/types/detalle-en-lote";
import type { MontoEnColumna, TotalesPorColumna } from "@/lib/types/libro-kardex";
import { agruparPorGuia } from "@/lib/utils/detalle-por-guia";
import { totalesDe } from "@/lib/utils/libro-kardex";

// Ficha 468 (T8, design §4.2) — la hoja «Detalle por guía» agrupada, regla por regla (R33–R46).

const C1 = "2026-09-10T18:00:00.000Z";
const C2 = "2026-09-11T18:00:00.000Z";

function orden(clave: string, guia: string | null, aporte: string, over: Partial<OrdenDelLoteDTO> = {}): OrdenDelLoteDTO {
  return {
    clave,
    guia,
    remision: `REM-${clave}`,
    destinatario: `Dest ${clave}`,
    tiendaNombre: "Tienda Uno",
    resultados: ["entregado"],
    aporte,
    ...over,
  };
}

function conOrdenes(movimientoId: string, fecha: string, ordenes: OrdenDelLoteDTO[], mensajero = "Mario"): DetalleDeMovimientoLoteDTO {
  return { movimientoId, modo: "ordenes", cierre: { fecha, mensajeroNombre: mensajero }, ordenes, suma: "0.00", cuadra: true };
}

const entra = (monto: string): MontoEnColumna => ({ columna: "entra", monto });
const sale = (monto: string): MontoEnColumna => ({ columna: "sale", monto });
const cobrado = (monto: string): MontoEnColumna => ({ columna: "cobrado_a_tiendas", monto });

function hoja1(movs: Array<{ id: string; monto: MontoEnColumna }>, conCobrado = true): TotalesPorColumna {
  return totalesDe(
    movs.map((m) => m.monto),
    conCobrado,
  );
}

describe("468 — R33–R39: los bloques de guia", () => {
  it("R35/R36/R38/R39: una guia en dos cierres es UN bloque, con sus dos dias y la cabecera del mas reciente", () => {
    const movs = [
      { id: "flete-c1", monto: cobrado("1000.00") },
      { id: "pago-c2", monto: sale("500.00") },
    ];
    const r = agruparPorGuia({
      movimientos: movs,
      detalle: [
        conOrdenes("flete-c1", C1, [orden("o1", "501", "1000.00", { destinatario: "Viejo", resultados: ["reprogramado"] })], "Ana"),
        conOrdenes("pago-c2", C2, [orden("o1", "501", "500.00", { destinatario: "Nuevo", resultados: ["entregado"] })], "Beto"),
      ],
      totalesHoja1: hoja1(movs),
    });
    expect(r.bloques).toHaveLength(1);
    const b = r.bloques[0];
    expect(b.cierres).toEqual([C1, C2]); // R38
    expect(b.destinatario).toBe("Nuevo"); // R39: el del cierre mas reciente
    expect(b.mensajeroNombre).toBe("Beto");
    expect(b.resultados).toEqual(["reprogramado", "entregado"]);
    // R35: cada fila en la columna de SU movimiento.
    expect(b.filas.map((f) => [f.movimientoId, f.cierreFecha, f.monto])).toEqual([
      ["flete-c1", C1, cobrado("1000.00")],
      ["pago-c2", C2, sale("500.00")],
    ]);
    expect(b.total).toEqual({ entra: "0.00", sale: "500.00", cobradoATiendas: "1000.00" }); // R36
    expect(r.sinGuia).toEqual([]);
  });

  it("R37: bloques por guia numerica SIN Number («9» < «10» < «100»), y las sin guia al final por remision", () => {
    const movs = [{ id: "m", monto: entra("60.00") }];
    const r = agruparPorGuia({
      movimientos: movs,
      detalle: [
        conOrdenes("m", C1, [
          orden("b", null, "10.00", { remision: "R-B" }),
          orden("x", "100", "10.00"),
          orden("y", "10", "10.00"),
          orden("a", null, "10.00", { remision: "R-A" }),
          orden("z", "9", "10.00"),
          orden("w", "11", "10.00"),
        ]),
      ],
      totalesHoja1: hoja1(movs),
    });
    expect(r.bloques.map((b) => b.guia ?? `sin:${b.remision}`)).toEqual(["9", "10", "11", "100", "sin:R-A", "sin:R-B"]);
  });

  it("R37: dentro del bloque, por dia del cierre y, a igual dia, en el orden de la hoja 1", () => {
    const movs = [
      { id: "iva-c2", monto: cobrado("13.00") },
      { id: "flete-c2", monto: cobrado("100.00") },
      { id: "flete-c1", monto: cobrado("100.00") },
    ];
    const r = agruparPorGuia({
      movimientos: movs,
      detalle: [
        conOrdenes("iva-c2", C2, [orden("o1", "501", "13.00")]),
        conOrdenes("flete-c2", C2, [orden("o1", "501", "100.00")]),
        conOrdenes("flete-c1", C1, [orden("o1", "501", "100.00")]),
      ],
      totalesHoja1: hoja1(movs),
    });
    expect(r.bloques[0].filas.map((f) => f.movimientoId)).toEqual(["flete-c1", "iva-c2", "flete-c2"]);
  });

  it("R35: una orden con DOS gestiones aporta una sola fila con su suma (la del lote) y sus dos resultados", () => {
    const movs = [{ id: "cod", monto: entra("3000.00") }];
    const r = agruparPorGuia({
      movimientos: movs,
      detalle: [conOrdenes("cod", C1, [orden("o2", "502", "3000.00", { resultados: ["reprogramado", "entregado"] })])],
      totalesHoja1: hoja1(movs),
    });
    expect(r.bloques[0].filas).toHaveLength(1);
    expect(r.bloques[0].filas[0].resultados).toEqual(["reprogramado", "entregado"]);
  });
});

describe("468 — R40–R46: «Movimientos sin guía», diferencias y TOTAL GENERAL", () => {
  it("R40/R46: un movimiento no repartible sale EXACTAMENTE una vez, con su monto en su columna y su motivo", () => {
    const movs = [
      { id: "gasto", monto: sale("250.00") },
      { id: "efectivo", monto: sale("90.00") },
    ];
    const r = agruparPorGuia({
      movimientos: movs,
      detalle: [
        { movimientoId: "gasto", modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
        { movimientoId: "efectivo", modo: "sin_reparto", motivo: "snapshot_del_cierre" },
      ],
      totalesHoja1: hoja1(movs),
    });
    expect(r.bloques).toEqual([]);
    expect(r.sinGuia).toEqual([
      { tipo: "movimiento", movimientoId: "gasto", motivo: "no_nace_de_un_cierre", monto: sale("250.00") },
      { tipo: "movimiento", movimientoId: "efectivo", motivo: "snapshot_del_cierre", monto: sale("90.00") },
    ]);
  });

  it("R41: si las guias no llegan al importe, la diferencia (monto − suma) sale en la columna del movimiento", () => {
    const movs = [{ id: "pago", monto: sale("1000.00") }];
    const r = agruparPorGuia({
      movimientos: movs,
      detalle: [conOrdenes("pago", C1, [orden("o1", "501", "400.00"), orden("o2", "502", "350.50")])],
      totalesHoja1: hoja1(movs),
    });
    expect(r.sinGuia).toEqual([
      { tipo: "diferencia", movimientoId: "pago", cierreFecha: C1, montoMovimiento: "1000.00", sumaGuias: "750.50", monto: sale("249.50") },
    ]);
    expect(r.totalGeneral).toEqual({ entra: "0.00", sale: "1000.00", cobradoATiendas: "0.00" });
  });

  it("R42: un repartible sin ninguna guia da su importe ENTERO como diferencia", () => {
    const movs = [{ id: "ind", monto: sale("12000.00") }];
    const r = agruparPorGuia({ movimientos: movs, detalle: [conOrdenes("ind", C1, [])], totalesHoja1: hoja1(movs) });
    expect(r.sinGuia).toEqual([
      { tipo: "diferencia", movimientoId: "ind", cierreFecha: C1, montoMovimiento: "12000.00", sumaGuias: "0.00", monto: sale("12000.00") },
    ]);
  });

  it("R35: un reverso de cargo (negativo en «Cobrado a tiendas») niega sus aportes y cuadra", () => {
    const movs = [{ id: "rev", monto: cobrado("-500.00") }];
    const r = agruparPorGuia({ movimientos: movs, detalle: [conOrdenes("rev", C1, [orden("o1", "501", "500.00")])], totalesHoja1: hoja1(movs) });
    expect(r.bloques[0].filas[0].monto).toEqual(cobrado("-500.00"));
    expect(r.sinGuia).toEqual([]);
  });

  it("R44/R45: el TOTAL GENERAL = Σ filas de concepto + sin guia + diferencias = el total de la hoja 1, en las tres columnas", () => {
    const movs = [
      { id: "cod", monto: entra("5000.00") },
      { id: "flete", monto: cobrado("2000.00") },
      { id: "pago", monto: sale("900.00") },
      { id: "gasto", monto: sale("100.00") },
    ];
    const r = agruparPorGuia({
      movimientos: movs,
      detalle: [
        conOrdenes("cod", C1, [orden("o1", "501", "3000.00"), orden("o2", "502", "2000.00")]),
        conOrdenes("flete", C1, [orden("o1", "501", "1000.00"), orden("o2", "502", "1000.00")]),
        conOrdenes("pago", C1, [orden("o1", "501", "500.00")]),
        { movimientoId: "gasto", modo: "sin_reparto", motivo: "no_nace_de_un_cierre" },
      ],
      totalesHoja1: hoja1(movs),
    });
    expect(r.totalGeneral).toEqual({ entra: "5000.00", sale: "1000.00", cobradoATiendas: "2000.00" });
    expect(r.totalGeneral).toEqual(hoja1(movs));
    // Los «Total de la guía» NO entran: sumarlos daria el doble.
    expect(r.bloques.map((b) => b.total)).toEqual([
      { entra: "3000.00", sale: "500.00", cobradoATiendas: "1000.00" },
      { entra: "2000.00", sale: "0.00", cobradoATiendas: "1000.00" },
    ]);
    expect(r.sinGuia.map((f) => f.tipo)).toEqual(["diferencia", "movimiento"]);
  });

  it("R45: si la construccion se rompe (totales de la hoja 1 que no casan), se LANZA y no sale archivo", () => {
    const movs = [{ id: "pago", monto: sale("1000.00") }];
    expect(() =>
      agruparPorGuia({
        movimientos: movs,
        detalle: [conOrdenes("pago", C1, [orden("o1", "501", "400.00")])],
        totalesHoja1: { entra: "0.00", sale: "999.99", cobradoATiendas: "0.00" },
      }),
    ).toThrow(/TOTAL GENERAL/);
  });

  it("R31/R48 (estado de cuenta): sin la columna «Cobrado a tiendas», el total es null en esa columna", () => {
    const movs = [{ id: "dev", monto: entra("800.00") }];
    const r = agruparPorGuia({
      movimientos: movs,
      detalle: [conOrdenes("dev", C1, [orden("o1", "501", "800.00")])],
      totalesHoja1: hoja1(movs, false),
    });
    expect(r.totalGeneral).toEqual({ entra: "800.00", sale: "0.00", cobradoATiendas: null });
  });

  it("un movimiento de la hoja sin detalle es un error de construccion", () => {
    expect(() => agruparPorGuia({ movimientos: [{ id: "x", monto: entra("1.00") }], detalle: [], totalesHoja1: hoja1([]) })).toThrow(
      /no tiene detalle/,
    );
  });
});
