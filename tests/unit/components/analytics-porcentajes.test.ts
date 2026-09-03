import { describe, expect, it } from "vitest";

import { formatearValor } from "@/components/private/analytics/formato";
import { pesosDeReparto, textoDePeso } from "@/components/private/analytics/porcentajes";

/**
 * Las CUOTAS del resto mayor en MILESIMAS de la barra, que es la granularidad con la que se
 * dibuja desde la ficha 364 (`ESCALA = 1000`). Es geometría, no texto: lo que se escribe es la
 * razón exacta y lo comprueban los bloques de abajo.
 */
const enMilesimas = (valores: readonly (number | null)[]) =>
  pesosDeReparto(valores).map((peso) => Math.round(peso.cuota * 1000));

/** Como lo escribe la gráfica: el número lo pone el formateador de la casa. */
const escribirPeso = (valores: readonly (number | null)[], indice: number) => {
  const peso = pesosDeReparto(valores)[indice];
  if (!peso) throw new Error(`no hay peso en la posición ${indice}`);
  return textoDePeso(peso, (fraccion) => formatearValor(fraccion, "porcentaje"));
};

describe("el reparto que gobierna la GEOMETRIA (resto mayor)", () => {
  // El ejemplo con el que se pidió la función: 10 órdenes = 3 + 5 + 2.
  it("reparte el caso exacto tal cual", () => {
    expect(enMilesimas([3, 5, 2])).toEqual([300, 500, 200]);
  });

  it("devuelve fracciones, no puntos: es lo que espera el formateador de la casa", () => {
    expect(pesosDeReparto([1, 1]).map((p) => p.cuota)).toEqual([0.5, 0.5]);
  });

  // ⚠ EL CASO QUE JUSTIFICA EL RESTO MAYOR. Redondeando cada parte por su cuenta, tres tercios
  // dan 33 + 33 + 33 = 99: una barra que no reparte todo, en un gráfico que dibuja un todo.
  it("tres partes iguales suman la barra entera, no el 99,9 %", () => {
    expect(enMilesimas([1, 1, 1])).toEqual([334, 333, 333]);
  });

  // Y por el otro lado: 7 + 7 + 1 sobre 15 redondeado por partes da 47 + 47 + 7 = 101.
  //
  // Se comprueba la INVARIANTE (suma la barra entera, y ninguna parte a más de una milésima de
  // su valor exacto) y no la terna literal: con los tres restos empatados el orden lo decide el
  // último bit del flotante, y clavar la terna sería atornillar ruido de coma flotante en vez
  // de la propiedad que de verdad importa.
  it("no se pasa de la barra cuando los restos empujan hacia arriba", () => {
    const cuotas = enMilesimas([7, 7, 1]);

    expect(cuotas.reduce((s, p) => s + p, 0)).toBe(1000);
    for (const [i, exacto] of [466.67, 466.67, 66.67].entries()) {
      expect(Math.abs((cuotas[i] ?? 0) - exacto)).toBeLessThan(1);
    }
  });

  it("suma la barra entera en repartos incómodos de cualquier tamaño", () => {
    for (const valores of [[1, 2, 3, 4, 5, 6], [1, 1, 1, 1, 1, 1, 1], [999, 1], [2, 3, 3, 3, 3]]) {
      expect(enMilesimas(valores).reduce((s, p) => s + p, 0)).toBe(1000);
    }
  });

  // Los puntos que sobran van a los RESTOS MAYORES, no al primero que pase: la parte más
  // perjudicada por el truncamiento es la que se lleva el punto.
  it("el punto que sobra va a la parte con mayor resto", () => {
    // 1/6 = 166,66 milésimas (resto ,66) y 5/6 = 833,33 (resto ,33): el punto es del primero.
    expect(enMilesimas([1, 5])).toEqual([167, 833]);
  });

  // Sin desempate por índice, dos restos iguales podrían ordenarse distinto entre ejecuciones
  // y el MISMO dato pintaría dos repartos distintos.
  it("con restos empatados el reparto es estable y determinista", () => {
    const primera = enMilesimas([1, 1, 1]);

    for (let n = 0; n < 5; n += 1) expect(enMilesimas([1, 1, 1])).toEqual(primera);
  });

  describe("lo que no es un reparto devuelve ceros, no `NaN`", () => {
    it("una lista vacía", () => {
      expect(pesosDeReparto([])).toEqual([]);
    });

    // Dividir entre cero daría `NaN` y en pantalla un «NaN %». Cero es la respuesta correcta:
    // nadie tiene peso sobre una nada.
    it("todo a cero", () => {
      expect(enMilesimas([0, 0, 0])).toEqual([0, 0, 0]);
      expect(pesosDeReparto([0, 0, 0]).map((p) => p.exacta)).toEqual([0, 0, 0]);
    });

    it("los negativos no pesan ni arrastran el total", () => {
      expect(enMilesimas([-5, -5])).toEqual([0, 0]);
      expect(enMilesimas([-1, 1, 1])).toEqual([0, 500, 500]);
    });

    // `null` es dato AUSENTE: no aporta al total y no recibe peso, pero conserva su posición
    // para que el peso de cada porción siga cuadrando con la porción que le toca.
    it("el dato ausente cuenta como cero y conserva su sitio", () => {
      expect(enMilesimas([null, 3, 1])).toEqual([0, 750, 250]);
    });
  });
});

