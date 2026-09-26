import { describe, it, expect } from "vitest";

import {
  CATEGORIA_TIENDA_LABEL,
  CATEGORIA_TIENDA_OPTIONS,
  DESGLOSE_TIENDA_COLUMNAS,
  DESGLOSE_TIENDA_ERROR,
  DESGLOSE_TIENDA_FILTRO_LABEL,
  DESGLOSE_TIENDA_LABEL,
  DESGLOSE_TIENDA_NOMBRE,
  DESGLOSE_TIENDA_VACIO,
  ORIGEN_TIENDA_LABEL,
  SALDO_SIGNO_LABEL,
  TIPO_TIENDA_LABEL,
  money,
  origenLabel,
} from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-labels";
import * as miWalletLabels from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";
import { CATEGORIA_LABEL } from "@/app/(app)/wallet/_components/wallet-labels";
import { SALDO_SIGNO_LABEL as SALDO_SIGNO_LABEL_TABLA } from "@/app/(app)/wallet/tiendas/_components/saldo-tienda-signo-label";
import {
  WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED,
  type WalletTiendaMovimientoCategoria,
} from "@/lib/types/wallet-tienda";

// Feature 171 (T2.1, R13/R20) — el desglose por tienda dice lo MISMO que `/mi-wallet` para el mismo
// tipo, origen y signo, y lo mismo que la tabla de saldos para el mismo signo.
//
// Por qué se prueba la IDENTIDAD (`toBe`, misma referencia) y no la igualdad: dos mapas con los
// mismos textos hoy son dos mapas que mañana divergen en cuanto alguien renombre uno de los dos.
//
// ⭑ FICHA 461 (T C.2, design §7.4, HD3, P4) — el CONCEPTO deja de ser el mismo objeto a propósito:
// el libro se lee desde dos lados. Aquí vive el nombre DESDE ORDENEX («Ordenex le cobra a la
// tienda»), que es el que ve la oficina y el que el diálogo promete (R43/R46); `/mi-wallet` lee
// desde la tienda («Ordenex te cobró», R44). Los literales van escritos a mano.

/** design §7.4 — el libro de la tienda, desde Ordenex, los 14 conceptos. */
const DESDE_ORDENEX: Record<WalletTiendaMovimientoCategoria, string> = {
  cod_recaudado: "Contra-entrega cobrado a los clientes de la tienda",
  flete: "Flete cobrado a la tienda",
  flete_devolucion: "Flete por rechazo cobrado a la tienda",
  comision_cod: "Comisión de contra-entrega cobrada a la tienda",
  iva_flete: "IVA del flete cobrado a la tienda",
  iva_flete_devolucion: "IVA del flete por rechazo cobrado a la tienda",
  iva_comision_cod: "IVA de la comisión cobrado a la tienda",
  cobro_manual: "Ordenex le cobra a la tienda",
  cobro_tienda_anulado: "Cobro de Ordenex a la tienda anulado",
  pago_tienda: "Ordenex le paga a la tienda",
  pago_por_cuenta: "Ordenex paga un gasto de la tienda",
  pago_por_cuenta_anulado: "Pago de un gasto de la tienda anulado",
  ajuste_credito: "Corrección a favor de la tienda",
  ajuste_debito: "Corrección en contra de la tienda",
};

describe("etiquetas del desglose por tienda — R20: tipo, origen y moneda son los MISMOS de /mi-wallet", () => {
  it("tipo y origen son el MISMO objeto que usa /mi-wallet, no una copia", () => {
    expect(ORIGEN_TIENDA_LABEL).toBe(miWalletLabels.ORIGEN_TIENDA_LABEL);
    expect(TIPO_TIENDA_LABEL).toBe(miWalletLabels.TIPO_TIENDA_LABEL);
    expect(origenLabel).toBe(miWalletLabels.origenLabel);
  });

  it("el helper de moneda es el MISMO, así que ninguno de los dos puede parsear un monto", () => {
    expect(money).toBe(miWalletLabels.money);
    expect(money("1000.10")).toBe("₡1.000,10");
    expect(money("-452.00")).toBe("-₡452");
    // `null` = aún no cargado. NO es un cero: un cero falso en una pantalla de dinero miente.
    expect(money(null)).toBe("—");
  });
});

