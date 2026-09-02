import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";

import { imagenesDePagina, rectangulosDePagina } from "./pdf-inspector";

// Feature 350 (T3) — AUTOCOMPROBACION DEL LECTOR.
//
// El inspector gana dos lecturas nuevas (rectangulos e imagenes) de las que
// dependen V3 y V5 y, sobre todo, el test de paridad entre los dos generadores.
// Un lector sin control NEGATIVO es un verde que no mide nada: si
// `rectangulosDePagina` devolviera siempre `[]`, la paridad de rectangulos
// pasaria en verde con un generador dibujando el recuadro y el otro no — que es
// exactamente el agujero que esta lectura viene a tapar.
//
// Por eso hay dos controles y no uno: un `doc.rect` conocido se encuentra con
// sus cuatro numeros, y un documento SIN rectangulos devuelve lista vacia.

const PT_A_MM = 25.4 / 72;
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function bytesDe(doc: jsPDF): Uint8Array {
  return new Uint8Array(Buffer.from(doc.output("arraybuffer")));
}

describe("rectangulosDePagina — control POSITIVO", () => {
  it("encuentra un `doc.rect` conocido con sus cuatro numeros", () => {
    const doc = new jsPDF({ unit: "mm", format: [100, 100] });
    doc.setLineWidth(0.3);
    doc.rect(6, 60, 88, 7.1, "S");

    const rects = rectangulosDePagina(bytesDe(doc));
    expect(rects).toHaveLength(1);
    const [r] = rects;
    expect(r.operador).toBe("S");
    expect(r.x * PT_A_MM).toBeCloseTo(6, 3);
    expect(r.w * PT_A_MM).toBeCloseTo(88, 3);
    // jsPDF escribe el alto NEGATIVO: coloca el origen arriba y baja.
    expect(r.h * PT_A_MM).toBeCloseTo(-7.1, 3);
    // Borde superior: 100 - y (la `y` del PDF crece hacia arriba).
    expect(100 - r.y * PT_A_MM).toBeCloseTo(60, 3);
  });

  it("distingue dos rectangulos y conserva su orden", () => {
    const doc = new jsPDF({ unit: "mm", format: [100, 100] });
    doc.rect(1, 2, 3, 4, "S");
    doc.rect(10, 20, 30, 40, "F");
    const rects = rectangulosDePagina(bytesDe(doc));
    expect(rects).toHaveLength(2);
    expect(rects[0].x * PT_A_MM).toBeCloseTo(1, 3);
    expect(rects[1].x * PT_A_MM).toBeCloseTo(10, 3);
  });
});

describe("rectangulosDePagina — control NEGATIVO", () => {
  it("un documento sin rectangulos devuelve lista vacia", () => {
    const doc = new jsPDF({ unit: "mm", format: [100, 100] });
    doc.text("solo texto", 10, 10);
    expect(rectangulosDePagina(bytesDe(doc))).toEqual([]);
  });

  it("un texto que PARECE un rectangulo no cuela como tal", () => {
    // Si el lector no neutralizara las cadenas, esta direccion inventaria un
    // rectangulo fantasma y la paridad compararia ruido.
    const doc = new jsPDF({ unit: "mm", format: [100, 100] });
    doc.text("12 3 4 5 re S", 10, 10);
    expect(rectangulosDePagina(bytesDe(doc))).toEqual([]);
  });
});

describe("imagenesDePagina", () => {
  it("control POSITIVO: encuentra las dos imagenes con su rectangulo", () => {
    const doc = new jsPDF({ unit: "mm", format: [100, 100] });
    doc.addImage(PNG_1X1, "PNG", 60, 6, 26, 26);
    doc.addImage(PNG_1X1, "PNG", 6, 78, 88, 16);

    const imgs = imagenesDePagina(bytesDe(doc));
    expect(imgs).toHaveLength(2);
    const [qr, barcode] = imgs;
    expect(qr.x * PT_A_MM).toBeCloseTo(60, 3);
    expect(qr.w * PT_A_MM).toBeCloseTo(26, 3);
    expect(qr.h * PT_A_MM).toBeCloseTo(26, 3);
    // `y` es el borde INFERIOR: 100 - 6 - 26 = 68 mm desde arriba.
    expect(100 - qr.y * PT_A_MM).toBeCloseTo(32, 3);
    expect(barcode.w * PT_A_MM).toBeCloseTo(88, 3);
    expect(barcode.h * PT_A_MM).toBeCloseTo(16, 3);
  });

  it("control NEGATIVO: un documento sin imagenes devuelve lista vacia", () => {
    const doc = new jsPDF({ unit: "mm", format: [100, 100] });
    doc.text("nada", 10, 10);
    expect(imagenesDePagina(bytesDe(doc))).toEqual([]);
  });
});