// ─── LO QUE SE ESCRIBE ES LA RAZON EXACTA (ficha 364) ─────────────────────────────────────
//
// El defecto que reparó la ficha: el texto pegado a un segmento salía de la CUOTA del resto
// mayor, así que 259 de 877 se escribía «30 %» mientras el KPI de la misma pantalla, midiendo
// la misma razón, escribía «29,5 %». Que los dos coincidan a través de sus caminos reales lo
// comprueba `analytics-kpi-y-barra.test.ts`; aquí se fija la propiedad del módulo.
describe("el texto de una parte NO es su cuota, es su razón exacta", () => {
  it("una parte cuya cuota y cuya razón difieren se escribe por la razón", () => {
    const valores = [259, 20, 80, 30, 8, 480]; // el caso real: 877 órdenes
    const peso = pesosDeReparto(valores)[0];

    expect(peso?.exacta).toBeCloseTo(259 / 877, 12);
    // La cuota NO es la razón —es lo que se dibuja— y por eso el texto no puede salir de ella.
    expect(peso?.cuota).not.toBeCloseTo(259 / 877, 4);
    expect(escribirPeso(valores, 0)).toBe(formatearValor(259 / 877, "porcentaje"));
  });

  // Dos partes de igual valor tienen la misma razón exacta, así que dicen lo mismo SIEMPRE —ya
  // no depende de a quién le tocara el punto sobrante del desempate, que era la mitad del
  // defecto de la 290.
  it("dos partes de igual valor dicen exactamente lo mismo", () => {
    expect(escribirPeso([1, 0, 0, 1, 0, 231], 0)).toBe(escribirPeso([1, 0, 0, 1, 0, 231], 3));
  });
});

// ─── LA PARTE QUE EXISTE Y NO LLEGA A ESCRIBIRSE (features 290/291, ficha 364) ────────────
//
// EL CASO EXACTO DE PRODUCCIÓN, no uno inventado: el panel «Detalle gestión» del 2026-08-27,
// con 233 órdenes repartidas en `[1, 0, 0, 1, 0, 231]`. Entregadas y Reprogramadas valen LO
// MISMO (1 = 0,429 %) y en pantalla salían distintas: «1 (1 %)» una y «1 (0 %)» la otra, ésta
// además sin franja, porque el entero redondeado se usaba también como anchura.
describe("la porción diminuta: franja visible y ningún «0 %» mentiroso", () => {
  const PRODUCCION = [1, 0, 0, 1, 0, 231];
  const ENTREGADAS = 0;
  const UN_CERO_DE_VERDAD = 1;
  const REPROGRAMADAS = 3;
  const MAYOR = 5;

  const escribir = (indice: number) => escribirPeso(PRODUCCION, indice);
  const ancho = (indice: number) => pesosDeReparto(PRODUCCION)[indice]?.ancho ?? Number.NaN;

  // ⚠ EL CORAZÓN DE LA 290. Dos categorías con el MISMO valor no pueden rotularse distinto:
  // quien lee la pantalla concluye que una ocurrió y la otra no.
  //
  // Y LO QUE CAMBIO CON LA 364: con un decimal, 1 de 233 ya SE PUEDE escribir —«0,4 %»— así que
  // este caso deja de necesitar el «menor que». Lo que no cambia es el compromiso: nunca un
  // «0 %» pegado a una cifra de 1. El caso que todavía necesita el «<» está más abajo.
  it("las dos categorías de valor 1 dicen lo mismo, y no es «0 %»", () => {
    expect(escribir(ENTREGADAS)).toBe(escribir(REPROGRAMADAS));
    expect(escribir(REPROGRAMADAS)).not.toBe(formatearValor(0, "porcentaje"));
    expect(escribir(REPROGRAMADAS)).toBe(formatearValor(1 / 233, "porcentaje"));
  });

  // Y el reverso, que es lo que hace que la etiqueta pequeña signifique algo: un cero medido
  // sigue siendo un cero. Si las dos cosas se escribieran igual, no distinguiría nada.
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
    expect(ancho(MAYOR)).toBeLessThan(pesos[MAYOR]?.cuota ?? 0);
    // Y el descuento NO se cuela en lo que se lee: el mayor sigue escribiendo su razón exacta.
    expect(escribir(MAYOR)).toBe(formatearValor(231 / 233, "porcentaje"));
  });

  // El método del resto mayor sigue intacto: es lo que hace que la barra mida 100 %.
  it("las cuotas siguen siendo las del resto mayor y suman la barra entera", () => {
    expect(enMilesimas(PRODUCCION).reduce((suma, punto) => suma + punto, 0)).toBe(1000);
    expect(enMilesimas(PRODUCCION)).toEqual([4, 0, 0, 4, 0, 992]);
  });

  // Una astilla de 0,05 % sería un ancho «distinto de cero» que no se ve: sobre los 300-600 px
  // de la barra son 0,3 px. El mínimo tiene que ser del orden del píxel y medio, y por eso NO
  // se deriva de `ESCALA` (subirla a 1000 lo habría encogido diez veces — ficha 364).
  it("la astilla es visible: al menos medio punto de la barra", () => {
    expect(ancho(REPROGRAMADAS)).toBeGreaterThanOrEqual(0.005);
  });
});

