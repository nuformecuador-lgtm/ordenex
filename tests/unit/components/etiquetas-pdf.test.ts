// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { inflateSync } from "node:zlib";

// Feature 150 (T7) — El generador de CLIENTE con jspdf REAL: es la unica forma
// de afirmar el /MediaBox y el conteo de paginas que exigen R12/R13. Solo se
// mockea `jsbarcode` (para capturar las opciones del raster, R18) y se estuba
// `HTMLCanvasElement.prototype.toDataURL` con un PNG 1x1 valido, porque jsPDF
// decodifica de verdad la imagen en `addImage` y jsdom no trae canvas 2D.
// Precedente: tests/unit/pdf/etiquetas-pdf-lote.test.ts.

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAklEQVR4AewaftIAAAFbSURBVMXBUYrbQBQAwW4x979yJwP7QAivIzsfqhKImyo2lYp3VO44eNjiR8U7KqNCZatQ2SrOKt5ROXjY4kLlrOIulYorlbOKsfiCSsWmMio+dfCwxZdURsWmUvGJxUXFp1S2ilcqfnPwsMUPlU9UbCoVm0rFUPmXVfENla1C5arijoOHLZWt4kqlYlM5q7iqUHmnYqgIxC8q7lAZFUNlq1DZKlTGwcME4q+Kd1ReqVDZKobKbyqGQFxUvKKyVahsFWcqo2JTqdhUKsbBwwTipEJlVGwqZxVXKmcVVyqjYlVcVVxVDJX/UTEOHrZU7qq4q+KVCpWtYvGj4h2VUaGyVaiMiqGyVahsFWcHD1tcqJxVXKlUbCqjYqgMlaEyVA6+UDEqhsqoGBWj4uzgYYsvqWwVo2KoDJWhUjEWFxWfUKkYKqNiU6nYVM4OHrb4oXKXSsWmMlReqXhF5Q9xIO89ads5LwAAAABJRU5ErkJggg==";
const PNG_1X1_DATA_URL = `data:image/png;base64,${PNG_1X1_BASE64}`;

type BarcodeOpts = { width: number; height: number; fontSize: number };
const jsBarcodeMock =
  vi.fn<(canvas: HTMLCanvasElement, value: string, opts: BarcodeOpts) => void>();
vi.mock("jsbarcode", () => ({
  default: (...args: Parameters<typeof jsBarcodeMock>) => jsBarcodeMock(...args),
}));

import {
  buildEtiquetasPdf,
  etiquetasPdfFilename,
} from "@/app/(app)/ordenes/_components/etiquetas-pdf";
import { crearLayout } from "@/app/(app)/ordenes/_components/etiquetas-layout";
import { HOJAS_ETIQUETA, getHojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import { formatMonto } from "@/lib/config/moneda";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

const MM_A_PT = 72 / 25.4;

function etiqueta(overrides: Partial<EtiquetaGuiaDTO> = {}): EtiquetaGuiaDTO {
  const numGuia = overrides.numGuia ?? 1042;
  return {
    ordenId: overrides.ordenId ?? "ord-1",
    numGuia,
    numRemision: "REM-1",
    destinatario: "AnaDestinatario",
    telefonoDest: "0999999999",
    direccion: "CalleDireccion 123",
    producto: "ProductoTest",
    montoCobrar: 1234.5,
    tiendaNombre: "TiendaTest",
    zonaNombre: "ZonaTest",
    provinciaNombre: "ProvinciaTest",
    cantonNombre: "CantonTest",
    distritoNombre: "DistritoTest",
    qrValue: String(numGuia),
    barcodeValue: String(numGuia),
    ...overrides,
  };
}

function bytesDe(doc: ReturnType<typeof buildEtiquetasPdf>): Buffer {
  return Buffer.from(doc.output("arraybuffer"));
}

/** Objetos `/Type /Page` (excluye el nodo `/Pages`); viajan siempre en claro. */
function contarPaginas(pdf: string): number {
  return (pdf.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

/** Todos los `/MediaBox` del documento, en puntos. */
function mediaBoxes(pdf: string): Array<[number, number]> {
  const re = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g;
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdf)) !== null) {
    out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}

/** Texto dibujado: los content streams pueden ir deflateados, se inflan. */
function textoDelPdf(buf: Buffer): string {
  const crudo = buf.toString("latin1");
  let out = crudo;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(crudo)) !== null) {
    const start = m.index + m[0].length;
    const end = crudo.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out += inflateSync(buf.subarray(start, end)).toString("latin1");
    } catch {
      // Stream no inflable (imagen ya codificada): no aporta texto.
    }
  }
  return out;
}

