import { describe, it, expect } from "vitest";

import { porcentajesDeReparto } from "@/components/private/analytics/porcentajes";

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
