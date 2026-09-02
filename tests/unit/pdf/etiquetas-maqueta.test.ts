import { describe, it, expect } from "vitest";

import { HOJAS_ETIQUETA } from "@/lib/config/etiquetas-hoja";
import { crearLayout, crearLayoutBase } from "@/lib/pdf/etiquetas-layout";
import {
  altoLineaMm,
  ANCHO_UTIL_BASE_MM,
  BANDAS,
  BARCODE_MM,
  CELDA_BASE_MM,
  CUERPOS_BASE,
  CUERPO_MINIMO_DESTACADO_PT,
  CUERPO_MINIMO_PT,
  GAPS_ENTRE_BANDAS,
  GAP_BANDAS_TOTAL_MM,
  GAP_CAMPOS_MM,
  GAP_ROTULO_VALOR,
  GAP_TEXTO_CODIGOS,
  INTERLINEADO,
  LIENZO_BASE_MM,
  MAQUETA_BASE,
  MARGEN_MM,
  PASO_AJUSTE_PT,
  PT_A_MM,
  QR_MM,
  separacionBajoGuiaMm,
} from "@/lib/pdf/etiquetas-maqueta";

// Feature 282 (T7/T17/T23) — La maqueta compartida: la separacion DERIVADA y lo
// que NO se toca.
//
// Feature 350 (T6/T15) — Reescrito siguiendo fila a fila la tabla de
// `design.md` §11. Lo que se retira y que lo sustituye:
//
//  · «el cupo es 10 lineas, el MISMO en las cuatro hojas» (lineas 94-99 de la
//    version de la 282). Aquella asercion CERTIFICABA EL DEFECTO: presumia de
//    que daba igual la hoja. La sustituyen R11 y la capacidad declarada de
//    `etiquetas-capacidad.test.ts`, que exigen que la capacidad CREZCA con el
//    area — mas fuerte, porque afirma capacidad y no aritmetica.
//  · «`camposYInicio()` vale 23,7611» y todo el bloque del cupo cedido. La
//    coordenada absoluta del lienzo viejo ya no existe; la REGLA que la
//    justificaba (1 em del cuerpo de la guia por debajo de su linea base) se
//    conserva intacta en `separacionBajoGuiaMm`, se sigue afirmando aqui y,
//    sobre el PDF, en `etiquetas-pdf.test.ts` y `etiquetas-pdf-lote.test.ts`.
//  · «`qrTopBase()` vale 68» y «`textoYLimite()` vale 66». La banda de codigos ya
//    no vive en una `y` fija del lienzo: se ancla al borde inferior del area
//    util, que es lo que hace que la hoja se use entera (R9). Lo sustituye V3,
//    medido sobre el PDF.

describe("R6 — el suelo de legibilidad, absoluto y sin escalar", () => {
  it("vale 7,0 pt", () => {
    expect(CUERPO_MINIMO_PT).toBe(7.0);
  });

  it("NO se multiplica por ninguna escala: es el mismo en las cuatro hojas", () => {
    // Es la mitad de R6 que de verdad importa: «expresado en puntos de pagina
    // (absoluto, no relativo al tamaño de la hoja)». Si alguien lo escalara con
    // `k`, en A4 el suelo serian 15,75 pt y en una celda 2 x 2 de Q1 bajaria de
    // 7 — que es justo lo que la legibilidad fisica prohibe.
    for (const hoja of HOJAS_ETIQUETA) {
      const layout = crearLayout(hoja);
      expect(layout.cuerpoMinimoPt, `${hoja.id} escala el suelo`).toBe(CUERPO_MINIMO_PT);
    }
    // Control positivo: en las hojas grandes `k` NO vale 1, asi que la asercion
    // de arriba no se cumple por casualidad.
    expect(crearLayout(HOJAS_ETIQUETA[0]).k).toBe(1);
    expect(crearLayout(HOJAS_ETIQUETA[2]).k).toBeGreaterThan(2);
    expect(crearLayout(HOJAS_ETIQUETA[2]).cuerpoMinimoPt).not.toBeCloseTo(
      CUERPO_MINIMO_PT * crearLayout(HOJAS_ETIQUETA[2]).k,
      6,
    );
  });

  it("el suelo de los datos DESTACADOS esta un paso del ajuste por encima (R14)", () => {
    // Sin esa diferencia, en el caso extremo destinatario y producto quedarian
    // los dos en 7,0 y R14 —«estrictamente mayor»— se violaria.
    expect(CUERPO_MINIMO_DESTACADO_PT).toBe(CUERPO_MINIMO_PT + PASO_AJUSTE_PT);
    expect(CUERPO_MINIMO_DESTACADO_PT).toBeGreaterThan(CUERPO_MINIMO_PT);
    expect(PASO_AJUSTE_PT).toBe(0.25);
  });
});