describe("⭑ FICHA 461 — CATEGORIA_TIENDA_LABEL: el libro de la tienda, desde Ordenex (R43, design §7.4)", () => {
  it("dice exactamente los 14 textos aprobados, y el seed es exactamente esas 14 claves", () => {
    expect(CATEGORIA_TIENDA_LABEL).toEqual(DESDE_ORDENEX);
    expect([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED].sort()).toEqual(
      Object.keys(DESDE_ORDENEX).sort(),
    );
  });

  it("NO es el diccionario de /mi-wallet: aquel lee desde la tienda (P4, R44)", () => {
    expect(CATEGORIA_TIENDA_LABEL).not.toBe(miWalletLabels.CATEGORIA_MI_WALLET_LABEL);
    expect(CATEGORIA_TIENDA_LABEL.cobro_manual).toBe("Ordenex le cobra a la tienda");
    expect(miWalletLabels.CATEGORIA_MI_WALLET_LABEL.cobro_manual).toBe("Ordenex te cobró");
    // Y el viejo diccionario compartido ya no existe en /mi-wallet: nadie puede volver a importarlo.
    expect("CATEGORIA_TIENDA_LABEL" in miWalletLabels).toBe(false);
    expect("CATEGORIA_TIENDA_OPTIONS" in miWalletLabels).toBe(false);
  });

  it("los seis cargos del cierre dicen EXACTAMENTE lo mismo que su contrapartida en la caja", () => {
    // El mismo dinero con el mismo nombre en los dos libros (design §7.4: «los seis de §7.2»).
    expect(CATEGORIA_TIENDA_LABEL.flete).toBe(CATEGORIA_LABEL.ingreso_flete);
    expect(CATEGORIA_TIENDA_LABEL.flete_devolucion).toBe(CATEGORIA_LABEL.ingreso_flete_devolucion);
    expect(CATEGORIA_TIENDA_LABEL.comision_cod).toBe(CATEGORIA_LABEL.ingreso_comision_cod);
    expect(CATEGORIA_TIENDA_LABEL.iva_flete).toBe(CATEGORIA_LABEL.ingreso_iva_flete);
    expect(CATEGORIA_TIENDA_LABEL.iva_flete_devolucion).toBe(
      CATEGORIA_LABEL.ingreso_iva_flete_devolucion,
    );
    expect(CATEGORIA_TIENDA_LABEL.iva_comision_cod).toBe(CATEGORIA_LABEL.ingreso_iva_comision_cod);
    expect(CATEGORIA_TIENDA_LABEL.cod_recaudado).toBe(CATEGORIA_LABEL.ingreso_cod_recaudado);
    // Literal de control, para que la igualdad no sea vacía.
    expect(CATEGORIA_TIENDA_LABEL.flete).toBe("Flete cobrado a la tienda");
  });

  it("⭑ 381 (R33/R34): el cobro es DISTINTO de una corrección y del pago que la tienda recibe", () => {
    expect(CATEGORIA_TIENDA_LABEL.cobro_manual).not.toBe(CATEGORIA_TIENDA_LABEL.ajuste_debito);
    expect(CATEGORIA_TIENDA_LABEL.cobro_manual).not.toBe(CATEGORIA_TIENDA_LABEL.pago_tienda);
    expect(CATEGORIA_TIENDA_LABEL.ajuste_debito).toBe("Corrección en contra de la tienda");
    // Ni una etiqueta repetida en todo el diccionario (R39 de la 381).
    const etiquetas = Object.values(CATEGORIA_TIENDA_LABEL);
    expect(new Set(etiquetas).size).toBe(etiquetas.length);
    for (const [clave, texto] of Object.entries(CATEGORIA_TIENDA_LABEL)) {
      expect(texto, clave).not.toMatch(/_/);
      expect(texto, clave).not.toMatch(/\bCOD\b/);
    }
  });

  it("las opciones del filtro salen del SEED del enum, con el nombre desde Ordenex (R43)", () => {
    const valores = CATEGORIA_TIENDA_OPTIONS.map((o) => o.value);
    expect(valores[0]).toBe(""); // "todos los conceptos"
    expect(valores.slice(1)).toEqual([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED]);
    expect(valores).toContain("pago_tienda");
    expect(valores).toContain("cobro_manual");
    const opciones = new Map(CATEGORIA_TIENDA_OPTIONS.slice(1).map((o) => [o.value, o.label]));
    for (const [clave, texto] of Object.entries(DESDE_ORDENEX)) {
      expect(opciones.get(clave), clave).toBe(texto);
    }
  });
});

