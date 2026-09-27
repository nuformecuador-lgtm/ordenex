import { describe, it, expect } from "vitest";

import type { MovimientoDelPeriodoRow } from "@/lib/interfaces/repositories/IEstadoCuentaRepository";
import {
  claveDeParMensajero,
  claveDeParTienda,
  paresDeChipMensajero,
  paresDeChipTienda,
  saldoAlFinal,
  totalesNetos,
} from "@/lib/utils/estado-cuenta";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B / TB.6 (D3, R22, R24) — lo PURO del estado de cuenta: los pares anulados, los totales
// netos del periodo, el saldo final y el filtro de cada chip. Literales A MANO.
// ═════════════════════════════════════════════════════════════════════════════════════════════

function fila(over: Partial<MovimientoDelPeriodoRow>): MovimientoDelPeriodoRow {
  return {
    id: "f",
    tipo: "debito",
    categoria: "flete",
    origenTipo: "cierre_dia",
    origenId: "c-1",
    premioDia: null,
    monto: "100.00",
    ...over,
  };
}

const esCredito = (m: MovimientoDelPeriodoRow) => m.tipo === "credito";

describe("458-B — los pares anulados de la tienda (D3)", () => {
  it("cada original con su contra-asiento comparte clave; lo del cierre y las correcciones no forman pares", () => {
    expect(claveDeParTienda(fila({ categoria: "pago_tienda", origenTipo: "pago_tienda", origenId: "p1" }))).toEqual({ clave: "pago:p1", esContra: false });
    expect(claveDeParTienda(fila({ categoria: "ajuste_credito", origenTipo: "pago_tienda", origenId: "p1" }))).toEqual({ clave: "pago:p1", esContra: true });
    expect(claveDeParTienda(fila({ id: "c9", categoria: "cobro_manual", origenTipo: "manual", origenId: null }))).toEqual({ clave: "cobro:c9", esContra: false });
    expect(claveDeParTienda(fila({ categoria: "cobro_tienda_anulado", origenTipo: "cobro_tienda", origenId: "c9" }))).toEqual({ clave: "cobro:c9", esContra: true });
    expect(claveDeParTienda(fila({ categoria: "flete_devolucion", origenTipo: "gestion_orden", origenId: "g" }))).toEqual({ clave: "rf:g", esContra: false });
    expect(claveDeParTienda(fila({ categoria: "iva_flete_devolucion_anulado", origenTipo: "gestion_orden", origenId: "g" }))).toEqual({ clave: "ri:g", esContra: true });
    expect(claveDeParTienda(fila({ categoria: "flete_devolucion", origenTipo: "cierre_dia" }))).toBeNull();
    expect(claveDeParTienda(fila({ categoria: "ajuste_debito", origenTipo: "manual", origenId: null }))).toBeNull();
  });

  it("el premio se empareja por su DIA; el pago al mensajero, por su documento", () => {
    const dia = new Date("2026-09-01T00:00:00.000Z");
    expect(claveDeParMensajero(fila({ tipo: "devengo", categoria: "premio_ranking", premioDia: dia }))).toEqual({ clave: `premio:${dia.toISOString()}`, esContra: false });
    expect(claveDeParMensajero(fila({ tipo: "pago", categoria: "ajuste_pago", premioDia: dia }))).toEqual({ clave: `premio:${dia.toISOString()}`, esContra: true });
    expect(claveDeParMensajero(fila({ tipo: "pago", categoria: "liquidacion", origenTipo: "pago_mensajero", origenId: "lp" }))).toEqual({ clave: "pago:lp", esContra: false });
    expect(claveDeParMensajero(fila({ tipo: "devengo", categoria: "ajuste_devengo", origenTipo: "pago_mensajero", origenId: "lp" }))).toEqual({ clave: "pago:lp", esContra: true });
    expect(claveDeParMensajero(fila({ tipo: "devengo", categoria: "pago_devengado" }))).toBeNull();
  });
});

