import { describe, it, expect } from "vitest";

import {
  celdaDeHoja,
  celdasPorHoja,
  getHojaEtiqueta,
  HOJAS_ETIQUETA,
  type HojaEtiqueta,
} from "@/lib/config/etiquetas-hoja";
import { crearLayout } from "@/lib/pdf/etiquetas-layout";
import {
  ANCHO_UTIL_BASE_MM,
  BARCODE_MM,
  CUERPOS_BASE,
  MARGEN_MM,
  QR_MM,
} from "@/lib/pdf/etiquetas-maqueta";

// Feature 150 (T5) — Aritmetica del escalado, en Node y sin DOM.
//
// Feature 350 (T7/T15) — Reescrito fila a fila segun `design.md` §11. Lo que se
// retira y que lo sustituye:
//
//  | Asercion retirada                              | Sustituto                                   | ¿mas o menos fuerte? |
//  |------------------------------------------------|---------------------------------------------|----------------------|
//  | «el factor sale del lado MENOR» (`s`)           | `k` sale del ANCHO + monotonia de capacidad | MAS: afirma capacidad, no aritmetica |
//  | «bloque cuadrado centrado; `offY` = 43,5 en A4» | R9: la franja sin usar es EXACTAMENTE el margen | MAS: aquello certificaba los 87 mm en blanco |
//  | «todas las constantes escalan con `s`»          | dos escalas separadas (geometria / tipografia) | equivalente en rigor |
//  | «encaje en la pagina, offsets >= 0»             | V3 sobre el PDF (`etiquetas-pdf.test.ts`)   | MAS: aritmetica -> tinta |
//  | «densidad del raster nunca baja»                | se CONSERVA aqui, con `k` en vez de `s`     | igual |

const HOJA_100 = getHojaEtiqueta("100x100");
const HOJA_4X6 = getHojaEtiqueta("4x6in");
const HOJA_A4 = getHojaEtiqueta("a4");
const HOJA_CARTA = getHojaEtiqueta("carta");

describe("crearLayout — la escala TIPOGRAFICA sale del ancho (R11)", () => {
  it("k = anchoUtil / anchoUtilBase en las cuatro hojas", () => {
    const esperado: Array<[HojaEtiqueta, number]> = [
      [HOJA_100, 1],
      [HOJA_4X6, (101.6 - 12) / 88],
      [HOJA_A4, (210 - 12) / 88],
      [HOJA_CARTA, (215.9 - 12) / 88],
    ];
    for (const [hoja, k] of esperado) {
      expect(crearLayout(hoja).k, `k de ${hoja.id}`).toBeCloseTo(k, 10);
    }
    // Los numeros, escritos: 1 / 1,0182 / 2,25 / 2,3170.
    expect(crearLayout(HOJA_4X6).k).toBeCloseTo(1.0182, 4);
    expect(crearLayout(HOJA_A4).k).toBeCloseTo(2.25, 4);
    expect(crearLayout(HOJA_CARTA).k).toBeCloseTo(2.317, 3);
  });

  it("NO sale del lado menor: en A4 el factor viejo era 2,1 y ahora es 2,25", () => {
    // La mutacion M4 revierte esto. El factor del lado menor ignoraba los 87 mm
    // de alto sobrante; el del ancho los convierte en lineas.
    const a4 = crearLayout(HOJA_A4);
    const factorLadoMenor = Math.min(HOJA_A4.anchoMm, HOJA_A4.altoMm) / 100;
    expect(factorLadoMenor).toBeCloseTo(2.1, 10);
    expect(a4.k).not.toBeCloseTo(factorLadoMenor, 3);
  });

  it("los cuerpos base viajan a la hoja multiplicados por k, y solo por k", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      expect(l.cuerpos.rotulo).toBeCloseTo(CUERPOS_BASE.rotulo * l.k, 10);
      expect(l.cuerpos.guia).toBeCloseTo(CUERPOS_BASE.guia * l.k, 10);
      expect(l.cuerpos.remision).toBeCloseTo(CUERPOS_BASE.remision * l.k, 10);
      expect(l.cuerpos.destinatario).toBeCloseTo(CUERPOS_BASE.destinatario * l.k, 10);
      expect(l.cuerpos.telefono).toBeCloseTo(CUERPOS_BASE.telefono * l.k, 10);
      expect(l.cuerpos.direccion).toBeCloseTo(CUERPOS_BASE.direccion * l.k, 10);
      expect(l.cuerpos.ubicacion).toBeCloseTo(CUERPOS_BASE.ubicacion * l.k, 10);
      expect(l.cuerpos.importe).toBeCloseTo(CUERPOS_BASE.importe * l.k, 10);
      expect(l.cuerpos.detalle).toBeCloseTo(CUERPOS_BASE.detalle * l.k, 10);
      expect(l.cuerpo(37)).toBeCloseTo(37 * l.k, 10);
    }
  });

  it("la GEOMETRIA no escala: un milimetro de la maqueta es un milimetro de papel", () => {
    // Es la otra mitad de la separacion de escalas. Con el factor unico de la
    // 150, `x(7,5) - x(0)` valia `7,5 * s`; ahora vale 7,5 en las cuatro hojas.
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      for (const v of [1, 7.5, 26, 88]) {
        expect(l.x(v) - l.x(0), `${hoja.id} deforma X`).toBeCloseTo(v, 10);
        expect(l.y(v) - l.y(0), `${hoja.id} deforma Y`).toBeCloseTo(v, 10);
      }
    }
  });
});

