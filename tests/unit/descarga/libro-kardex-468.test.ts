// Ficha 468 (T11/T12/T14) — el adaptador que COLOCA el libro de la wallet en sus dos hojas (kardex y
// «Detalle por guía»), los catálogos de cada superficie, sus columnas fijas, sus ámbitos y los textos.
//
// Sustituye a `tests/unit/descarga/detalle-por-orden-464.test.ts` (enlazarHojas, «N.º», «Detalle por
// orden»): lo que de aquel sigue valiendo —el detalle es de la MISMA respuesta (lanza si no), ninguna
// celda lleva un identificador, el día del cierre es el de Costa Rica, un ámbito propio por hoja y por
// superficie, el aviso del tope del detalle— está aquí con el R nuevo en el nombre.
//
// Los literales (encabezados, ámbitos, textos) se escriben A MANO: son el contrato del archivo y de la
// pantalla, y compararlos contra su propia fuente los dejaría siempre verdes.
import { describe, it, expect } from "vitest";

import { mensajeLimite, mensajeLimiteDetalle } from "@/components/shared/descarga-resultado";
import {
  COLUMNAS_DE_LA_HOJA_LEGEND,
  QUE_SE_DESCARGA_LEGEND,
  SELECTOR_DETALLE_DISPARADOR,
} from "@/components/shared/DescargarDatasetButton";
import {
  filasDetallePorGuia,
  filasKardex,
  textoDetalle,
  textoGuias,
} from "@/components/shared/wallet/libro-kardex-descarga";
import {
  DETALLE_SIN_GUIA_MOTIVO,
  LIBRO_KARDEX_HOJAS,
  LIBRO_KARDEX_TEXTO,
} from "@/components/shared/wallet/libro-kardex-labels";
import {
  AMBITO_DESCARGA_ESTADO_CUENTA_MENSAJERO,
  AMBITO_DESCARGA_ESTADO_CUENTA_SATELITE,
  AMBITO_DESCARGA_ESTADO_CUENTA_TIENDA,
  AMBITO_DESCARGA_MI_ESTADO_CUENTA,
  COLUMNAS_DESCARGA_ESTADO_CUENTA,
  COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
  FIJAS_DESCARGA_ESTADO_CUENTA,
} from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import {
  AMBITO_DESCARGA_WALLET_CAJA,
  AMBITO_DESCARGA_WALLET_CAJA_DETALLE,
  COLUMNAS_DESCARGA_DETALLE_GUIA_CAJA,
  COLUMNAS_DESCARGA_WALLET_CAJA,
  DETALLE_DESCARGA_WALLET_CAJA,
  FIJAS_DESCARGA_WALLET_CAJA,
  filaBaseCaja,
  filaCabeceraGuiaCaja,
} from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import { conceptoDeCaja, detalleDeCaja, fechaDeCaja } from "@/app/(app)/wallet/_components/libro-caja-kardex";
import { DUENO_LABEL } from "@/app/(app)/wallet/_components/wallet-labels";
import {
  AMBITO_DESCARGA_WALLET_TIENDA_DETALLE,
  COLUMNAS_DESCARGA_DETALLE_GUIA_TIENDA,
  DETALLE_DESCARGA_WALLET_TIENDA,
} from "@/app/(app)/wallet/tiendas/_components/estado-cuenta-tienda-descarga-columnas";
import {
  AMBITO_DESCARGA_WALLET_MENSAJERO_DETALLE,
  COLUMNAS_DESCARGA_DETALLE_GUIA_MENSAJERO,
  DETALLE_DESCARGA_WALLET_MENSAJERO,
} from "@/app/(app)/wallet/mensajeros/_components/estado-cuenta-mensajero-descarga-columnas";
import {
  AMBITO_DESCARGA_MI_WALLET_DETALLE,
  COLUMNAS_DESCARGA_DETALLE_GUIA_MI_WALLET,
  DETALLE_DESCARGA_MI_WALLET,
} from "@/app/(app)/mi-wallet/_components/mi-estado-cuenta-descarga-columnas";
import { AMBITO_DESCARGA_SALDOS_TIENDAS } from "@/app/(app)/wallet/tiendas/_components/saldos-tiendas-descarga-columnas";
import { AMBITO_DESCARGA_CUENTAS_POR_PAGAR } from "@/app/(app)/wallet/mensajeros/_components/cuentas-por-pagar-descarga-columnas";
import { AMBITO_DESCARGA_SALDOS_SATELITES } from "@/app/(app)/wallet/satelites/_components/saldos-satelites-descarga-columnas";
import { resultadosTexto } from "@/app/(app)/wallet/_components/detalle-movimiento-labels";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { DetallePorGuiaDTO, KardexDTO } from "@/lib/types/libro-kardex";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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
    fechaMovimiento: "2026-09-20T15:00:00.000Z",
    dueno: "propio",
    documento: null,
    ...over,
  } as WalletMovimientoDTO;
}

