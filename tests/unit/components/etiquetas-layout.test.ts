import { describe, it, expect } from "vitest";

import {
  crearLayout,
  LIENZO_BASE_MM,
  MAQUETA_BASE,
} from "@/app/(app)/ordenes/_components/etiquetas-layout";
import { HOJAS_ETIQUETA, getHojaEtiqueta } from "@/lib/config/etiquetas-hoja";

// Feature 150 (T5) — Aritmetica del escalado, en Node y sin DOM. Cubre R14-R17.

const HOJA_100 = getHojaEtiqueta("100x100");
const HOJA_4X6 = getHojaEtiqueta("4x6in");
const HOJA_A4 = getHojaEtiqueta("a4");
const HOJA_CARTA = getHojaEtiqueta("carta");

describe("crearLayout — factor de escala (R14)", () => {
  it("el factor sale del lado MENOR de la hoja respecto del lienzo de 100 mm", () => {
    expect(crearLayout(HOJA_100).s).toBeCloseTo(1, 10);
    expect(crearLayout(HOJA_4X6).s).toBeCloseTo(1.016, 10);
    expect(crearLayout(HOJA_A4).s).toBeCloseTo(2.1, 10);
    expect(crearLayout(HOJA_CARTA).s).toBeCloseTo(2.159, 10);
  });

  it("es UN SOLO factor: X e Y escalan exactamente igual (sin deformar QR ni barcode)", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      // Un delta en X y el mismo delta en Y producen el mismo desplazamiento.
      for (const v of [1, 7.5, 26, 94]) {
        const dx = l.x(v) - l.x(0);
        const dy = l.y(v) - l.y(0);
        expect(dx).toBeCloseTo(dy, 10);
        expect(dx).toBeCloseTo(l.s * v, 10);
      }
      // El QR sigue siendo cuadrado: su lado escalado es el mismo en ambos ejes.
      expect(l.qrSize).toBeCloseTo(MAQUETA_BASE.qrSize * l.s, 10);
      expect(l.escala(MAQUETA_BASE.qrSize)).toBeCloseTo(l.qrSize, 10);
    }
  });

  it("NUNCA escala por el lado mayor (eso desbordaria la pagina)", () => {
    for (const hoja of [HOJA_4X6, HOJA_A4, HOJA_CARTA]) {
      const l = crearLayout(hoja);
      const factorLadoMayor = Math.max(hoja.anchoMm, hoja.altoMm) / LIENZO_BASE_MM;
      expect(l.s).toBeLessThan(factorLadoMayor);
      expect(l.s).toBeCloseTo(
        Math.min(hoja.anchoMm, hoja.altoMm) / LIENZO_BASE_MM,
        10,
      );
    }
  });
});

describe("crearLayout — bloque cuadrado centrado (R15)", () => {
  it("100x100: s = 1 y offsets 0 (el default dibuja igual que la maqueta actual)", () => {
    const l = crearLayout(HOJA_100);
    expect(l.s).toBe(1);
    expect(l.offX).toBe(0);
    expect(l.offY).toBe(0);
    expect(l.lado).toBe(100);
    expect(l.x(6)).toBe(6);
    expect(l.y(6)).toBe(6);
    expect(l.margin).toBe(MAQUETA_BASE.margin);
    expect(l.contentWidth).toBe(88);
  });

  it("hojas no cuadradas: bloque cuadrado del lado menor, centrado en ambos ejes", () => {
    const esperado = [
      { hoja: HOJA_4X6, lado: 101.6, offX: 0, offY: 25.4 },
      { hoja: HOJA_A4, lado: 210, offX: 0, offY: 43.5 },
      { hoja: HOJA_CARTA, lado: 215.9, offX: 0, offY: 31.75 },
    ];
    for (const caso of esperado) {
      const l = crearLayout(caso.hoja);
      expect(l.lado).toBeCloseTo(caso.lado, 10);
      expect(l.offX).toBeCloseTo(caso.offX, 10);
      expect(l.offY).toBeCloseTo(caso.offY, 10);
      // Centrado: la banda sobrante de arriba mide lo mismo que la de abajo.
      expect(caso.hoja.altoMm - l.offY - l.lado).toBeCloseTo(l.offY, 10);
      expect(caso.hoja.anchoMm - l.offX - l.lado).toBeCloseTo(l.offX, 10);
      // Y NO se estira hasta el lado mayor: queda banda en blanco.
      expect(l.lado).toBeLessThan(caso.hoja.altoMm);
    }
  });

  it("el centrado se calcula, no se asume que el lado menor sea el ancho (hoja apaisada)", () => {
    const apaisada = { id: "a4" as const, label: "A4 apaisada", anchoMm: 297, altoMm: 210 };
    const l = crearLayout(apaisada);
    expect(l.s).toBeCloseTo(2.1, 10);
    expect(l.offX).toBeCloseTo(43.5, 10);
    expect(l.offY).toBe(0);
  });
});