describe("crearLayout — la celda se usa entera (R9/R10)", () => {
  it("la franja sin usar es EXACTAMENTE el margen, no la mitad del papel", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      expect(l.celda).toEqual({
        x0: 0,
        y0: 0,
        ancho: hoja.anchoMm,
        alto: hoja.altoMm,
      });
      expect(l.margen).toBe(MARGEN_MM);
      expect(l.anchoUtil).toBeCloseTo(hoja.anchoMm - 2 * MARGEN_MM, 10);
      expect(l.altoUtil).toBeCloseTo(hoja.altoMm - 2 * MARGEN_MM, 10);
      // Las cuatro franjas de papel sin contenido miden el margen y nada mas.
      expect(l.x(0)).toBeCloseTo(MARGEN_MM, 10);
      expect(l.y(0)).toBeCloseTo(MARGEN_MM, 10);
      expect(hoja.anchoMm - l.x(l.anchoUtil)).toBeCloseTo(MARGEN_MM, 10);
      expect(hoja.altoMm - l.y(l.altoUtil)).toBeCloseTo(MARGEN_MM, 10);
    }
  });

  it("el alto util NO se recorta al del lado menor: A4 gana 197 mm de texto", () => {
    // Con el bloque cuadrado centrado de la 150, A4 tenia 88 mm de alto util y
    // 43,5 mm de papel en blanco arriba y otros tantos abajo. Ahora tiene 285.
    const a4 = crearLayout(HOJA_A4);
    expect(a4.altoUtil).toBeCloseTo(285, 10);
    expect(a4.altoUtil - ANCHO_UTIL_BASE_MM).toBeGreaterThan(190);
  });

  it("el alto util crece con el area de la hoja (R10, precondicion de R11)", () => {
    const porArea = [...HOJAS_ETIQUETA].sort(
      (a, b) => a.anchoMm * a.altoMm - b.anchoMm * b.altoMm,
    );
    // Lo que de verdad importa para la capacidad es el alto util MEDIDO EN
    // LINEAS de la celda base, es decir `altoUtil / k`.
    const enLineasBase = porArea.map((h) => {
      const l = crearLayout(h);
      return l.altoUtil / l.k;
    });
    expect(enLineasBase[0]).toBeCloseTo(88, 6);
    for (let i = 1; i < enLineasBase.length; i++) {
      expect(enLineasBase[i]).toBeGreaterThan(enLineasBase[0]);
    }
  });
});

describe("crearLayout — QR y codigo de barras (R12)", () => {
  it("nunca encogen por debajo de los de la celda base", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      expect(l.qrMm, `${hoja.id} encoge el QR`).toBeGreaterThanOrEqual(QR_MM);
      expect(l.barcodeMm, `${hoja.id} encoge el barcode`).toBeGreaterThanOrEqual(BARCODE_MM);
      expect(l.qrMm).toBeCloseTo(QR_MM * Math.max(1, l.k), 10);
      expect(l.barcodeMm).toBeCloseTo(BARCODE_MM * Math.max(1, l.k), 10);
    }
  });

  it("una celda mas ANGOSTA que la base tampoco los encoge", () => {
    // Control del `max(1, k)`. Con la rejilla 2 x 2 que propone Q1 la celda de
    // A4 sale de 105 mm y `k` queda por ENCIMA de 1 (1,057), asi que ese caso no
    // ejerce el tope; se usa una rejilla 3 x 3 hipotetica, que da celdas de 70 mm
    // y `k = 0,659`. Sin el tope, ahi el QR bajaria de 26 mm y R12 se violaria.
    const a4Rejilla: HojaEtiqueta = { ...HOJA_A4, columnas: 3, filas: 3 };
    const l = crearLayout(a4Rejilla, 0);
    expect(l.k).toBeLessThan(1);
    expect(l.qrMm).toBe(QR_MM);
    expect(l.barcodeMm).toBe(BARCODE_MM);
    expect(l.barcodeRaster).toEqual({ width: 2, height: 60, fontSize: 18 });
    // Y con la rejilla 2 x 2 de Q1 la celda es MAS ancha que la base: dato para
    // quien firme, porque significa que «4-up» no da capacidad por linea.
    const q1 = crearLayout({ ...HOJA_A4, columnas: 2, filas: 2 }, 0);
    expect(q1.celda.ancho).toBeCloseTo(105, 10);
    expect(q1.k).toBeGreaterThan(1);
  });

  it("la densidad del raster del barcode nunca baja (se CONSERVA de la 150)", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      expect(l.barcodeRaster.width).toBeGreaterThanOrEqual(2 * l.k);
      expect(l.barcodeRaster.height).toBeGreaterThanOrEqual(60 * l.k);
      expect(Number.isInteger(l.barcodeRaster.width)).toBe(true);
      expect(Number.isInteger(l.barcodeRaster.height)).toBe(true);
    }
    // Con 100x100 se conservan exactamente las opciones historicas (feature 32).
    expect(crearLayout(HOJA_100).barcodeRaster).toEqual({
      width: 2,
      height: 60,
      fontSize: 18,
    });
  });
});

