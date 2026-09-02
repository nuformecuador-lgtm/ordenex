import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  formatMm,
  getHojaEtiqueta,
  HOJAS_ETIQUETA,
  HOJA_ETIQUETA_DEFAULT_ID,
} from "@/lib/config/etiquetas-hoja";

// Feature 150 (T2) — Catalogo de tamaños de hoja. Cubre R1-R5.

describe("catalogo de tamaños de hoja (R1-R5)", () => {
  it("R1: expone exactamente cuatro tamaños, siempre en el mismo orden", () => {
    expect(HOJAS_ETIQUETA).toHaveLength(4);
    expect(HOJAS_ETIQUETA.map((h) => h.id)).toEqual([
      "100x100",
      "4x6in",
      "a4",
      "carta",
    ]);
  });

  it("R2: declara las dimensiones exactas en mm y la etiqueta visible de cada tamaño", () => {
    // Feature 350 (T5): cada hoja declara ademas su REJILLA de celdas. Hoy las
    // cuatro van a 1 x 1 —una etiqueta por pagina, D1 de la 150— y la Q1
    // («cuatro por hoja en A4 y Carta») sigue SIN FIRMAR: cuando se firme, este
    // literal es el sitio donde se vera el cambio, que es justo para lo que
    // esta escrito literal y no derivado.
    expect(HOJAS_ETIQUETA).toEqual([
      { id: "100x100", label: "100 × 100 mm", anchoMm: 100, altoMm: 100, columnas: 1, filas: 1 },
      { id: "4x6in", label: "4 × 6 pulgadas", anchoMm: 101.6, altoMm: 152.4, columnas: 1, filas: 1 },
      { id: "a4", label: "A4", anchoMm: 210, altoMm: 297, columnas: 1, filas: 1 },
      // 8.5 x 11 in exactos, NO el redondeo 216 x 279 (design.md §2).
      { id: "carta", label: "Carta", anchoMm: 215.9, altoMm: 279.4, columnas: 1, filas: 1 },
    ]);
  });

  it("R2: 4x6in y carta son la conversion exacta de sus pulgadas", () => {
    const cuatroPorSeis = getHojaEtiqueta("4x6in");
    expect(cuatroPorSeis.anchoMm).toBeCloseTo(4 * 25.4, 10);
    expect(cuatroPorSeis.altoMm).toBeCloseTo(6 * 25.4, 10);
    const carta = getHojaEtiqueta("carta");
    expect(carta.anchoMm).toBeCloseTo(8.5 * 25.4, 10);
    expect(carta.altoMm).toBeCloseTo(11 * 25.4, 10);
  });

  it("R3: el modulo del catalogo no lee el entorno ni importa nada (importable desde el cliente)", () => {
    // Se afirma sobre el TEXTO FUENTE porque el requisito es sobre el modulo, no
    // sobre una llamada: importarlo desde un componente "use client" no debe
    // arrastrar config server-side ni evaluar `process.env` (design.md §1).
    const fuente = readFileSync(
      path.resolve(__dirname, "../../../lib/config/etiquetas-hoja.ts"),
      "utf8",
    );
    const codigo = fuente
      .split("\n")
      .filter((linea) => !/^\s*(\/\/|\*|\/\*)/.test(linea))
      .join("\n");
    expect(codigo).not.toMatch(/process\s*\.\s*env/);
    expect(codigo).not.toMatch(/^\s*import\s/m);
    expect(codigo).not.toMatch(/require\s*\(/);
  });

  it("R4: el tamaño por defecto es 100x100 y pertenece al catalogo", () => {
    expect(HOJA_ETIQUETA_DEFAULT_ID).toBe("100x100");
    const porDefecto = getHojaEtiqueta(HOJA_ETIQUETA_DEFAULT_ID);
    expect(porDefecto.anchoMm).toBe(100);
    expect(porDefecto.altoMm).toBe(100);
    expect(HOJAS_ETIQUETA).toContain(porDefecto);
  });

  it("R5: un identificador desconocido se resuelve al default en vez de quedar sin tamaño", () => {
    for (const id of ["", "A4", "legal", "100x100 ", "toString", "__proto__"]) {
      const hoja = getHojaEtiqueta(id);
      expect(hoja.id).toBe(HOJA_ETIQUETA_DEFAULT_ID);
      expect(hoja.anchoMm).toBe(100);
      expect(hoja.altoMm).toBe(100);
    }
  });

  it("R5: un identificador valido devuelve su propia hoja (el fallback no se traga los buenos)", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      expect(getHojaEtiqueta(hoja.id)).toEqual(hoja);
    }
  });

  it("R8: formatMm usa coma decimal y no depende del locale", () => {
    expect(formatMm(100)).toBe("100");
    expect(formatMm(101.6)).toBe("101,6");
    expect(formatMm(152.4)).toBe("152,4");
    expect(formatMm(297)).toBe("297");
    expect(formatMm(215.9)).toBe("215,9");
    expect(formatMm(279.4)).toBe("279,4");
  });
});
