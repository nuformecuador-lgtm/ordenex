import { describe, it, expect } from "vitest";

import {
  MARCA_CORTE,
  lineasDisponibles,
  recortarConElipsis,
  repartirLineas,
} from "@/lib/pdf/etiquetas-ajuste";

// Aritmetica del ajuste vertical de la etiqueta de guia: el texto NUNCA debe
// invadir la banda del QR + codigo de barras (bug: producto/monto/tienda se
// imprimian encima del QR cuando direccion o ubicacion se partian en varias
// lineas).

describe("repartirLineas", () => {
  it("no toca nada si todo cabe", () => {
    expect(repartirLineas([1, 2, 1, 1], 10)).toEqual([1, 2, 1, 1]);
  });

  it("recorta al campo mas alto, no en orden de aparicion", () => {
    // 1 + 4 + 1 + 1 = 7 lineas para un cupo de 6: la que sobra sale de la
    // direccion (4 lineas), no del ultimo campo.
    expect(repartirLineas([1, 4, 1, 1], 6)).toEqual([1, 3, 1, 1]);
  });

  it("iguala los campos altos antes de bajar de ahi", () => {
    expect(repartirLineas([5, 4, 1], 8)).toEqual([4, 3, 1]);
  });

  it("nunca deja un campo sin lineas: los nueve datos siguen presentes", () => {
    const cupo = repartirLineas([6, 5, 4, 3, 2, 1, 1], 7);
    expect(cupo).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(cupo.every((n) => n >= 1)).toBe(true);
  });

  it("respeta el cupo total exacto siempre que quepa una linea por campo", () => {
    for (const total of [7, 8, 9, 12, 30]) {
      const cupo = repartirLineas([4, 3, 5, 1, 2, 1, 1], total);
      expect(cupo.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(total);
      expect(Math.min(...cupo)).toBeGreaterThanOrEqual(1);
    }
  });

  it("un cupo imposible (menor que el numero de campos) no cuelga: minimo por campo", () => {
    expect(repartirLineas([3, 3, 3], 2)).toEqual([1, 1, 1]);
  });

  it("un campo vacio cuenta como una linea, no como cero", () => {
    expect(repartirLineas([0, 0], 10)).toEqual([1, 1]);
  });
});

describe("recortarConElipsis", () => {
  // Medidor lineal: 1 unidad por caracter. Basta para fijar el contrato; el
  // generador pasa `doc.getTextWidth`.
  const medir = (t: string) => t.length;

  it("devuelve las lineas intactas si caben", () => {
    const lineas = ["uno", "dos"];
    expect(recortarConElipsis(lineas, 2, 100, medir)).toEqual(lineas);
    expect(recortarConElipsis(lineas, 5, 100, medir)).toEqual(lineas);
  });

  it("corta al cupo y marca el corte en la ultima linea visible", () => {
    const out = recortarConElipsis(["uno", "dos", "tres"], 2, 100, medir);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe("uno");
    expect(out[1]).toBe(`dos${MARCA_CORTE}`);
  });

  it("la marca CABE en el ancho: come caracteres hasta que entra", () => {
    // Ancho 6 y la ultima linea visible mide 6: hay que soltar 3 caracteres
    // para que quepan los tres puntos.
    const out = recortarConElipsis(["abcdef", "ghi"], 1, 6, medir);
    expect(out).toHaveLength(1);
    expect(medir(out[0])).toBeLessThanOrEqual(6);
    expect(out[0].endsWith(MARCA_CORTE)).toBe(true);
  });

  it("un cupo de 0 aun dibuja una linea (nunca borra el campo entero)", () => {
    const out = recortarConElipsis(["uno", "dos"], 0, 100, medir);
    expect(out).toHaveLength(1);
  });
});

describe("lineasDisponibles", () => {
  it("da el cupo de la maqueta 100x100: 7 campos entre y=18 y el QR (y=66)", () => {
    // (66 - 18 - 6*1.0) / 4 + 1 = 11.5 -> 11 lineas para 7 campos, o sea 4 de
    // holgura para los que se parten (direccion, ubicacion, producto).
    expect(lineasDisponibles(18, 66, 4, 1.0, 7)).toBe(11);
  });

  it("la ultima LINEA BASE del cupo no pasa del limite", () => {
    for (const [inicio, limite, lh, gap, n] of [
      [18, 66, 4, 1.0, 7],
      [18, 66, 4, 1.5, 7],
      [20, 70, 3.6, 0.8, 7],
      [10, 90, 5, 2, 4],
    ] as Array<[number, number, number, number, number]>) {
      const total = lineasDisponibles(inicio, limite, lh, gap, n);
      const ultimaBase = inicio + (total - 1) * lh + (n - 1) * gap;
      expect(ultimaBase).toBeLessThanOrEqual(limite);
      // Y una linea mas SI se pasaria: el cupo es el maximo, no un numero timido.
      expect(ultimaBase + lh).toBeGreaterThan(limite);
    }
  });

  it("nunca devuelve menos de una linea por campo, aunque no quepan", () => {
    expect(lineasDisponibles(18, 25, 4, 1.0, 7)).toBe(7);
    expect(lineasDisponibles(18, 18, 4, 1.0, 7)).toBe(7);
  });

  it("crece con el espacio disponible", () => {
    const cerca = lineasDisponibles(18, 66, 4, 1.0, 7);
    const lejos = lineasDisponibles(18, 90, 4, 1.0, 7);
    expect(lejos).toBeGreaterThan(cerca);
  });
});
