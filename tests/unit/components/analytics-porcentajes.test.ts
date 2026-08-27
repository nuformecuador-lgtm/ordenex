import { describe, it, expect } from "vitest";

import { formatearValor } from "@/components/private/analytics/formato";
import {
  pesosDeReparto,
  porcentajesDeReparto,
  textoDePeso,
} from "@/components/private/analytics/porcentajes";

/** Los pesos en PUNTOS enteros, que es como se leen en pantalla. */
const enPuntos = (valores: readonly (number | null)[]) =>
  porcentajesDeReparto(valores).map((f) => Math.round(f * 100));

describe("El reparto en porcentajes", () => {
  // El ejemplo con el que se pidió la función: 10 órdenes = 3 + 5 + 2.
  it("reparte el caso exacto tal cual", () => {
    expect(enPuntos([3, 5, 2])).toEqual([30, 50, 20]);
  });

  it("devuelve fracciones, no puntos: es lo que espera el formateador de la casa", () => {
    expect(porcentajesDeReparto([1, 1])).toEqual([0.5, 0.5]);
  });

  // ⚠ EL CASO QUE JUSTIFICA EL RESTO MAYOR. Redondeando cada parte por su cuenta, tres tercios
  // dan 33 + 33 + 33 = 99: un reparto que no reparte todo, en un gráfico que dibuja un todo.
  it("tres partes iguales suman 100, no 99", () => {
    expect(enPuntos([1, 1, 1])).toEqual([34, 33, 33]);
  });

  // Y por el otro lado: 7 + 7 + 1 sobre 15 redondeado por partes da 47 + 47 + 7 = 101.
  //
  // Se comprueba la INVARIANTE (suma 100, y ninguna parte a más de un punto de su valor
  // exacto) y no la terna literal: con los tres restos empatados en ,666 el orden lo decide el
  // último bit del flotante, y clavar `[47, 46, 7]` sería atornillar ruido de coma flotante en
  // vez de la propiedad que de verdad importa.
  it("no se pasa de 100 cuando los restos empujan hacia arriba", () => {
    const puntos = enPuntos([7, 7, 1]);

    expect(puntos.reduce((s, p) => s + p, 0)).toBe(100);
    for (const [i, exacto] of [46.67, 46.67, 6.67].entries()) {
      expect(Math.abs((puntos[i] ?? 0) - exacto)).toBeLessThan(1);
    }
  });

  it("suma 100 exacto en repartos incómodos de cualquier tamaño", () => {
    for (const valores of [[1, 2, 3, 4, 5, 6], [1, 1, 1, 1, 1, 1, 1], [999, 1], [2, 3, 3, 3, 3]]) {
      expect(enPuntos(valores).reduce((s, p) => s + p, 0)).toBe(100);
    }
  });

  // Los puntos que sobran van a los RESTOS MAYORES, no al primero que pase: la parte más
  // perjudicada por el truncamiento es la que se lleva el punto.
  it("el punto que sobra va a la parte con mayor resto", () => {
    // 1/6 = 16,66 (resto ,66) y 5/6 = 83,33 (resto ,33): el punto es del primero.
    expect(enPuntos([1, 5])).toEqual([17, 83]);
  });

  // Sin desempate por índice, dos restos iguales podrían ordenarse distinto entre ejecuciones
  // y el MISMO dato pintaría dos repartos distintos.
  it("con restos empatados el reparto es estable y determinista", () => {
    const primera = enPuntos([1, 1, 1]);

    for (let n = 0; n < 5; n += 1) expect(enPuntos([1, 1, 1])).toEqual(primera);
  });

  describe("lo que no es un reparto devuelve ceros, no `NaN`", () => {
    it("una lista vacía", () => {
      expect(porcentajesDeReparto([])).toEqual([]);
    });

    // Dividir entre cero daría `NaN` y en pantalla un «NaN %». Cero es la respuesta correcta:
    // nadie tiene peso sobre una nada.
    it("todo a cero", () => {
      expect(enPuntos([0, 0, 0])).toEqual([0, 0, 0]);
    });

    it("los negativos no pesan ni arrastran el total", () => {
      expect(enPuntos([-5, -5])).toEqual([0, 0]);
      expect(enPuntos([-1, 1, 1])).toEqual([0, 50, 50]);
    });

    // `null` es dato AUSENTE: no aporta al total y no recibe peso, pero conserva su posición
    // para que el peso de cada porción siga cuadrando con la porción que le toca.
    it("el dato ausente cuenta como cero y conserva su sitio", () => {
      expect(enPuntos([null, 3, 1])).toEqual([0, 75, 25]);
    });
  });
});