describe("R1/R2 (282) — la separacion bajo el numero de guia se DERIVA", () => {
  it("es un cuerpo entero (1 em) del numero de guia", () => {
    expect(separacionBajoGuiaMm(MAQUETA_BASE.fontGuia)).toBeCloseTo(
      MAQUETA_BASE.fontGuia * PT_A_MM,
      10,
    );
    // Con el cuerpo actual (22 pt) son 7,7611 mm.
    expect(separacionBajoGuiaMm(22)).toBeCloseTo(7.7611, 3);
  });

  it("SI el cuerpo de la guia cambia, la separacion cambia EXACTAMENTE lo mismo", () => {
    for (const pt of [6, 10, 22, 40, 72]) {
      expect(separacionBajoGuiaMm(pt)).toBeCloseTo(pt * PT_A_MM, 10);
    }
    // Un valor fijado a mano dejaria de derivar: la relacion lo delata.
    expect(separacionBajoGuiaMm(44)).not.toBeCloseTo(separacionBajoGuiaMm(22), 6);
  });

  it("el 18 de la feature 32 NO cabia: 2 mm para un cuerpo que necesita 7,76", () => {
    // Se conserva como numero para que nadie tenga que creerse la explicacion:
    // la constante vieja violaba la regla.
    const GUIA_Y_VIEJA = 16;
    const CAMPOS_Y_VIEJA = 18;
    expect(CAMPOS_Y_VIEJA - GUIA_Y_VIEJA).toBeLessThan(separacionBajoGuiaMm(22));
  });
});

describe("R13 — las cinco bandas y su orden", () => {
  it("son exactamente cinco y van de arriba abajo en el orden del requisito", () => {
    expect([...BANDAS]).toEqual([
      "cabecera",
      "destino",
      "importe",
      "detalle",
      "codigos",
    ]);
  });

  it("hay una separacion por cada par de bandas consecutivas", () => {
    expect(GAPS_ENTRE_BANDAS).toHaveLength(BANDAS.length - 1);
    expect(GAP_BANDAS_TOTAL_MM).toBeCloseTo(
      GAPS_ENTRE_BANDAS.reduce((a, b) => a + b, 0),
      10,
    );
  });

  it("las separaciones se DERIVAN de las dos que ya se imprimian, no son nuevas", () => {
    // Contra la banda de codigos, el aire que protege la lectura del QR y del
    // barcode (2 mm, feature 282); entre bandas de texto, el `fieldGap` de la
    // maqueta anterior (1,0 mm). Sin esa derivacion —con los 4 x 2 mm que
    // estimaba el spec— el peor caso medido NO cabia en 100 x 100.
    expect(GAPS_ENTRE_BANDAS[0]).toBe(GAP_TEXTO_CODIGOS);
    expect(GAPS_ENTRE_BANDAS[1]).toBe(GAP_CAMPOS_MM);
    expect(GAPS_ENTRE_BANDAS[2]).toBe(GAP_CAMPOS_MM);
    expect(GAPS_ENTRE_BANDAS[3]).toBe(GAP_TEXTO_CODIGOS);
    expect(GAP_BANDAS_TOTAL_MM).toBe(6);
  });
});