describe("celdaDeHoja — la rejilla (T5, mitad adelantada de Q1)", () => {
  it("con 1 x 1 la celda es la hoja entera y empieza en el origen", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      expect(hoja.columnas).toBe(1);
      expect(hoja.filas).toBe(1);
      expect(celdasPorHoja(hoja)).toBe(1);
      expect(celdaDeHoja(hoja, 0)).toEqual({
        x0: 0,
        y0: 0,
        ancho: hoja.anchoMm,
        alto: hoja.altoMm,
      });
    }
  });

  it("con un 2 x 2 hipotetico las cuatro celdas cubren la hoja sin hueco ni solape", () => {
    // El catalogo no lo usa todavia: esto es lo que hace que firmar Q1 sea
    // cambiar dos numeros de una tabla y no reescribir el motor.
    const a4: HojaEtiqueta = { ...HOJA_A4, columnas: 2, filas: 2 };
    expect(celdasPorHoja(a4)).toBe(4);
    const celdas = [0, 1, 2, 3].map((i) => celdaDeHoja(a4, i));

    // Sin hueco: el area de las cuatro suma la de la hoja.
    const area = celdas.reduce((s, c) => s + c.ancho * c.alto, 0);
    expect(area).toBeCloseTo(a4.anchoMm * a4.altoMm, 6);

    // Sin solape: ningun par se corta.
    for (let i = 0; i < celdas.length; i++) {
      for (let j = i + 1; j < celdas.length; j++) {
        const a = celdas[i];
        const b = celdas[j];
        const solapa =
          a.x0 < b.x0 + b.ancho &&
          b.x0 < a.x0 + a.ancho &&
          a.y0 < b.y0 + b.alto &&
          b.y0 < a.y0 + a.alto;
        expect(solapa, `las celdas ${i} y ${j} se solapan`).toBe(false);
      }
    }

    // Y el recorrido es por filas: izquierda a derecha, arriba abajo.
    expect(celdas[0]).toEqual({ x0: 0, y0: 0, ancho: 105, alto: 148.5 });
    expect(celdas[1].x0).toBeCloseTo(105, 10);
    expect(celdas[1].y0).toBe(0);
    expect(celdas[2].x0).toBe(0);
    expect(celdas[2].y0).toBeCloseTo(148.5, 10);
  });

  it("el indice se toma modulo el numero de celdas: no inventa un error", () => {
    const a4: HojaEtiqueta = { ...HOJA_A4, columnas: 2, filas: 2 };
    expect(celdaDeHoja(a4, 4)).toEqual(celdaDeHoja(a4, 0));
    expect(celdaDeHoja(a4, 7)).toEqual(celdaDeHoja(a4, 3));
  });

  it("la celda de la rejilla desplaza el layout entero, margen incluido", () => {
    const a4: HojaEtiqueta = { ...HOJA_A4, columnas: 2, filas: 2 };
    const l = crearLayout(a4, 3);
    expect(l.celda.x0).toBeCloseTo(105, 10);
    expect(l.celda.y0).toBeCloseTo(148.5, 10);
    expect(l.x(0)).toBeCloseTo(105 + MARGEN_MM, 10);
    expect(l.y(0)).toBeCloseTo(148.5 + MARGEN_MM, 10);
    expect(l.anchoUtil).toBeCloseTo(105 - 2 * MARGEN_MM, 10);
  });
});