/** Un kardex del servidor ya calculado: el adaptador SOLO lo coloca (los números son arbitrarios). */
const KARDEX: KardexDTO = {
  saldoInicial: "1000.00",
  saldoFinal: "1080.00",
  totales: { entra: "100.00", sale: "20.00", cobradoATiendas: "35.00" },
  conOtrosFiltros: false,
  filas: [
    { monto: { columna: "entra", monto: "100.00" }, saldo: "1100.00", ordenes: 3 },
    { monto: { columna: "sale", monto: "20.00" }, saldo: "1080.00", ordenes: null },
    { monto: { columna: "cobrado_a_tiendas", monto: "35.00" }, saldo: "1080.00", ordenes: 1 },
  ],
};

const A = mov(1, { categoria: "ingreso_cod_recaudado" });
const B = mov(2, { tipo: "egreso", categoria: "egreso_indemnizacion", origenTipo: "orden_incidente" });
const C = mov(3, { categoria: "ingreso_flete" });

function hojaCaja(kardex: KardexDTO = KARDEX) {
  return filasKardex({
    movimientos: [A, B, C],
    kardex,
    filaBase: (m, ordenes) => filaBaseCaja(m, undefined, ordenes),
    variante: "caja",
    fechaInicial: "2026-09-01",
  });
}

const POR_GUIA: DetallePorGuiaDTO = {
  bloques: [
    {
      guia: "9",
      remision: "REM-9",
      destinatario: "Ana",
      tiendaNombre: "Tienda Uno",
      mensajeroNombre: "Mario Mensajero",
      // 2026-09-21T03:00Z son las 21:00 del 20 en Costa Rica.
      cierres: ["2026-09-19T20:00:00.000Z", "2026-09-21T03:00:00.000Z"],
      resultados: ["entregado", "reprogramado"],
      filas: [
        { movimientoId: A.id, cierreFecha: "2026-09-19T20:00:00.000Z", resultados: ["entregado"], monto: { columna: "entra", monto: "60.00" } },
        { movimientoId: C.id, cierreFecha: "2026-09-21T03:00:00.000Z", resultados: ["reprogramado"], monto: { columna: "cobrado_a_tiendas", monto: "35.00" } },
      ],
      total: { entra: "60.00", sale: "0.00", cobradoATiendas: "35.00" },
    },
    {
      guia: null,
      remision: "REM-77",
      destinatario: "Beto",
      tiendaNombre: "Tienda Dos",
      mensajeroNombre: "Mario Mensajero",
      cierres: ["2026-09-19T20:00:00.000Z"],
      resultados: ["entregado"],
      filas: [
        { movimientoId: A.id, cierreFecha: "2026-09-19T20:00:00.000Z", resultados: ["entregado"], monto: { columna: "entra", monto: "30.00" } },
      ],
      total: { entra: "30.00", sale: "0.00", cobradoATiendas: "0.00" },
    },
  ],
  sinGuia: [
    { tipo: "movimiento", movimientoId: B.id, motivo: "no_nace_de_un_cierre", monto: { columna: "sale", monto: "20.00" } },
    {
      tipo: "diferencia",
      movimientoId: A.id,
      cierreFecha: "2026-09-19T20:00:00.000Z",
      montoMovimiento: "100.00",
      sumaGuias: "90.00",
      monto: { columna: "entra", monto: "10.00" },
    },
  ],
  totalGeneral: { entra: "100.00", sale: "20.00", cobradoATiendas: "35.00" },
};