// ─── LA PARTE QUE EXISTE Y NO LLEGA AL 1 % (feature 290) ──────────────────────────────────
//
// EL CASO EXACTO DE PRODUCCIÓN, no uno inventado: el panel «Detalle gestión» del 2026-08-27,
// con 233 órdenes repartidas en `[1, 0, 0, 1, 0, 231]`. Entregadas y Reprogramadas valen LO
// MISMO (1 = 0,429 %) y en pantalla salían distintas: «1 (1 %)» una y «1 (0 %)» la otra, ésta
// además sin franja, porque el entero redondeado se usaba también como anchura.
describe("la porción diminuta: etiqueta «<1 %» y franja visible (feature 290)", () => {
  const PRODUCCION = [1, 0, 0, 1, 0, 231];
  const ENTREGADAS = 0;
  const UN_CERO_DE_VERDAD = 1;
  const REPROGRAMADAS = 3;
  const MAYOR = 5;

  /** Como lo escribe la gráfica: el número lo pone el formateador de la casa. */
  const escribir = (indice: number) => {
    const peso = pesosDeReparto(PRODUCCION)[indice];
    if (!peso) throw new Error(`no hay peso en la posición ${indice}`);
    return textoDePeso(peso, (fraccion) => formatearValor(fraccion, "porcentaje"));
  };

  const ancho = (indice: number) => pesosDeReparto(PRODUCCION)[indice]?.ancho ?? Number.NaN;

  // ⚠ EL CORAZÓN DE LA FICHA. Dos categorías con el MISMO valor no pueden rotularse distinto:
  // quien lee la pantalla concluye que una ocurrió y la otra no. Da igual a cuál de las dos le
  // tocara el punto sobrante del resto mayor.
  it("las dos categorías de valor 1 dicen lo mismo, y no es «0 %»", () => {
    expect(escribir(ENTREGADAS)).toBe(escribir(REPROGRAMADAS));
    expect(escribir(REPROGRAMADAS)).not.toBe(formatearValor(0, "porcentaje"));
    expect(escribir(REPROGRAMADAS)).toBe(`<${formatearValor(0.01, "porcentaje")}`);
  });

  // Y el reverso, que es lo que hace que «<1 %» signifique algo: un cero medido sigue siendo
  // un cero. Si las dos cosas se escribieran igual, la etiqueta no distinguiría nada.
  it("una categoría que vale cero de verdad sigue diciendo «0 %»", () => {
    expect(escribir(UN_CERO_DE_VERDAD)).toBe(formatearValor(0, "porcentaje"));
    expect(escribir(UN_CERO_DE_VERDAD)).not.toContain("<");
  });

  it("ninguna categoría con valor queda sin franja, y la que vale cero no recibe ninguna", () => {
    for (const [indice, valor] of PRODUCCION.entries()) {
      if (valor > 0) expect(ancho(indice), `posición ${indice}`).toBeGreaterThan(0);
      else expect(ancho(indice), `posición ${indice}`).toBe(0);
    }
  });

  // La astilla no se saca de la nada: la paga el segmento mayor. Sin esto la barra mediría más
  // de lo que dice y `flex` encogería en silencio todas las demás franjas.
  it("la astilla la paga el mayor: los anchos siguen sumando 100 %", () => {
    const pesos = pesosDeReparto(PRODUCCION);

    expect(pesos.reduce((suma, peso) => suma + peso.ancho, 0)).toBeCloseTo(1, 10);
    expect(ancho(MAYOR)).toBeLessThan(pesos[MAYOR]?.fraccion ?? 0);
    // Y el descuento NO se cuela en lo que se lee: el mayor sigue escribiendo su 99 %.
    expect(escribir(MAYOR)).toBe(formatearValor(0.99, "porcentaje"));
  });

  // El método del resto mayor sigue intacto: es lo que hace que la columna sume 100.
  it("los porcentajes escritos siguen siendo los del resto mayor", () => {
    expect(enPuntos(PRODUCCION).reduce((suma, punto) => suma + punto, 0)).toBe(100);
    expect(porcentajesDeReparto(PRODUCCION)).toEqual([0.01, 0, 0, 0, 0, 0.99]);
  });

  // Una astilla de 0,05 % sería un ancho «distinto de cero» que no se ve: sobre los 300-600 px
  // de la barra son 0,3 px. El mínimo tiene que ser del orden del píxel y medio.
  it("la astilla es visible: al menos medio punto de la barra", () => {
    expect(ancho(REPROGRAMADAS)).toBeGreaterThanOrEqual(0.005);
  });
});
