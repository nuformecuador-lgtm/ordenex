import { describe, it, expect } from "vitest";

import {
  ajustarBloque,
  ErrorEtiquetaNoCabe,
  MARCA_CORTE,
  lineasDisponibles,
  partirEnLineas,
  recortarConElipsis,
  repartirLineas,
} from "@/lib/pdf/etiquetas-ajuste";
import { INTERLINEADO, PT_A_MM } from "@/lib/pdf/etiquetas-maqueta";

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

// ===========================================================================
// Feature 350 (T9) — EL AJUSTE POR CUERPO, con medidor lineal.
//
// `medir = (t, pt) => t.length * pt * 0.1` es un medidor PROPIO del test, como
// ya hacia este archivo con `recortarConElipsis`: basta para fijar el contrato y
// no ata la aritmetica a las metricas de jsPDF. Lo que se afirma con la fuente
// real —que el ancho de tinta cabe en el papel— vive en V2, sobre el PDF.
// ===========================================================================

const medir = (t: string, pt: number) => t.length * pt * 0.1;

describe("partirEnLineas (R3)", () => {
  it("no pierde ni añade un caracter: las lineas reconstruyen el texto", () => {
    const texto = "Del super La Central 200 metros al sur, casa color verde";
    for (const pt of [7, 9, 13]) {
      for (const ancho of [20, 40, 88]) {
        const lineas = partirEnLineas(texto, ancho, pt, medir);
        expect(lineas.join(" ")).toBe(texto);
      }
    }
  });

  it("ninguna linea excede el ancho util", () => {
    const texto = "Avenida Segunda entre calles 9 y 11, edificio Torre Mercedes";
    for (const ancho of [15, 30, 60]) {
      for (const linea of partirEnLineas(texto, ancho, 9, medir)) {
        expect(medir(linea, 9)).toBeLessThanOrEqual(ancho + 1e-9);
      }
    }
  });

  it("una palabra MAS ANCHA que el cupo se parte por caracter y se continua", () => {
    // El caso adversarial de R3: sin partido por caracter, esta palabra
    // desbordaria el bloque entero.
    const palabra = "A".repeat(60);
    const lineas = partirEnLineas(palabra, 20, 9, medir);
    expect(lineas.length).toBeGreaterThan(1);
    expect(lineas.join("")).toBe(palabra);
    for (const linea of lineas) {
      expect(medir(linea, 9)).toBeLessThanOrEqual(20 + 1e-9);
    }
  });

  it("la palabra larga dentro de una frase tampoco desborda, y la frase sobrevive", () => {
    const texto = `Barrio ${"B".repeat(50)} casa 4`;
    const lineas = partirEnLineas(texto, 25, 9, medir);
    for (const linea of lineas) {
      expect(medir(linea, 9)).toBeLessThanOrEqual(25 + 1e-9);
    }
    // Se recompone quitando solo el espacio que introduce el salto de linea.
    let resto = texto;
    for (const linea of lineas) {
      resto = resto.replace(/^\s+/, "");
      expect(resto.startsWith(linea)).toBe(true);
      resto = resto.slice(linea.length);
    }
    expect(resto.trim()).toBe("");
  });

  it("la sangria del rotulo solo se cobra en la PRIMERA linea", () => {
    const texto = "uno dos tres cuatro cinco seis";
    const sinSangria = partirEnLineas(texto, 30, 9, medir);
    const conSangria = partirEnLineas(texto, 30, 9, medir, 15);
    expect(conSangria.length).toBeGreaterThanOrEqual(sinSangria.length);
    expect(medir(conSangria[0], 9)).toBeLessThanOrEqual(30 - 15 + 1e-9);
    if (conSangria.length > 1) {
      expect(medir(conSangria[1], 9)).toBeLessThanOrEqual(30 + 1e-9);
    }
  });

  it("un texto vacio da una linea vacia, no cero lineas", () => {
    expect(partirEnLineas("", 30, 9, medir)).toEqual([""]);
  });
});