function hojaGuiasCaja(porGuia: DetallePorGuiaDTO = POR_GUIA) {
  const ordenes = new Map([A, B, C].map((m, i) => [m.id, KARDEX.filas[i].ordenes]));
  return filasDetallePorGuia({
    porGuia,
    cabeceraDe: filaCabeceraGuiaCaja,
    movimientoPorId: new Map([A, B, C].map((m) => [m.id, m])),
    conceptoDe: conceptoDeCaja,
    fechaDe: fechaDeCaja,
    detalleDe: (m) => detalleDeCaja(m, ordenes.get(m.id) ?? null),
    resultadosTexto,
  });
}

const encabezados = (cols: readonly DescargaColumna[]) => cols.map((c) => c.encabezado);

describe("468 R5/R8/R16/R23 — la hoja «Movimientos» es un kardex colocado, sin sumar nada", () => {
  it("R5: la primera fila es «Saldo al inicio del periodo», con ese saldo y las columnas de monto vacías", () => {
    const { filas } = hojaCaja();
    expect(filas[0]).toEqual({
      fecha: "2026-09-01",
      concepto: "Saldo al inicio del periodo",
      detalle: null,
      entra: null,
      sale: null,
      cobradoATiendas: null,
      saldo: "1000.00",
    });
  });

  it("R6/R9/R10: una fila por movimiento, en su orden, con el monto en SU columna y las otras dos vacías", () => {
    const { filas } = hojaCaja();
    expect(filas.slice(1, 4).map((f) => [f.concepto, f.entra, f.sale, f.cobradoATiendas, f.saldo])).toEqual([
      ["Contra-entrega cobrado a los clientes de la tienda", "100.00", null, null, "1100.00"],
      [expect.any(String), null, "20.00", null, "1080.00"],
      [expect.any(String), null, null, "35.00", "1080.00"],
    ]);
  });

  it("R8: la última con montos es «Total del periodo» con los totales y el saldo final DEL SERVIDOR", () => {
    const { filas } = hojaCaja();
    expect(filas).toHaveLength(5);
    expect(filas[4]).toEqual({
      fecha: null,
      concepto: "Total del periodo",
      detalle: null,
      entra: "100.00",
      sale: "20.00",
      cobradoATiendas: "35.00",
      saldo: "1080.00",
    });
  });

  it("R23: «Saldo al inicio del periodo» y «Total del periodo» van en negrita (índices 0 y el del total)", () => {
    expect(hojaCaja().filasDestacadas).toEqual([0, 4]);
  });

  it("R16: con otros filtros, una fila de aviso bajo el total, en sus dos variantes; sin ellos, ninguna", () => {
    const caja = hojaCaja({ ...KARDEX, conOtrosFiltros: true }).filas;
    expect(caja).toHaveLength(6);
    expect(caja[5].concepto).toBe(
      "Con filtros: Entra y Sale suman solo los movimientos de esta hoja; el saldo es el de toda la caja.",
    );
    const cuenta = filasKardex({
      movimientos: [A],
      kardex: { ...KARDEX, conOtrosFiltros: true, filas: [KARDEX.filas[0]] },
      filaBase: (m, o) => filaBaseCaja(m, undefined, o),
      variante: "cuenta",
      fechaInicial: null,
    }).filas;
    expect(cuenta.at(-1)?.concepto).toBe(
      "Con filtros: Entra y Sale suman solo los movimientos de esta hoja; el saldo es el de toda la cuenta.",
    );
    expect(hojaCaja().filas.some((f) => String(f.concepto).startsWith("Con filtros"))).toBe(false);
  });

  it("si el kardex y los movimientos no están alineados, NO hay hoja (lanza)", () => {
    expect(() =>
      filasKardex({ movimientos: [A, B], kardex: KARDEX, filaBase: () => ({}), variante: "caja", fechaInicial: null }),
    ).toThrow(/mismo conjunto/);
  });
});

