import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import QRCode from "qrcode";
import bwipjs from "bwip-js/node";

import { buildEtiquetasLotePdf } from "@/lib/pdf/etiquetas-pdf-lote";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// Feature 136 — SMOKE de R7: "el sistema DEBE generar el PDF server-side (en el
// runtime Node del endpoint), sin depender del navegador ni del DOM del cliente".
//
// El otro test del builder (etiquetas-pdf-lote.test.ts) MOCKEA `qrcode` y
// `bwip-js/node` para poder afirmar QUE valor codifica cada codigo; util y
// rapido, pero deja a R7 sin cubrir: las dos librerias cuya server-safety
// afirma el requisito nunca se ejecutan. Este archivo NO mockea nada. Corre en
// el entorno `node` de vitest (el default del repo, sin jsdom), asi que si
// alguna dependencia necesitara `document`, `window` o un canvas del navegador,
// aqui reventaria.
//
// Es deliberadamente pequeño (2 etiquetas, ~40 ms con las deps reales) para no
// castigar la suite: el tope de etiquetas por PDF ya se prueba en los tests del
// service y del endpoint, sin rasterizar.

function etiqueta(numGuia: number): EtiquetaGuiaDTO {
  return {
    ordenId: `ord-${numGuia}`,
    numGuia,
    numRemision: `REM-${numGuia}`,
    destinatario: "Ana Perez",
    telefonoDest: "0999999999",
    direccion: "Av. Central 100",
    producto: "Caja x2",
    montoCobrar: 25.5,
    tiendaNombre: "Tienda Uno",
    zonaNombre: "GAM",
    provinciaNombre: "San Jose",
    cantonNombre: "Central",
    distritoNombre: "Carmen",
    fechaCreacion: "2026-08-27", // feature 295
    qrValue: String(numGuia),
    barcodeValue: String(numGuia),
  };
}

