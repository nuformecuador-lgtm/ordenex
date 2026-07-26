import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import QRCode from "qrcode";
import bwipjs from "bwip-js/node";

import { buildEtiquetasLotePdf } from "@/lib/pdf/etiquetas-pdf-lote";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

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

  it("no toca el DOM: no hay document ni window en el entorno del builder (R7)", async () => {
    // Si el entorno del test fuese jsdom esto no probaria nada; se afirma que
    // corre en Node puro, que es donde vive el endpoint de carga por API.
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
    await expect(buildEtiquetasLotePdf([etiqueta(7)])).resolves.toBeInstanceOf(Uint8Array);
  });
});