describe("468 R17/R18/R20/R21 — Concepto, Detalle, A quién, Es dinero de", () => {
  it("R18: «Detalle» junta con « · » las partes no vacías, en orden; «1 guía» / «N guías» (decisión 3)", () => {
    expect(textoDetalle(["Cierre del día · 2026-09-20", null, "", "  ", "3 guías", "Anulado"])).toBe(
      "Cierre del día · 2026-09-20 · 3 guías · Anulado",
    );
    expect(textoGuias(1)).toBe("1 guía");
    expect(textoGuias(4)).toBe("4 guías");
    expect(textoGuias(null)).toBeNull();
  });

  it("R18 (caja): origen con su descripción, el «N guía(s)» si es repartible y «Anulado» si lo dice el servidor", () => {
    const m = mov(5, {
      descripcion: "Nota",
      origen: { texto: "Cierre del día · 2026-09-20 · Mario", enlace: null },
      documento: { tipo: "egreso_caja", anulado: true, tieneComprobante: false },
    } as Partial<WalletMovimientoDTO>);
    expect(detalleDeCaja(m, 2)).toBe("Cierre del día · 2026-09-20 · Mario · Nota · 2 guías · Anulado");
    expect(detalleDeCaja({ ...m, documento: null }, null)).toBe("Cierre del día · 2026-09-20 · Mario · Nota");
  });

  it("R20/R21: «A quién» y «Registró» sin autoría dicen «—» (nunca un id); «Es dinero de» usa las palabras de la tabla", () => {
    const f = filaBaseCaja(mov(1, { dueno: "terceros" }), undefined, null);
    expect(f.esDineroDe).toBe(DUENO_LABEL.terceros);
    expect(DUENO_LABEL).toEqual({ propio: "Ordenex", terceros: "Tienda", capital: "Ordenex (capital)" });
    expect(f.aQuien).toBe(f.registro);
    expect(String(f.aQuien)).not.toMatch(UUID);
    // La fila base no lleva dinero: lo coloca `filasKardex` desde el kardex del servidor (R54).
    expect(Object.keys(f).sort()).toEqual(["aQuien", "concepto", "detalle", "esDineroDe", "fecha", "registro"]);
  });
});