describe("458-B — los totales netos del periodo (D3) y el saldo final (R22)", () => {
  // Periodo: +10 000 (cod), −2 000 (flete), −3 000 (pago p1), +3 000 (su anulacion), −1 000 (pago p2).
  const periodo = [
    fila({ tipo: "credito", categoria: "cod_recaudado", monto: "10000.00" }),
    fila({ monto: "2000.00" }),
    fila({ categoria: "pago_tienda", origenTipo: "pago_tienda", origenId: "p1", monto: "3000.00" }),
    fila({ tipo: "credito", categoria: "ajuste_credito", origenTipo: "pago_tienda", origenId: "p1", monto: "3000.00" }),
    fila({ categoria: "pago_tienda", origenTipo: "pago_tienda", origenId: "p2", monto: "1000.00" }),
  ];

  it("el par ENTERO dentro del periodo sale de los dos totales: abonos 10 000,00; cargos 3 000,00", () => {
    expect(totalesNetos(periodo, claveDeParTienda, esCredito)).toEqual({ abonos: "10000.00", cargos: "3000.00" });
  });

  it("una mitad del par sola (la otra fuera del periodo) SI cuenta: si no, R22 dejaria de cuadrar", () => {
    const soloElPago = periodo.filter((m) => m.categoria !== "ajuste_credito");
    expect(totalesNetos(soloElPago, claveDeParTienda, esCredito)).toEqual({ abonos: "10000.00", cargos: "6000.00" });
  });

  it("R22: inicial + abonos − cargos (a favor del titular); inicial + cargos − abonos (por entregar)", () => {
    expect(saldoAlFinal("6200.00", "0.00", "1000.00", "a_favor_del_titular")).toBe("5200.00");
    expect(saldoAlFinal("0.00", "10000.00", "12000.50", "a_favor_del_titular")).toBe("-2000.50");
    expect(saldoAlFinal("0.00", "4000.00", "9500.00", "por_entregar")).toBe("5500.00");
  });
});

describe("458-B — el filtro de cada chip sale del diccionario total (R24)", () => {
  it("tienda «Cobros»: el cobro, su anulacion y el flete/IVA por rechazo SOLO con origen `gestion_orden`", () => {
    const cobros = paresDeChipTienda("cobros");
    const tiene = (categoria: string, origen: string) => cobros.some((p) => p.categoria === categoria && p.origen === origen);
    expect(tiene("cobro_manual", "manual")).toBe(true);
    expect(tiene("cobro_tienda_anulado", "cobro_tienda")).toBe(true);
    expect(tiene("flete_devolucion", "gestion_orden")).toBe(true);
    expect(tiene("flete_devolucion_anulado", "gestion_orden")).toBe(true);
    expect(tiene("flete_devolucion", "cierre_dia")).toBe(false); // ese es «Cierres»
    expect(tiene("pago_tienda", "pago_tienda")).toBe(false);
  });

  it("mensajero «Premios»: el premio y su reverso (con dia); el ajuste de un pago es «Pagos»", () => {
    const premios = paresDeChipMensajero("premios");
    expect(premios.some((p) => p.categoria === "premio_ranking")).toBe(true);
    expect(premios.some((p) => p.categoria === "ajuste_pago" && p.esPremio === true)).toBe(true);
    expect(premios.some((p) => p.categoria === "ajuste_pago" && p.esPremio === false)).toBe(false);
    const pagos = paresDeChipMensajero("pagos");
    expect(pagos.some((p) => p.categoria === "ajuste_devengo" && p.origen === "pago_mensajero" && p.esPremio === false)).toBe(true);
  });

  it("los cuatro chips de la tienda PARTEN el universo: cada par en exactamente uno", () => {
    const todos = (["cierres", "pagos", "cobros", "correcciones"] as const).flatMap(paresDeChipTienda);
    const claves = todos.map((p) => `${p.categoria}|${p.origen}`);
    expect(new Set(claves).size).toBe(claves.length);
  });
});