describe("crearLayout — todas las constantes escalan (R16)", () => {
  it("margen, ancho de contenido, tipografias, interlineado, QR y barcode usan el mismo factor", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      expect(l.margin).toBeCloseTo(MAQUETA_BASE.margin * l.s, 10);
      expect(l.contentWidth).toBeCloseTo(
        (LIENZO_BASE_MM - MAQUETA_BASE.margin * 2) * l.s,
        10,
      );
      expect(l.fontRotulo).toBeCloseTo(MAQUETA_BASE.fontRotulo * l.s, 10);
      expect(l.fontValor).toBeCloseTo(MAQUETA_BASE.fontValor * l.s, 10);
      expect(l.fontRemision).toBeCloseTo(MAQUETA_BASE.fontRemision * l.s, 10);
      expect(l.fontGuia).toBeCloseTo(MAQUETA_BASE.fontGuia * l.s, 10);
      expect(l.lineHeight).toBeCloseTo(MAQUETA_BASE.lineHeight * l.s, 10);
      expect(l.fieldGap).toBeCloseTo(MAQUETA_BASE.fieldGap * l.s, 10);
      expect(l.qrSize).toBeCloseTo(MAQUETA_BASE.qrSize * l.s, 10);
      expect(l.barcodeHeight).toBeCloseTo(MAQUETA_BASE.barcodeHeight * l.s, 10);
      expect(l.gapQrBarcode).toBeCloseTo(MAQUETA_BASE.gapQrBarcode * l.s, 10);
    }
  });

  it("los numeros de design.md §3.3 salen clavados para A4 y carta", () => {
    const a4 = crearLayout(HOJA_A4);
    expect(a4.margin).toBeCloseTo(12.6, 10);
    expect(a4.contentWidth).toBeCloseTo(184.8, 10);
    expect(a4.fontRotulo).toBeCloseTo(16.8, 10);
    expect(a4.fontValor).toBeCloseTo(18.9, 10);
    expect(a4.fontRemision).toBeCloseTo(21, 10);
    expect(a4.fontGuia).toBeCloseTo(46.2, 10);
    expect(a4.lineHeight).toBeCloseTo(8.4, 10);
    // fieldGap base = 1.0 (era 1.5 cuando el rotulo iba en su propia linea; ver
    // MAQUETA_BASE): 1.0 * 2.1.
    expect(a4.fieldGap).toBeCloseTo(2.1, 10);
    expect(a4.qrSize).toBeCloseTo(54.6, 10);
    expect(a4.barcodeHeight).toBeCloseTo(33.6, 10);
    expect(a4.gapQrBarcode).toBeCloseTo(8.4, 10);

    const carta = crearLayout(HOJA_CARTA);
    expect(carta.margin).toBeCloseTo(12.954, 10);
    expect(carta.qrSize).toBeCloseTo(56.134, 10);
    expect(carta.fontGuia).toBeCloseTo(47.498, 10);
  });
});

describe("crearLayout — encaje en la pagina (R17)", () => {
  it("para las cuatro hojas el bloque util cabe entero y los offsets no son negativos", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      expect(l.offX).toBeGreaterThanOrEqual(0);
      expect(l.offY).toBeGreaterThanOrEqual(0);
      // Borde derecho/inferior del contenido (margen interior incluido).
      const derecha = l.x(LIENZO_BASE_MM - MAQUETA_BASE.margin);
      const abajo = l.y(LIENZO_BASE_MM - MAQUETA_BASE.margin);
      expect(derecha).toBeLessThanOrEqual(hoja.anchoMm);
      expect(abajo).toBeLessThanOrEqual(hoja.altoMm);
      // Y el bloque completo (sin margen) tampoco se sale.
      expect(l.x(LIENZO_BASE_MM)).toBeLessThanOrEqual(hoja.anchoMm + 1e-9);
      expect(l.y(LIENZO_BASE_MM)).toBeLessThanOrEqual(hoja.altoMm + 1e-9);
      // Ni por el borde superior/izquierdo.
      expect(l.x(MAQUETA_BASE.margin)).toBeGreaterThanOrEqual(0);
      expect(l.y(MAQUETA_BASE.margin)).toBeGreaterThanOrEqual(0);
    }
  });

  it("el bloque QR + barcode de la fila inferior no invade el margen exterior", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      const barcodeXBase =
        MAQUETA_BASE.margin + MAQUETA_BASE.qrSize + MAQUETA_BASE.gapQrBarcode;
      const anchoBarcodeBase =
        LIENZO_BASE_MM - MAQUETA_BASE.margin - barcodeXBase;
      expect(anchoBarcodeBase).toBeGreaterThan(0);
      const finBarcode = l.x(barcodeXBase) + l.escala(anchoBarcodeBase);
      expect(finBarcode).toBeLessThanOrEqual(
        hoja.anchoMm - l.offX - l.margin + 1e-9,
      );
      const finQr = l.y(LIENZO_BASE_MM - MAQUETA_BASE.margin);
      expect(finQr).toBeLessThanOrEqual(hoja.altoMm - l.offY + 1e-9);
    }
  });
});

describe("crearLayout — densidad del raster del barcode (R18)", () => {
  it("las opciones del raster nunca bajan de la densidad de 100x100", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const l = crearLayout(hoja);
      expect(l.barcodeRaster.width).toBeGreaterThanOrEqual(2 * l.s);
      expect(l.barcodeRaster.height).toBeGreaterThanOrEqual(60 * l.s);
      expect(Number.isInteger(l.barcodeRaster.width)).toBe(true);
      expect(Number.isInteger(l.barcodeRaster.height)).toBe(true);
    }
    // Con 100x100 se conservan exactamente las opciones historicas (feature 32).
    const base = crearLayout(HOJA_100).barcodeRaster;
    expect(base).toEqual({ width: 2, height: 60, fontSize: 18 });
  });
});