/** Objetos `/Type /Page` (excluye el nodo `/Pages`); van en claro con `compress`. */
function contarPaginas(pdf: string): number {
  return (pdf.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

describe("buildEtiquetasLotePdf — smoke server-side sin mocks (R7)", () => {
  it("las dependencias de rasterizado corren en Node y devuelven PNG (R5/R6/R7)", async () => {
    // `qrcode` fuera del navegador: data URL PNG, sin canvas del DOM.
    const qr = await QRCode.toDataURL("https://ordenex.test/paquete/1042", {
      margin: 0,
      width: 256,
    });
    expect(qr.startsWith("data:image/png;base64,")).toBe(true);
    const qrBytes = Buffer.from(qr.split(",")[1], "base64");
    expect(qrBytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])); // firma PNG
    expect(qrBytes.byteLength).toBeGreaterThan(100);

    // `bwip-js/node` (build de servidor) genera el CODE128 como buffer PNG.
    const barcode = await bwipjs.toBuffer({
      bcid: "code128",
      text: "1042",
      scale: 3,
      height: 12,
      includetext: true,
      textxalign: "center",
    });
    expect(Buffer.isBuffer(barcode)).toBe(true);
    expect(barcode.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(barcode.byteLength).toBeGreaterThan(100);
  });

  it("produce un PDF valido con las libs reales bajo Node (R1-R7)", async () => {
    const bytes = await buildEtiquetasLotePdf([etiqueta(1042), etiqueta(1043)]);

    expect(bytes).toBeInstanceOf(Uint8Array);
    const buf = Buffer.from(bytes);
    const pdf = buf.toString("latin1");

    // Documento PDF bien formado: cabecera, tabla de referencias y marca de fin.
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("trailer");
    expect(pdf).toContain("startxref");
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);

    // R2/R3: una pagina por etiqueta, cuadrada de 100 mm (283.46 pt).
    expect(contarPaginas(pdf)).toBe(2);
    expect(pdf).toMatch(/\/MediaBox\s*\[0 0 283\.\d+ 283\.\d+\]/);

    // R5/R6: las dos imagenes rasterizadas de verdad (QR + barcode) por pagina
    // quedan embebidas como XObjects de imagen.
    const imagenes = (pdf.match(/\/Subtype\s*\/Image/g) ?? []).length;
    expect(imagenes).toBeGreaterThanOrEqual(2);

    // R4: el texto de la etiqueta esta ahi (los streams van deflateados).
    let texto = "";
    const re = /stream\r?\n/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pdf)) !== null) {
      const start = m.index + m[0].length;
      const end = pdf.indexOf("endstream", start);
      if (end < 0) continue;
      try {
        texto += inflateSync(buf.subarray(start, end)).toString("latin1");
      } catch {
        // Stream no inflable (imagen ya codificada): no aporta texto.
      }
    }
    expect(texto).toContain("1042");
    expect(texto).toContain("1043");
    expect(texto).toContain("Ana Perez");
    expect(texto).toContain("Tienda Uno");

    // Un PDF con dos QR + dos barcode reales pesa bastante mas que uno vacio.
    expect(bytes.byteLength).toBeGreaterThan(3000);
  });

  // Feature 150 (T3, R21) - BLINDAJE de la decision D3: el tamaño de hoja
  // seleccionable es SOLO del generador de cliente. El PDF consolidado que
  // reciben los integradores por API (features 88/136) sigue siendo 100 x 100 mm
  // fijo y sin parametro de tamaño.
  //
  // Feature 282 (T12) - REVISADO: este archivo YA NO afirma "no se ha tocado".
  // El generador del servidor SI cambia en la 282 (comparte maqueta y embebe la
  // fuente), asi que lo que se conserva se afirma por lo que ES, no por la
  // ausencia de un import: firma publica de un solo parametro, pagina cuadrada
  // de 100 mm en TODAS las paginas, y el catalogo de tamaños fuera. La
  // asercion vieja `not.toContain("etiquetas-layout")` se retira porque el
  // modulo compartido vive precisamente ahi; lo que aquella protegia -que nadie
  // le meta un tamaño de hoja- lo siguen protegiendo las tres de abajo, y ahora
  // ademas la guardia `etiquetas-maqueta-unica.guardia.test.ts`.
  it("R21: el generador server-side sigue en 100 x 100 mm y sin parametro de tamaño", async () => {
    const bytes = await buildEtiquetasLotePdf([etiqueta(2001), etiqueta(2002)]);
    const pdf = Buffer.from(bytes).toString("latin1");

    // 100 mm = 283.46 pt: TODAS las paginas, sin excepcion.
    const cajas = pdf.match(/\/MediaBox\s*\[[^\]]*\]/g) ?? [];
    expect(cajas).toHaveLength(2);
    for (const caja of cajas) {
      expect(caja).toMatch(/\/MediaBox\s*\[0 0 283\.\d+ 283\.\d+\]/);
    }

    // Firma publica: un unico parametro (las etiquetas). Si alguien le añadiese
    // un `hoja`, `length` pasaria a 2 y este test caeria.
    expect(buildEtiquetasLotePdf).toHaveLength(1);

    // Y el catalogo de tamaños de la feature 150 sigue siendo del cliente: el
    // servidor usa el LIENZO BASE, no una hoja elegible.
    const fuente = codigoSinComentarios("lib/pdf/etiquetas-pdf-lote.ts");
    expect(fuente).not.toContain("etiquetas-hoja");
    expect(fuente).not.toContain("HOJAS_ETIQUETA");
    expect(fuente).toContain("crearLayoutBase()");
    expect(fuente).not.toMatch(/crearLayout\(/);
  });

  // Feature 282 (T12, R18) - lo que la ficha SI cambia en esta salida, afirmado
  // aqui con las libs reales: la fuente embebida viaja dentro del PDF que
  // reciben los integradores.
  it("R18/R20: el PDF consolidado embebe la fuente y sigue pesando lo razonable", async () => {
    const bytes = await buildEtiquetasLotePdf([etiqueta(3001)]);
    const pdf = Buffer.from(bytes).toString("latin1");
    expect(pdf).toContain("/Subtype /Type0");
    expect(pdf).toContain("/Identity-H");
    expect(pdf).toContain("/FontFile2");
    // Una etiqueta con QR + barcode reales + la fuente embebida: del orden de
    // pocas decenas de KB, no de cientos.
    expect(bytes.byteLength).toBeLessThan(80 * 1024);
  });

  it("no toca el DOM: no hay document ni window en el entorno del builder (R7)", async () => {
    // Si el entorno del test fuese jsdom esto no probaria nada; se afirma que
    // corre en Node puro, que es donde vive el endpoint de carga por API.
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    await expect(buildEtiquetasLotePdf([etiqueta(7)])).resolves.toBeInstanceOf(Uint8Array);
  });
});