describe("468 R33–R47 — la hoja «Detalle por guía» agrupada", () => {
  it("R34/R35/R36/R37/R38: cabecera, filas de concepto en la columna de su movimiento y «Total de la guía»", () => {
    const { filas } = hojaGuiasCaja();
    expect(filas[0]).toEqual({
      guia: "9",
      remision: "REM-9",
      destinatario: "Ana",
      tienda: "Tienda Uno",
      mensajero: "Mario Mensajero",
      cierre: "2026-09-19, 2026-09-20",
      resultado: resultadosTexto(["entregado", "reprogramado"]),
      concepto: null,
      detalle: null,
      entra: null,
      sale: null,
      cobradoATiendas: null,
    });
    expect(filas[1]).toMatchObject({
      guia: "9",
      cierre: "2026-09-19",
      concepto: "Contra-entrega cobrado a los clientes de la tienda",
      entra: "60.00",
      sale: null,
      cobradoATiendas: null,
    });
    expect(filas[2]).toMatchObject({ guia: "9", cierre: "2026-09-20", entra: null, cobradoATiendas: "35.00" });
    expect(filas[3]).toEqual({
      guia: "9",
      concepto: "Total de la guía",
      detalle: null,
      entra: "60.00",
      sale: "0.00",
      cobradoATiendas: "35.00",
    });
  });

  it("R37: la orden sin guía dice «Sin guía · remisión <remisión>»", () => {
    expect(hojaGuiasCaja().filas[4].guia).toBe("Sin guía · remisión REM-77");
  });

  it("R40/R41/R43/R44: «Movimientos sin guía», sus filas, la diferencia con su detalle y el TOTAL GENERAL", () => {
    const { filas } = hojaGuiasCaja();
    const titulo = filas.findIndex((f) => f.concepto === "Movimientos sin guía");
    expect(titulo).toBe(7);
    const movimiento = filas[titulo + 1];
    expect(movimiento.concepto).toBe(conceptoDeCaja(B));
    expect(movimiento.sale).toBe("20.00");
    // R40: la fecha del movimiento seguida del Detalle de la hoja 1.
    expect(movimiento.detalle).toBe(`2026-09-20 · ${detalleDeCaja(B, null)}`);
    const diferencia = filas[titulo + 2];
    expect(diferencia).toMatchObject({ concepto: "Diferencia sin repartir", entra: "10.00", sale: null });
    expect(diferencia.detalle).toBe(
      "Cierre del 2026-09-19 · Contra-entrega cobrado a los clientes de la tienda: el movimiento es ₡100 y sus guías suman ₡90",
    );
    expect(filas.at(-1)).toEqual({
      concepto: "TOTAL GENERAL",
      detalle: null,
      entra: "100.00",
      sale: "20.00",
      cobradoATiendas: "35.00",
    });
  });

  it("R43: el pago tomado del efectivo dice que salió del efectivo entregado en el cierre de ese día", () => {
    const { filas } = hojaGuiasCaja({
      ...POR_GUIA,
      bloques: [],
      sinGuia: [{ tipo: "movimiento", movimientoId: B.id, motivo: "snapshot_del_cierre", monto: { columna: "sale", monto: "20.00" } }],
    });
    expect(filas[1].detalle).toBe(
      `2026-09-20 · ${detalleDeCaja(B, null)} · Se tomó del efectivo que el mensajero entregó en el cierre de ese día.`,
    );
  });

  it("R47: cabeceras, «Total de la guía», el título y el TOTAL GENERAL van en negrita", () => {
    const { filas, filasDestacadas } = hojaGuiasCaja();
    expect(filasDestacadas).toEqual([0, 3, 4, 6, 7, filas.length - 1]);
  });

  it("464 R36 → 468: un movimiento de la hoja 2 que no está en la hoja 1 NO produce hoja (lanza)", () => {
    expect(() =>
      filasDetallePorGuia({
        porGuia: POR_GUIA,
        cabeceraDe: filaCabeceraGuiaCaja,
        movimientoPorId: new Map([[A.id, A]]),
        conceptoDe: conceptoDeCaja,
        fechaDe: fechaDeCaja,
        detalleDe: () => "",
        resultadosTexto,
      }),
    ).toThrow(/no está en la hoja 1/);
  });

  it("464 R30 → 468: ninguna celda de ninguna hoja lleva un identificador interno (ni el enlace en memoria)", () => {
    const filas: DescargaFila[] = [...hojaCaja().filas, ...hojaGuiasCaja().filas];
    for (const fila of filas) for (const celda of Object.values(fila)) expect(String(celda)).not.toMatch(UUID);
  });
});