describe("etiquetas del desglose por tienda — R13: el estado del saldo", () => {
  it("es el MISMO mapa de signo que usa la tabla de saldos", () => {
    expect(SALDO_SIGNO_LABEL).toBe(SALDO_SIGNO_LABEL_TABLA);
    expect(SALDO_SIGNO_LABEL).toEqual({
      positivo: "A favor",
      negativo: "En contra",
      cero: "En cero",
    });
  });
});

describe("textos propios del desglose por tienda (R7, P1; 461 R45)", () => {
  it("declara los CUATRO importes con los textos decididos, y en el orden de la fórmula", () => {
    // R7: a favor − cargos − pagado = saldo. El orden del objeto es el de la pantalla.
    expect(Object.keys(DESGLOSE_TIENDA_LABEL)).toEqual([
      "aFavor",
      "aFavorHint",
      "cargos",
      "cargosHint",
      "pagado",
      "pagadoHint",
      "saldo",
      "saldoHint",
    ]);
    expect(DESGLOSE_TIENDA_LABEL.aFavor).toBe("A favor de la tienda");
    expect(DESGLOSE_TIENDA_LABEL.cargos).toBe("Cargos de Ordenex");
    expect(DESGLOSE_TIENDA_LABEL.pagado).toBe("Pagado a la tienda");
    expect(DESGLOSE_TIENDA_LABEL.saldo).toBe("Saldo a favor");
  });

  it("⭑ 461 R45: las pistas nombran el cobro y su anulación con la palabra de su fila, desde Ordenex", () => {
    expect(DESGLOSE_TIENDA_LABEL.aFavorHint).toBe(
      "Contra-entrega cobrado, correcciones a favor y devoluciones por anulaciones",
    );
    expect(DESGLOSE_TIENDA_LABEL.cargosHint).toBe(
      "Fletes, comisión, IVA y los cobros de Ordenex a la tienda",
    );
    expect(DESGLOSE_TIENDA_LABEL.pagadoHint).toBe("Lo que Ordenex le pagó a la tienda o pagó por ella");
    // «cobros de Ordenex a la tienda» ↔ la fila «Ordenex le cobra a la tienda» / «Cobro de Ordenex a la tienda anulado».
    expect(DESGLOSE_TIENDA_LABEL.cargosHint).toMatch(/cobros de Ordenex a la tienda/);
    expect(CATEGORIA_TIENDA_LABEL.cobro_tienda_anulado).toMatch(/^Cobro de Ordenex a la tienda/);
    for (const texto of Object.values(DESGLOSE_TIENDA_LABEL)) expect(texto).not.toMatch(/\bCOD\b/);
  });

  it("no reusa la cabecera del mensajero: a una tienda no se le «devenga» nada", () => {
    const textos = Object.values(DESGLOSE_TIENDA_LABEL).join(" | ");
    expect(textos).not.toMatch(/devengad/i);
    expect(textos).not.toMatch(/cuenta por pagar/i);
  });

  it("las cinco columnas del ledger, en el orden de R15", () => {
    expect(Object.keys(DESGLOSE_TIENDA_COLUMNAS)).toEqual([
      "fecha",
      "tipo",
      "concepto",
      "monto",
      "origen",
    ]);
  });

  it("los filtros son cuatro: cierre, concepto y rango de fechas (R18)", () => {
    expect(DESGLOSE_TIENDA_FILTRO_LABEL.cierre).toBe("Cierre");
    expect(DESGLOSE_TIENDA_FILTRO_LABEL.concepto).toBe("Concepto");
    expect(DESGLOSE_TIENDA_FILTRO_LABEL.desde).toBe("Desde");
    expect(DESGLOSE_TIENDA_FILTRO_LABEL.hasta).toBe("Hasta");
  });

  it("el vacío y el error se explican, no se quedan mudos (R21/R5)", () => {
    expect(DESGLOSE_TIENDA_VACIO.length).toBeGreaterThan(0);
    expect(DESGLOSE_TIENDA_ERROR.length).toBeGreaterThan(0);
    expect(DESGLOSE_TIENDA_ERROR).toMatch(/desglose/i);
  });
});

describe("nombres accesibles del desglose (R4/R38)", () => {
  it("TODOS llevan el nombre de la tienda dentro", () => {
    for (const construir of Object.values(DESGLOSE_TIENDA_NOMBRE)) {
      expect(construir("Tienda Norte")).toContain("Tienda Norte");
    }
  });

  it("dos tiendas distintas nunca comparten un nombre accesible", () => {
    for (const construir of Object.values(DESGLOSE_TIENDA_NOMBRE)) {
      expect(construir("Tienda Norte")).not.toBe(construir("Tienda Sur"));
    }
  });
});