/** jsPDF escribe en WinAnsi salvo que haya caracteres fuera del juego: UTF-16BE. */
function incluyeTexto(pdf: string, valor: string): boolean {
  if (pdf.includes(valor)) return true;
  const NUL = String.fromCharCode(0);
  const utf16be = [...valor].map((c) => NUL + c).join("");
  return pdf.includes(utf16be);
}

/**
 * En cuantas LINEAS se partio `valor`: cada linea dibujada es un literal de
 * texto `(...)` propio en el content stream y es subcadena de `valor`.
 */
function lineasDe(pdf: string, valor: string): number {
  const literales = pdf.match(/\((?:\\[\s\S]|[^()\\])*\)/g) ?? [];
  return literales
    .map((l) => l.slice(1, -1).trim())
    .filter((s) => s.length > 2 && valor.includes(s)).length;
}

beforeEach(() => {
  jsBarcodeMock.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    PNG_1X1_DATA_URL,
  );
});

describe("buildEtiquetasPdf — tamaño de pagina (R13)", () => {
  it("declara TODAS las paginas con el tamaño exacto del catalogo, en puntos", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const doc = buildEtiquetasPdf(
        [etiqueta({ ordenId: "a", numGuia: 1 }), etiqueta({ ordenId: "b", numGuia: 2 })],
        new Map(),
        hoja,
      );
      const cajas = mediaBoxes(bytesDe(doc).toString("latin1"));
      expect(cajas).toHaveLength(2);
      for (const [ancho, alto] of cajas) {
        expect(ancho).toBeCloseTo(hoja.anchoMm * MM_A_PT, 1);
        expect(alto).toBeCloseTo(hoja.altoMm * MM_A_PT, 1);
      }
    }
  });

  it("carta sale en 612 x 792 pt clavados (215.9 x 279.4 mm, no el redondeo)", () => {
    const doc = buildEtiquetasPdf([etiqueta()], new Map(), getHojaEtiqueta("carta"));
    const [[ancho, alto]] = mediaBoxes(bytesDe(doc).toString("latin1"));
    expect(ancho).toBeCloseTo(612, 1);
    expect(alto).toBeCloseTo(792, 1);
  });

  it("el default 100x100 sigue siendo la pagina cuadrada de 283.46 pt (sin regresion)", () => {
    const doc = buildEtiquetasPdf([etiqueta()], new Map(), getHojaEtiqueta("100x100"));
    expect(bytesDe(doc).toString("latin1")).toMatch(
      /\/MediaBox\s*\[0 0 283\.\d+ 283\.\d+\]/,
    );
  });
});

describe("buildEtiquetasPdf — una etiqueta por pagina (R12)", () => {
  it("produce tantas paginas como etiquetas, en los cuatro tamaños (nunca mosaico)", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      for (const n of [1, 3, 7]) {
        const etiquetas = Array.from({ length: n }, (_, i) =>
          etiqueta({ ordenId: `o${i}`, numGuia: 1000 + i }),
        );
        const doc = buildEtiquetasPdf(etiquetas, new Map(), hoja);
        expect(contarPaginas(bytesDe(doc).toString("latin1"))).toBe(n);
      }
    }
  });

  it("cada pagina dibuja UNA sola etiqueta: N etiquetas => N barcodes, uno por pagina", () => {
    const etiquetas = Array.from({ length: 4 }, (_, i) =>
      etiqueta({ ordenId: `o${i}`, numGuia: 2000 + i }),
    );
    const doc = buildEtiquetasPdf(etiquetas, new Map(), getHojaEtiqueta("a4"));
    expect(contarPaginas(bytesDe(doc).toString("latin1"))).toBe(4);
    expect(jsBarcodeMock).toHaveBeenCalledTimes(4);
    expect(jsBarcodeMock.mock.calls.map((c) => c[1])).toEqual([
      "2000",
      "2001",
      "2002",
      "2003",
    ]);
  });
});