describe("468 R1–R4, R29–R32 — los catálogos de cada hoja (contrato literal)", () => {
  it("R1: la hoja «Movimientos» de la caja", () => {
    expect(encabezados(COLUMNAS_DESCARGA_WALLET_CAJA)).toEqual([
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
    ]);
  });

  it("R2: la del estado de cuenta en la oficina (tienda, mensajero, bodega)", () => {
    expect(encabezados(COLUMNAS_DESCARGA_ESTADO_CUENTA)).toEqual([
      "Fecha",
      "Concepto",
      "Detalle",
      "Entra",
      "Sale",
      "Saldo",
      "Registró",
    ]);
  });

  it("R3/R49: la de /mi-wallet, sin «Registró» ni ninguna columna de una persona de Ordenex", () => {
    expect(encabezados(COLUMNAS_DESCARGA_MI_ESTADO_CUENTA)).toEqual(["Fecha", "Concepto", "Detalle", "Entra", "Sale", "Saldo"]);
    expect(encabezados(COLUMNAS_DESCARGA_DETALLE_GUIA_MI_WALLET)).not.toContain("Mensajero");
    expect(encabezados(COLUMNAS_DESCARGA_MI_ESTADO_CUENTA)).not.toContain("A quién");
  });

  it("R4: ninguna hoja «Movimientos» lleva las columnas retiradas", () => {
    const retiradas = [
      "N.º",
      "Detalle por orden",
      "Dueño",
      "Movimiento",
      "Motivo y origen",
      "Motivo",
      "Origen",
      "Cómo se pagó",
      "Entra o sale",
      "Monto",
      "Cargo",
      "Abono",
      "Estado",
    ];
    for (const cat of [COLUMNAS_DESCARGA_WALLET_CAJA, COLUMNAS_DESCARGA_ESTADO_CUENTA, COLUMNAS_DESCARGA_MI_ESTADO_CUENTA]) {
      for (const r of retiradas) expect(encabezados(cat)).not.toContain(r);
    }
  });

  it("R29: la hoja «Detalle por guía» de la caja", () => {
    expect(encabezados(COLUMNAS_DESCARGA_DETALLE_GUIA_CAJA)).toEqual([
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

  it("R30: la de una tienda en la oficina", () => {
    expect(encabezados(COLUMNAS_DESCARGA_DETALLE_GUIA_TIENDA)).toEqual([
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
  });

  it("R31: la de un mensajero en la oficina", () => {
    expect(encabezados(COLUMNAS_DESCARGA_DETALLE_GUIA_MENSAJERO)).toEqual([
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
  });

  it("R32: la de /mi-wallet", () => {
    expect(encabezados(COLUMNAS_DESCARGA_DETALLE_GUIA_MI_WALLET)).toEqual([
      "Guía",
      "Remisión",
      "Destinatario",
      "Cierre",
      "Resultado",
      "Concepto",
      "Detalle",
      "Entra",
      "Sale",
    ]);
  });

  it("las CLAVES de las hojas «Detalle por guía», en su orden (contrato del archivo, R29–R32)", () => {
    expect(COLUMNAS_DESCARGA_DETALLE_GUIA_CAJA.map((c) => c.clave)).toEqual([
      "guia",
      "remision",
      "destinatario",
      "tienda",
      "mensajero",
      "cierre",
      "resultado",
      "concepto",
      "detalle",
      "entra",
      "sale",
      "cobradoATiendas",
    ]);
    expect(COLUMNAS_DESCARGA_DETALLE_GUIA_TIENDA.map((c) => c.clave)).toEqual([
      "guia",
      "remision",
      "destinatario",
      "mensajero",
      "cierre",
      "resultado",
      "concepto",
      "detalle",
      "entra",
      "sale",
    ]);
    expect(COLUMNAS_DESCARGA_DETALLE_GUIA_MENSAJERO.map((c) => c.clave)).toEqual([
      "guia",
      "remision",
      "destinatario",
      "tienda",
      "cierre",
      "resultado",
      "concepto",
      "detalle",
      "entra",
      "sale",
    ]);
    expect(COLUMNAS_DESCARGA_DETALLE_GUIA_MI_WALLET.map((c) => c.clave)).toEqual([
      "guia",
      "remision",
      "destinatario",
      "cierre",
      "resultado",
      "concepto",
      "detalle",
      "entra",
      "sale",
    ]);
  });

  it("R22/R58: las columnas de monto (y Saldo) llevan `formato: \"monto\"`; las demás no", () => {
    const MONTO = ["entra", "sale", "cobradoATiendas", "saldo"];
    for (const cat of [
      COLUMNAS_DESCARGA_WALLET_CAJA,
      COLUMNAS_DESCARGA_ESTADO_CUENTA,
      COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
      COLUMNAS_DESCARGA_DETALLE_GUIA_CAJA,
      COLUMNAS_DESCARGA_DETALLE_GUIA_TIENDA,
      COLUMNAS_DESCARGA_DETALLE_GUIA_MENSAJERO,
      COLUMNAS_DESCARGA_DETALLE_GUIA_MI_WALLET,
    ]) {
      for (const c of cat) expect(c.formato === "monto", c.clave).toBe(MONTO.includes(c.clave));
    }
  });
});

describe("468 R50/R51/R52 — columnas fijas y un ámbito propio por hoja y por superficie", () => {
  it("R51: fijas en «Movimientos» = Concepto, montos y Saldo; en «Detalle por guía» = Guía, Concepto y montos", () => {
    expect(FIJAS_DESCARGA_WALLET_CAJA).toEqual(["concepto", "entra", "sale", "cobradoATiendas", "saldo"]);
    expect(FIJAS_DESCARGA_ESTADO_CUENTA).toEqual(["concepto", "entra", "sale", "cobradoATiendas", "saldo"]);
    for (const hoja of [
      DETALLE_DESCARGA_WALLET_CAJA,
      DETALLE_DESCARGA_WALLET_TIENDA.hoja,
      DETALLE_DESCARGA_WALLET_MENSAJERO.hoja,
      DETALLE_DESCARGA_MI_WALLET.hoja,
    ]) {
      expect(hoja.columnasFijas).toEqual(["guia", "concepto", "entra", "sale", "cobradoATiendas"]);
    }
  });

  it("R50/R52: los ámbitos de la 464 se conservan y entra el del mensajero; todos distintos", () => {
    const ambitos = {
      caja: AMBITO_DESCARGA_WALLET_CAJA,
      cajaDetalle: AMBITO_DESCARGA_WALLET_CAJA_DETALLE,
      tienda: AMBITO_DESCARGA_ESTADO_CUENTA_TIENDA,
      tiendaDetalle: AMBITO_DESCARGA_WALLET_TIENDA_DETALLE,
      mensajero: AMBITO_DESCARGA_ESTADO_CUENTA_MENSAJERO,
      mensajeroDetalle: AMBITO_DESCARGA_WALLET_MENSAJERO_DETALLE,
      satelite: AMBITO_DESCARGA_ESTADO_CUENTA_SATELITE,
      miWallet: AMBITO_DESCARGA_MI_ESTADO_CUENTA,
      miWalletDetalle: AMBITO_DESCARGA_MI_WALLET_DETALLE,
      saldosTiendas: AMBITO_DESCARGA_SALDOS_TIENDAS,
      cuentasMensajeros: AMBITO_DESCARGA_CUENTAS_POR_PAGAR,
      saldosSatelites: AMBITO_DESCARGA_SALDOS_SATELITES,
    };
    expect(ambitos).toEqual({
      caja: "wallet-caja-libro",
      cajaDetalle: "wallet-caja-detalle-orden",
      tienda: "wallet-tienda-estado-cuenta",
      tiendaDetalle: "wallet-tienda-detalle-orden",
      mensajero: "wallet-mensajero-estado-cuenta",
      mensajeroDetalle: "wallet-mensajero-detalle-guia",
      satelite: "wallet-satelite-estado-cuenta",
      miWallet: "mi-wallet-estado-cuenta",
      miWalletDetalle: "mi-wallet-detalle-orden",
      saldosTiendas: "wallet-tiendas-saldos",
      cuentasMensajeros: "wallet-mensajeros-cuentas",
      saldosSatelites: "wallet-satelites-saldos",
    });
    expect(new Set(Object.values(ambitos)).size).toBe(Object.keys(ambitos).length);
    expect(DETALLE_DESCARGA_WALLET_CAJA.ambitoColumnas).toBe("wallet-caja-detalle-orden");
    expect(DETALLE_DESCARGA_WALLET_TIENDA.hoja.ambitoColumnas).toBe("wallet-tienda-detalle-orden");
    expect(DETALLE_DESCARGA_WALLET_MENSAJERO.hoja.ambitoColumnas).toBe("wallet-mensajero-detalle-guia");
    expect(DETALLE_DESCARGA_MI_WALLET.hoja.ambitoColumnas).toBe("mi-wallet-detalle-orden");
  });
});

describe("468 R19/R24/R60 — los textos, en español claro, sin siglas ni jerga técnica", () => {
  it("las opciones del selector, el nombre de la hoja y las filas que pone el adaptador (contrato literal)", () => {
    expect(LIBRO_KARDEX_HOJAS).toEqual({
      detalle: "Detalle por guía",
      conDetalle: "Movimientos y detalle por guía · dos hojas",
      sinDetalle: "Solo los movimientos · una hoja",
    });
    expect([
      LIBRO_KARDEX_TEXTO.saldoInicial,
      LIBRO_KARDEX_TEXTO.totalPeriodo,
      LIBRO_KARDEX_TEXTO.totalGuia,
      LIBRO_KARDEX_TEXTO.movimientosSinGuia,
      LIBRO_KARDEX_TEXTO.diferencia,
      LIBRO_KARDEX_TEXTO.totalGeneral,
    ]).toEqual([
      "Saldo al inicio del periodo",
      "Total del periodo",
      "Total de la guía",
      "Movimientos sin guía",
      "Diferencia sin repartir",
      "TOTAL GENERAL",
    ]);
  });

  it("R19/R60: ningún texto nuevo dice «SLA», «snapshot», «productor», «ledger» ni «feed»", () => {
    const textos = [
      SELECTOR_DETALLE_DISPARADOR,
      QUE_SE_DESCARGA_LEGEND,
      COLUMNAS_DE_LA_HOJA_LEGEND,
      ...Object.values(LIBRO_KARDEX_HOJAS),
      LIBRO_KARDEX_TEXTO.saldoInicial,
      LIBRO_KARDEX_TEXTO.totalPeriodo,
      ...Object.values(LIBRO_KARDEX_TEXTO.avisoFiltros),
      LIBRO_KARDEX_TEXTO.totalGuia,
      LIBRO_KARDEX_TEXTO.movimientosSinGuia,
      LIBRO_KARDEX_TEXTO.diferencia,
      LIBRO_KARDEX_TEXTO.totalGeneral,
      LIBRO_KARDEX_TEXTO.sinGuia("R-1"),
      LIBRO_KARDEX_TEXTO.guias(2),
      LIBRO_KARDEX_TEXTO.detalleDiferencia("2026-09-20", "Flete", "₡1,00", "₡0,50"),
      ...Object.values(DETALLE_SIN_GUIA_MOTIVO).filter((t): t is string => t !== null),
      mensajeLimiteDetalle(1, 1),
      ...[
        COLUMNAS_DESCARGA_WALLET_CAJA,
        COLUMNAS_DESCARGA_DETALLE_GUIA_CAJA,
        COLUMNAS_DESCARGA_DETALLE_GUIA_MENSAJERO,
      ].flatMap(encabezados),
    ];
    for (const t of textos) expect(t).not.toMatch(/\bSLA\b|acuerdo a nivel de servicio|snapshot|productor|ledger|\bfeed\b/i);
  });

  it("464 R39 → 468 R56: el aviso del tope del detalle nombra la hoja nueva, las filas, el tope y qué hacer", () => {
    const m = mensajeLimiteDetalle(6200, 5000);
    expect(m).toBe(
      "El detalle por guía tendría 6200 filas y la descarga admite hasta 5000. Acota el periodo, o elige «Solo los movimientos» y vuelve a intentarlo.",
    );
    expect(m).not.toBe(mensajeLimite(6200, 5000));
  });
});
