import { describe, it, expect } from "vitest";

import { lineasDisponibles } from "@/lib/pdf/etiquetas-ajuste";
import {
  camposYInicio,
  GAP_ROTULO_VALOR,
  GAP_TEXTO_CODIGOS,
  LIENZO_BASE_MM,
  MAQUETA_BASE,
  PT_A_MM,
  qrTopBase,
  textoYLimite,
} from "@/lib/pdf/etiquetas-maqueta";
import { crearLayout, crearLayoutBase } from "@/lib/pdf/etiquetas-layout";
import { HOJAS_ETIQUETA } from "@/lib/config/etiquetas-hoja";

// Feature 282 (T7/T17/T23) — La maqueta compartida: la separacion DERIVADA, el
// cupo que se cede y lo que NO se toca.

describe("R1/R2 — la primera fila de campos se DERIVA del cuerpo del numero de guia", () => {
  it("queda un cuerpo entero (1 em) por debajo de la linea base de la guia", () => {
    const separacion = camposYInicio() - MAQUETA_BASE.guiaY;
    expect(separacion).toBeCloseTo(MAQUETA_BASE.fontGuia * PT_A_MM, 10);
    // Con el cuerpo actual (22 pt) son 7,7611 mm y la fila arranca en 23,7611.
    expect(camposYInicio()).toBeCloseTo(23.7611, 3);
  });

  it("el 18 de antes NO cabia: 2 mm para un cuerpo que necesita 7,76", () => {
    // Este es el defecto que la ficha cierra, escrito como numero para que nadie
    // tenga que creerse la explicacion: la constante vieja violaba R1.
    const CONSTANTE_VIEJA = 18;
    expect(CONSTANTE_VIEJA - MAQUETA_BASE.guiaY).toBeLessThan(
      MAQUETA_BASE.fontGuia * PT_A_MM,
    );
    expect(camposYInicio()).toBeGreaterThan(CONSTANTE_VIEJA);
  });

  it("SI el cuerpo de la guia cambia, la fila baja EXACTAMENTE lo mismo (no es un numero magico)", () => {
    const base = camposYInicio(MAQUETA_BASE.fontGuia);
    const doble = camposYInicio(MAQUETA_BASE.fontGuia * 2);
    expect(doble - base).toBeCloseTo(MAQUETA_BASE.fontGuia * PT_A_MM, 10);
    // Y con cualquier cuerpo, la separacion sigue siendo 1 em de ESE cuerpo.
    for (const pt of [6, 10, 22, 40, 72]) {
      expect(camposYInicio(pt) - MAQUETA_BASE.guiaY).toBeCloseTo(pt * PT_A_MM, 10);
    }
  });

  it("un valor fijado a mano (23.7611) dejaria de derivar: la relacion lo delata", () => {
    // Si alguien sustituyera la derivacion por su resultado, `camposYInicio(44)`
    // devolveria lo mismo que `camposYInicio(22)`. Aqui se exige que NO lo haga.
    expect(camposYInicio(MAQUETA_BASE.fontGuia * 2)).not.toBeCloseTo(
      camposYInicio(MAQUETA_BASE.fontGuia),
      6,
    );
  });

  it("R3 — la desigualdad se conserva al escalar: vale para las CUATRO hojas por construccion", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const layout = crearLayout(hoja);
      const separacionPagina = layout.y(camposYInicio()) - layout.y(MAQUETA_BASE.guiaY);
      expect(separacionPagina).toBeGreaterThanOrEqual(layout.fontGuia * PT_A_MM - 1e-9);
    }
  });
});

describe("R25 — el cupo que se cede, con la aritmetica delante", () => {
  const cupo = (yInicio: number) =>
    lineasDisponibles(
      yInicio,
      textoYLimite(),
      MAQUETA_BASE.lineHeight,
      MAQUETA_BASE.fieldGap,
      7,
    );

  it("con la derivacion el cupo para los siete campos es 10 (antes 11)", () => {
    expect(cupo(18)).toBe(11); // lo que habia
    expect(cupo(camposYInicio())).toBe(10); // lo que hay
  });

  it("queda por encima del minimo de 9 que exige el requisito", () => {
    expect(cupo(camposYInicio())).toBeGreaterThanOrEqual(9);
  });

  it("el umbral que costaria la SEGUNDA linea esta en 24,0 mm y quedan 0,24 mm", () => {
    // Por eso no se añade ningun termino de aire decorativo a la formula:
    // cualquier constante extra cruzaria el umbral.
    expect(cupo(24.0)).toBe(10);
    expect(cupo(24.01)).toBe(9);
    expect(24 - camposYInicio()).toBeGreaterThan(0.2);
    expect(24 - camposYInicio()).toBeLessThan(0.3);
  });

  it("el cupo es el mismo en las cuatro hojas: el reparto se calcula en el lienzo base", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      void crearLayout(hoja);
      expect(cupo(camposYInicio())).toBe(10);
    }
  });
});

describe("R27 — ni se encoge la guia ni se comprime la banda de codigos", () => {
  it("el cuerpo del numero de guia sigue siendo 22 pt", () => {
    expect(MAQUETA_BASE.fontGuia).toBe(22);
    expect(MAQUETA_BASE.guiaY).toBe(16);
  });

  it("el QR, el codigo de barras y su separacion conservan sus dimensiones", () => {
    expect(MAQUETA_BASE.qrSize).toBe(26);
    expect(MAQUETA_BASE.barcodeHeight).toBe(16);
    expect(MAQUETA_BASE.gapQrBarcode).toBe(4);
    // Y la banda arranca donde arrancaba: 100 - 6 - 26 = 68.
    expect(qrTopBase()).toBe(68);
    expect(textoYLimite()).toBe(68 - GAP_TEXTO_CODIGOS);
  });

  it("el resto de la maqueta tampoco se mueve", () => {
    expect(MAQUETA_BASE.margin).toBe(6);
    expect(MAQUETA_BASE.fontRotulo).toBe(8);
    expect(MAQUETA_BASE.fontValor).toBe(9);
    expect(MAQUETA_BASE.fontRemision).toBe(10);
    expect(MAQUETA_BASE.lineHeight).toBe(4);
    expect(MAQUETA_BASE.fieldGap).toBe(1.0);
    expect(GAP_ROTULO_VALOR).toBe(2);
    expect(GAP_TEXTO_CODIGOS).toBe(2);
    expect(LIENZO_BASE_MM).toBe(100);
  });
});

describe("crearLayoutBase — el lienzo del generador del servidor", () => {
  it("es 100 x 100 con factor 1 y sin desplazamiento: los mismos numeros de siempre", () => {
    const l = crearLayoutBase();
    expect(l.s).toBe(1);
    expect(l.offX).toBe(0);
    expect(l.offY).toBe(0);
    expect(l.hoja.anchoMm).toBe(LIENZO_BASE_MM);
    expect(l.hoja.altoMm).toBe(LIENZO_BASE_MM);
    // Y las coordenadas del lienzo base salen tal cual.
    expect(l.x(6)).toBe(6);
    expect(l.y(68)).toBe(68);
    expect(l.fontGuia).toBe(MAQUETA_BASE.fontGuia);
  });
});