describe("ajustarBloque (R6/R7)", () => {
  const datos = [
    { texto: "Jose Andres Pena Rodriguez", factorCuerpo: 1, cuerpoMinimoPt: 7.25 },
    { texto: "8888 7777", factorCuerpo: 12 / 13, cuerpoMinimoPt: 7.25 },
    { texto: "D".repeat(200), factorCuerpo: 10 / 13, cuerpoMinimoPt: 7 },
    { texto: "GAM / San Jose", factorCuerpo: 9 / 13, cuerpoMinimoPt: 7 },
  ];

  it("devuelve EL MAYOR cuerpo que cabe: uno mas grande NO cabria", () => {
    // 25 mm obliga al ajuste a BAJAR: con el cuerpo base entero necesitaria mas.
    const r = ajustarBloque(datos, 88, 25, 13, 7.25, medir);
    expect(r.cabe).toBe(true);
    expect(r.altoMm).toBeLessThanOrEqual(25 + 1e-9);
    // Y NO se quedo corto: es el mayor que cabe, no uno timido. Solo tiene
    // sentido exigirlo si no eligio ya el tope.
    expect(r.cuerpoPt).toBeLessThan(13);
    const masGrande = ajustarBloque(
      datos,
      88,
      25,
      r.cuerpoPt + 0.25,
      r.cuerpoPt + 0.25,
      medir,
    );
    expect(masGrande.altoMm).toBeGreaterThan(25 + 1e-9);
  });

  it("NUNCA baja del suelo de cada dato, ni con un alto imposible", () => {
    const r = ajustarBloque(datos, 88, 1, 13, 7.25, medir);
    expect(r.cabe).toBe(false);
    expect(r.cuerpoPt).toBeGreaterThanOrEqual(7.25);
    for (let i = 0; i < datos.length; i++) {
      expect(
        r.cuerpos[i],
        `el dato ${i} bajo a ${r.cuerpos[i]} pt, por debajo de su suelo`,
      ).toBeGreaterThanOrEqual(datos[i].cuerpoMinimoPt - 1e-9);
    }
  });

  it("con un alto imposible NO recorta ni una linea: devuelve el texto entero", () => {
    const r = ajustarBloque(datos, 88, 1, 13, 7.25, medir);
    expect(r.cabe).toBe(false);
    for (let i = 0; i < datos.length; i++) {
      // Reconstruccion exacta admitiendo SOLO el espacio del salto de linea.
      let resto = datos[i].texto;
      for (const linea of r.lineas[i]) {
        resto = resto.replace(/^\s+/, "");
        expect(resto.startsWith(linea)).toBe(true);
        resto = resto.slice(linea.length);
      }
      expect(resto.trim()).toBe("");
      for (const linea of r.lineas[i]) {
        expect(linea).not.toContain(MARCA_CORTE);
        expect(linea).not.toContain("…");
      }
    }
  });

  it("sube el cuerpo cuando SOBRA sitio: no se queda en el suelo", () => {
    // Control positivo. Sin el, un ajuste que dibujara SIEMPRE en el suelo
    // pasaria todos los demas tests de este bloque.
    const cortos = [
      { texto: "Ana", factorCuerpo: 1, cuerpoMinimoPt: 7.25 },
      { texto: "88", factorCuerpo: 1, cuerpoMinimoPt: 7.25 },
    ];
    const r = ajustarBloque(cortos, 88, 500, 13, 7.25, medir);
    expect(r.cabe).toBe(true);
    expect(r.cuerpoPt).toBe(13);
    expect(r.cuerpos).toEqual([13, 13]);
  });

  it("cada dato respeta su PROPIO suelo: los destacados quedan por encima", () => {
    // Es lo que hace cierto R14 en el caso extremo: al fondo del ajuste, los
    // destacados estan un paso por encima del resto.
    const r = ajustarBloque(datos, 88, 1, 13, 7.25, medir);
    expect(r.cuerpos[0]).toBe(7.25);
    expect(r.cuerpos[1]).toBe(7.25);
    expect(r.cuerpos[2]).toBe(7);
    expect(r.cuerpos[3]).toBe(7);
    expect(r.cuerpos[0]).toBeGreaterThan(r.cuerpos[2]);
  });

  it("ninguna linea de ningun dato excede el ancho, en ningun cuerpo elegido", () => {
    for (const alto of [10, 20, 40, 80, 200]) {
      const r = ajustarBloque(datos, 60, alto, 13, 7.25, medir);
      for (let i = 0; i < r.lineas.length; i++) {
        for (const linea of r.lineas[i]) {
          expect(medir(linea, r.cuerpos[i])).toBeLessThanOrEqual(60 + 1e-9);
        }
      }
    }
  });

  it("el alto declarado es el que ocupan las lineas con el interlineado", () => {
    const r = ajustarBloque(datos, 88, 40, 13, 7.25, medir);
    const esperado = r.lineas.reduce(
      (suma, lineas, i) => suma + lineas.length * r.cuerpos[i] * PT_A_MM * INTERLINEADO,
      0,
    );
    expect(r.altoMm).toBeCloseTo(esperado, 10);
  });
});

describe("ErrorEtiquetaNoCabe (R7)", () => {
  it("NOMBRA la guia, la hoja y el dato: el operador tiene que saber cual arreglar", () => {
    const e = new ErrorEtiquetaNoCabe(
      19887906,
      "100x100",
      "bloque de destino",
      "faltan 3,2 mm",
    );
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ErrorEtiquetaNoCabe");
    expect(e.message).toContain("19887906");
    expect(e.message).toContain("100x100");
    expect(e.message).toContain("bloque de destino");
    expect(e.message).toContain("faltan 3,2 mm");
    expect(e.numGuia).toBe(19887906);
    expect(e.hojaId).toBe("100x100");
  });
});
