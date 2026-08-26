import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  codePointsCubiertos,
  contorno,
  glifoDe,
  nombreFamilia,
  numGlifos,
  tablas,
} from "./ttf-lector";

// Feature 282 (T2) — AUTOCOMPROBACION del lector de TTF.
//
// Sin este archivo, `ttf-lector.ts` seria un verde que no mide nada: un lector
// que devolviera siempre "si tiene contorno" pasaria todos los tests de la ficha
// y dejaria pasar exactamente el bug que la ficha cierra. Los tres controles de
// `design.md` §4 son, en orden de importancia:
//
//   1. NEGATIVO  — un caracter que la fuente NO puede tener resuelve a glifo 0.
//                  Es el que demuestra que el lector sabe decir que no.
//   2. DE VACIO  — el espacio resuelve a un glifo REAL con contorno CERO.
//                  Es el que demuestra que sabe distinguir "declarado" de
//                  "impreso": el eslabon del que depende R10.
//   3. POSITIVO  — un digito resuelve a un glifo con contorno > 0.

const TTF = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "assets",
  "fuentes",
  "LiberationSans-etiqueta-subset.ttf",
);
const FUENTE = new Uint8Array(readFileSync(TTF));

describe("ttf-lector — los tres controles (T2)", () => {
  it("CONTROL NEGATIVO: un caracter fuera del subconjunto resuelve a glifo 0", () => {
    // U+4E2D 中 no esta —ni podria estar— en un subconjunto cp1252.
    expect(glifoDe(FUENTE, 0x4e2d)).toBe(0);
    // Y otro cualquiera del mismo tenor, para que no sea un unico caso afortunado.
    expect(glifoDe(FUENTE, 0x05d0)).toBe(0); // א
    expect(glifoDe(FUENTE, 0x1f600)).toBe(0); // 😀
  });

  it("CONTROL DE VACIO: el espacio es un glifo REAL cuyo contorno mide 0", () => {
    const gid = glifoDe(FUENTE, 0x20);
    expect(gid).toBeGreaterThan(0);
    expect(contorno(FUENTE, gid)).toBe(0);
  });

  it("CONTROL POSITIVO: el digito '0' tiene glifo con contorno no vacio", () => {
    const gid = glifoDe(FUENTE, 0x30);
    expect(gid).toBeGreaterThan(0);
    expect(contorno(FUENTE, gid)).toBeGreaterThan(0);
  });
});

describe("ttf-lector — estructura del archivo", () => {
  it("lee el directorio de tablas y encuentra las que hacen falta para el contorno", () => {
    const t = tablas(FUENTE);
    for (const tag of ["head", "maxp", "loca", "glyf", "cmap", "hmtx", "name"]) {
      expect(t.has(tag), `falta la tabla '${tag}'`).toBe(true);
    }
  });

  it("rechaza una OpenType/CFF en vez de leerla mal en silencio", () => {
    // Cabecera 'OTTO' con un directorio de 0 tablas: es lo minimo que distingue
    // una OTF con contornos CFF, que NO tiene glyf/loca y con la que el
    // subsetter de jsPDF no produciria un /FontFile2 utilizable.
    const otto = new Uint8Array(12);
    new DataView(otto.buffer).setUint32(0, 0x4f54544f);
    expect(() => tablas(otto)).toThrow(/OpenType\/CFF/);
  });

  it("los indices de glifo caen dentro de numGlyphs", () => {
    const n = numGlifos(FUENTE);
    expect(n).toBeGreaterThan(200);
    for (const cp of [0x20, 0x30, 0x41, 0xf1, 0x20a1]) {
      expect(glifoDe(FUENTE, cp)).toBeLessThan(n);
    }
    expect(() => contorno(FUENTE, n)).toThrow(/fuera de rango/);
  });

  it("declara el nombre de familia con el que se registra la fuente", () => {
    expect(nombreFamilia(FUENTE)).toBe("Liberation Sans");
  });

  it("la cobertura leida del archivo contiene lo que se le pidio y NO lo que no", () => {
    const cubiertos = new Set(codePointsCubiertos(FUENTE));
    expect(cubiertos.has(0x20a1)).toBe(true); // ₡
    expect(cubiertos.has(0xf1)).toBe(true); // ñ
    expect(cubiertos.has(0x4e2d)).toBe(false); // 中
    // Y el conjunto no es "todo": si lo fuera, `cubreTexto` no serviria de nada.
    expect(cubiertos.size).toBeLessThan(400);
  });
});
