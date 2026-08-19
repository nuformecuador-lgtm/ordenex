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
import { SALDO_SIGNO_LABEL as SALDO_SIGNO_LABEL_TABLA } from "@/app/(app)/wallet/tiendas/_components/saldo-tienda-signo-label";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";

// Feature 171 (T2.1, R13/R20) — el desglose por tienda dice lo MISMO que `/mi-wallet` para
// el mismo valor, y lo mismo que la tabla de saldos para el mismo signo.
//
// Por qué se prueba la IDENTIDAD (`toBe`, misma referencia) y no la igualdad: dos mapas con
// los mismos textos hoy son dos mapas que mañana divergen en cuanto alguien renombre una
// categoría en uno de los dos, y nadie se enteraría — los dos seguirían pasando un test de
// igualdad escrito con los valores de hoy. Compartir el objeto hace que la divergencia sea
// imposible, no improbable.

describe("etiquetas del desglose por tienda — R20: las MISMAS de /mi-wallet", () => {
  it("concepto, tipo y origen son el MISMO objeto que usa /mi-wallet, no una copia", () => {
    expect(CATEGORIA_TIENDA_LABEL).toBe(miWalletLabels.CATEGORIA_TIENDA_LABEL);
    expect(ORIGEN_TIENDA_LABEL).toBe(miWalletLabels.ORIGEN_TIENDA_LABEL);
    expect(TIPO_TIENDA_LABEL).toBe(miWalletLabels.TIPO_TIENDA_LABEL);
    expect(origenLabel).toBe(miWalletLabels.origenLabel);
  });

  it("el helper de moneda es el MISMO, así que ninguno de los dos puede parsear un monto", () => {
    expect(money).toBe(miWalletLabels.money);
    // Feature 230: la cola decide el redondeo y NO se pinta. Estas dos líneas
    // afirmaban «el céntimo sobrevive a la pantalla» (`₡1.000,10`), y eso ya no
    // es cierto por diseño: el céntimo sigue en el dato y en las descargas, pero
    // no se ve. Que el camino no convierta a número se afirma ahora donde se
    // puede afirmar de verdad —el barrido de `Number(`/`parseFloat(` sobre el
    // fuente del módulo, en `moneda-formato` y en la guardia de la 230—.
    // Lo que estas dos siguen midiendo es el formato compartido: el `,10` baja y
    // el signo del negativo va DELANTE del símbolo.
    expect(money("1000.10")).toBe("₡1.000");
    expect(money("-452.00")).toBe("-₡452");
    // `null` = aún no cargado. NO es un cero: un cero falso en una pantalla de dinero miente.
    expect(money(null)).toBe("—");
  });

  it("las opciones del filtro de concepto salen del SEED del enum (R44: incluye pago_tienda)", () => {
    expect(CATEGORIA_TIENDA_OPTIONS).toBe(miWalletLabels.CATEGORIA_TIENDA_OPTIONS);

    const valores = CATEGORIA_TIENDA_OPTIONS.map((o) => o.value);
    expect(valores[0]).toBe(""); // "todos los conceptos"
    expect(valores.slice(1)).toEqual([...WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED]);
    // R44: el concepto que hoy nadie emite ya es filtrable, porque la lista NO está escrita
    // a mano — sale del catálogo.
    expect(valores).toContain("pago_tienda");
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

describe("textos propios del desglose por tienda (R7, P1)", () => {
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
    // Con varias filas abiertas a la vez, un nombre genérico no identifica nada: es el
    // motivo entero de que estos nombres sean funciones y no literales.
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