describe("R12/R24 — lo que NO se toca", () => {
  it("el cuerpo del numero de guia sigue siendo 22 pt", () => {
    expect(CUERPOS_BASE.guia).toBe(22);
    expect(MAQUETA_BASE.fontGuia).toBe(22);
  });

  it("el QR y el codigo de barras conservan sus dimensiones de siempre", () => {
    expect(QR_MM).toBe(26);
    expect(BARCODE_MM).toBe(16);
    expect(MAQUETA_BASE.qrSize).toBe(26);
    expect(MAQUETA_BASE.barcodeHeight).toBe(16);
  });

  it("el margen, el lienzo y los dos gaps heredados no se mueven", () => {
    expect(MARGEN_MM).toBe(6);
    expect(LIENZO_BASE_MM).toBe(100);
    expect(CELDA_BASE_MM).toBe(100);
    expect(ANCHO_UTIL_BASE_MM).toBe(88);
    expect(GAP_TEXTO_CODIGOS).toBe(2);
    expect(GAP_ROTULO_VALOR).toBe(2);
    expect(GAP_CAMPOS_MM).toBe(1.0);
  });

  it("los cuerpos de la cabecera son los que ya se imprimian (282/295)", () => {
    expect(CUERPOS_BASE.rotulo).toBe(8);
    expect(CUERPOS_BASE.remision).toBe(10);
  });
});

describe("D3 — la jerarquia esta en los cuerpos base, no en el orden de una lista", () => {
  it("destinatario y telefono son MAYORES que producto y tienda", () => {
    expect(CUERPOS_BASE.destinatario).toBeGreaterThan(CUERPOS_BASE.detalle);
    expect(CUERPOS_BASE.telefono).toBeGreaterThan(CUERPOS_BASE.detalle);
  });

  it("el importe es el cuerpo mayor del cuerpo del mensaje", () => {
    expect(CUERPOS_BASE.importe).toBeGreaterThan(CUERPOS_BASE.destinatario);
  });

  it("el detalle es el cuerpo menor y sigue por encima del suelo", () => {
    expect(CUERPOS_BASE.detalle).toBeLessThanOrEqual(CUERPOS_BASE.ubicacion);
    expect(CUERPOS_BASE.detalle).toBeGreaterThan(CUERPO_MINIMO_PT);
  });
});

describe("el interlineado conserva la densidad ya impresa", () => {
  it("1,26 es exactamente los 4 mm a 9 pt de la maqueta anterior", () => {
    expect(INTERLINEADO).toBe(1.26);
    // 4 / (9 * 25,4/72) = 1,2598…: se conserva la densidad, no se estrena una.
    expect(4 / (9 * PT_A_MM)).toBeCloseTo(INTERLINEADO, 2);
  });

  it("`altoLineaMm` es el cuerpo por el interlineado", () => {
    expect(altoLineaMm(9)).toBeCloseTo(9 * PT_A_MM * INTERLINEADO, 10);
    expect(altoLineaMm(9)).toBeCloseTo(4, 2);
    expect(altoLineaMm(CUERPO_MINIMO_PT)).toBeCloseTo(3.1115, 3);
  });
});

describe("crearLayoutBase — el lienzo del generador del servidor (R20)", () => {
  it("es 100 x 100, con k = 1 y la celda en el origen", () => {
    const l = crearLayoutBase();
    expect(l.k).toBe(1);
    expect(l.celda).toEqual({ x0: 0, y0: 0, ancho: 100, alto: 100 });
    expect(l.hoja.anchoMm).toBe(LIENZO_BASE_MM);
    expect(l.hoja.altoMm).toBe(LIENZO_BASE_MM);
    expect(l.margen).toBe(MARGEN_MM);
    expect(l.anchoUtil).toBe(ANCHO_UTIL_BASE_MM);
    expect(l.altoUtil).toBe(ANCHO_UTIL_BASE_MM);
    // Las coordenadas del area util salen desplazadas solo por el margen.
    expect(l.x(0)).toBe(6);
    expect(l.y(0)).toBe(6);
    expect(l.cuerpos.guia).toBe(CUERPOS_BASE.guia);
  });
});