describe("buildEtiquetasPdf — densidad del raster del barcode (R18)", () => {
  it("las opciones de jsbarcode escalan con el factor y nunca pierden densidad", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      jsBarcodeMock.mockClear();
      buildEtiquetasPdf([etiqueta()], new Map(), hoja);
      const { s } = crearLayout(hoja);
      const opts = jsBarcodeMock.mock.calls[0][2];
      expect(opts.width).toBeGreaterThanOrEqual(2 * s);
      expect(opts.height).toBeGreaterThanOrEqual(60 * s);
      expect(opts.fontSize).toBeGreaterThanOrEqual(Math.floor(18 * s));
    }
  });

  it("con 100x100 conserva las opciones historicas (2 / 60 / 18)", () => {
    buildEtiquetasPdf([etiqueta()], new Map(), getHojaEtiqueta("100x100"));
    expect(jsBarcodeMock.mock.calls[0][2]).toMatchObject({
      width: 2,
      height: 60,
      fontSize: 18,
    });
  });
});

describe("etiquetasPdfFilename / descargarEtiquetasPdf (R19)", () => {
  it("el nombre del archivo lleva el identificador del tamaño elegido", () => {
    expect(etiquetasPdfFilename(getHojaEtiqueta("100x100"))).toBe(
      "etiquetas-guia-100x100.pdf",
    );
    expect(etiquetasPdfFilename(getHojaEtiqueta("4x6in"))).toBe(
      "etiquetas-guia-4x6in.pdf",
    );
    expect(etiquetasPdfFilename(getHojaEtiqueta("a4"))).toBe("etiquetas-guia-a4.pdf");
    expect(etiquetasPdfFilename(getHojaEtiqueta("carta"))).toBe(
      "etiquetas-guia-carta.pdf",
    );
  });

  it("dos tamaños distintos NUNCA producen el mismo nombre", () => {
    const nombres = HOJAS_ETIQUETA.map((h) => etiquetasPdfFilename(h));
    expect(new Set(nombres).size).toBe(HOJAS_ETIQUETA.length);
    for (const nombre of nombres) expect(nombre).toMatch(/^etiquetas-guia-.+\.pdf$/);
  });

  // El paso final (`doc.save(nombre)`) se prueba en
  // `etiquetas-pdf-descarga.test.ts`: `save` es una propiedad de INSTANCIA de
  // jsPDF (no del prototipo) y en el build de Node escribe el archivo en disco,
  // asi que ahi se sustituye jspdf por un doble que captura el nombre.
});

describe("buildEtiquetasPdf — contenido de la etiqueta (R20)", () => {
  it("los nueve datos quedan escritos en cualquier tamaño del catalogo", () => {
    const tramosAscii = formatMonto(1234.5)
      .split(/[^\x21-\x7E]+/)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    expect(tramosAscii[0].length).toBeGreaterThan(1);

    for (const hoja of HOJAS_ETIQUETA) {
      const doc = buildEtiquetasPdf([etiqueta({ numGuia: 1042 })], new Map(), hoja);
      const s = textoDelPdf(bytesDe(doc));
      expect(s).toContain("1042"); // numero de guia
      expect(s).toContain("REM-1"); // numero de remision
      expect(s).toContain("AnaDestinatario");
      expect(s).toContain("0999999999"); // telefono
      expect(s).toContain("CalleDireccion 123");
      // Ubicacion geografica: los cuatro niveles.
      expect(s).toContain("ZonaTest");
      expect(s).toContain("ProvinciaTest");
      expect(s).toContain("CantonTest");
      expect(s).toContain("DistritoTest");
      expect(s).toContain("ProductoTest");
      expect(s).toContain("TiendaTest");
      expect(incluyeTexto(s, tramosAscii[0])).toBe(true); // monto a cobrar
    }
  });

  it("el ajuste de linea usa el ancho ESCALADO: el texto no se encoge en hojas grandes", () => {
    // Una direccion larga se parte en el mismo numero de lineas en 100x100 que en
    // A4; si `splitTextToSize` recibiese los 88 mm sin escalar, en A4 se partiria
    // en muchas mas (columna angosta) y el conteo cambiaria.
    const larga = etiqueta({
      direccion:
        "Avenida Siempre Viva 742, casa esquinera de dos plantas frente al parque central",
    });
    const direccion = larga.direccion as string;
    const lineasPorHoja = HOJAS_ETIQUETA.map((hoja) => {
      const doc = buildEtiquetasPdf([larga], new Map(), hoja);
      return lineasDe(textoDelPdf(bytesDe(doc)), direccion);
    });
    expect(lineasPorHoja[0]).toBeGreaterThan(1);
    expect(new Set(lineasPorHoja).size).toBe(1);
  });
});