// ─── EL «MENOR QUE», Y QUE SU UMBRAL SE LO PREGUNTA AL FORMATEADOR (ficha 364) ────────────
//
// El umbral ya no es «un punto entero» escrito a mano en este módulo: era una suposición sobre
// la precisión de OTRO archivo (`formato.ts`), y dos módulos con dos ideas distintas de cuántos
// decimales se escriben es exactamente lo que produjo el defecto de esta ficha.
describe("el «<» aparece justo cuando el formateador escribiría un cero", () => {
  // 1 de 3.000 es 0,033 %: con un decimal NO se puede escribir, y saldría «0 %» pegado a un 1.
  const CASI_NADA = [1, 2999];

  it("una parte que el formateador no sabe escribir dice «<», no «0 %»", () => {
    const escrito = escribirPeso(CASI_NADA, 0);

    expect(escrito).not.toBe(formatearValor(0, "porcentaje"));
    expect(escrito).toBe(`<${formatearValor(0.001, "porcentaje")}`);
  });

  // ⚠ EL UMBRAL SALE DEL FORMATEADOR QUE SE LE PASA, no de una constante de este módulo. Con un
  // formateador de puntos enteros el mismo módulo dice «<1 %», y con uno de un decimal dice
  // «<0,1 %»: si el umbral estuviera escrito aquí, uno de los dos casos mentiría.
  it("el paso del «menor que» lo dicta el formateador, no el módulo", () => {
    const conDecimal = (f: number) =>
      new Intl.NumberFormat("es-CR", { style: "percent", maximumFractionDigits: 1 }).format(f);
    const enteros = (f: number) =>
      new Intl.NumberFormat("es-CR", { style: "percent", maximumFractionDigits: 0 }).format(f);
    const peso = pesosDeReparto(CASI_NADA)[0];
    if (!peso) throw new Error("no hay peso");

    expect(textoDePeso(peso, conDecimal)).toBe(`<${conDecimal(0.001)}`);
    expect(textoDePeso(peso, enteros)).toBe(`<${enteros(0.01)}`);
    // Y una parte que el formateador de enteros no sabe escribir pero el de decimales SÍ, se
    // escribe con su número en vez de con el «<»: el «menor que» es el último recurso.
    const media = pesosDeReparto([4, 996])[0]; // 4 de 1.000 = 0,4 %
    if (!media) throw new Error("no hay peso");
    expect(textoDePeso(media, conDecimal)).toBe(conDecimal(0.004));
    expect(textoDePeso(media, enteros)).toBe(`<${enteros(0.01)}`);
  });

  // Un cero de verdad no lleva «<» con ningún formateador: sigue siendo otro hecho.
  it("el cero de verdad nunca lleva «menor que»", () => {
    expect(escribirPeso(CASI_NADA, 1)).not.toContain("<");
    expect(escribirPeso([0, 5], 0)).toBe(formatearValor(0, "porcentaje"));
  });
});
