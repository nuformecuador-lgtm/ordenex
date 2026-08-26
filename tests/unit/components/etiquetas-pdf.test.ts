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
import {
  crearLayout,
  LIENZO_BASE_MM,
  MAQUETA_BASE,
} from "@/lib/pdf/etiquetas-layout";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import {
  HOJAS_ETIQUETA,
  getHojaEtiqueta,
  type HojaEtiqueta,
} from "@/lib/config/etiquetas-hoja";
import { formatMonto } from "@/lib/config/moneda";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import { MARCA_CORTE } from "@/lib/pdf/etiquetas-ajuste";

import {
  CASO_ALFABETO_REAL,
  CASO_EVIDENCIA,
  CORPUS_282,
  NO_ASCII_MEDIDOS,
} from "../../fixtures/etiquetas-282";
import {
  cidsDe,
  fuentesDePagina,
  textoLegible,
  textosDePagina,
} from "../pdf/pdf-inspector";
import { contorno, tieneTinta } from "../pdf/ttf-lector";

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

/**
 * Atajo de los tests: `buildEtiquetasPdf` exige la fuente embebida como cuarto
 * parametro (feature 282) y aqui siempre es la REAL, la misma que ships. Nada de
 * dobles: el requisito caro de esta ficha es que el glifo salga de verdad en el
 * papel, y un doble de fuente no demuestra nada sobre eso.
 */
function construir(
  etiquetas: EtiquetaGuiaDTO[],
  qrCanvases: Map<string, HTMLCanvasElement>,
  hoja: HojaEtiqueta,
) {
  return buildEtiquetasPdf(etiquetas, qrCanvases, hoja, fuenteEtiqueta);
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

/**
 * Todas las cadenas dibujadas en la pagina, DECODIFICADAS por el camino que
 * seguiria un lector de PDF: las de la fuente embebida, con el `/ToUnicode` que
 * el propio documento declara.
 *
 * Feature 282 - sustituye (endureciendola) a la vieja `incluyeTexto`, que
 * buscaba el tramo ASCII del importe entre los bytes del archivo. Aquella
 * asercion dejaba de encontrarlo en cuanto el monto pasa a Identity-H (el texto
 * viaja en hexadecimal) y, sobre todo, NUNCA vio el simbolo de moneda: era el
 * agujero por el que este bug llego hasta el usuario. Esta afirma la cadena
 * entera, simbolo incluido.
 */
function textosDecodificados(bytes: Buffer, indice = 0): string[] {
  const u8 = new Uint8Array(bytes);
  const fuentes = fuentesDePagina(u8, indice);
  return textosDePagina(u8, indice).map((t) =>
    textoLegible(t, fuentes.get(t.fuenteRes)),
  );
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
      const doc = construir(
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
    const doc = construir([etiqueta()], new Map(), getHojaEtiqueta("carta"));
    const [[ancho, alto]] = mediaBoxes(bytesDe(doc).toString("latin1"));
    expect(ancho).toBeCloseTo(612, 1);
    expect(alto).toBeCloseTo(792, 1);
  });

  it("el default 100x100 sigue siendo la pagina cuadrada de 283.46 pt (sin regresion)", () => {
    const doc = construir([etiqueta()], new Map(), getHojaEtiqueta("100x100"));
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
        const doc = construir(etiquetas, new Map(), hoja);
        expect(contarPaginas(bytesDe(doc).toString("latin1"))).toBe(n);
      }
    }
  });

  it("cada pagina dibuja UNA sola etiqueta: N etiquetas => N barcodes, uno por pagina", () => {
    const etiquetas = Array.from({ length: 4 }, (_, i) =>
      etiqueta({ ordenId: `o${i}`, numGuia: 2000 + i }),
    );
    const doc = construir(etiquetas, new Map(), getHojaEtiqueta("a4"));
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
      construir([etiqueta()], new Map(), hoja);
      const { s } = crearLayout(hoja);
      const opts = jsBarcodeMock.mock.calls[0][2];
      expect(opts.width).toBeGreaterThanOrEqual(2 * s);
      expect(opts.height).toBeGreaterThanOrEqual(60 * s);
      expect(opts.fontSize).toBeGreaterThanOrEqual(Math.floor(18 * s));
    }
  });

  it("con 100x100 conserva las opciones historicas (2 / 60 / 18)", () => {
    construir([etiqueta()], new Map(), getHojaEtiqueta("100x100"));
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

/**
 * Posiciones del texto dibujado, en mm desde el borde SUPERIOR de la pagina (la
 * orientacion en la que maqueta el generador). jsPDF emite un `x y Td` por
 * llamada a `text()`, en pt y medido desde el borde inferior.
 */
function textosConY(buf: Buffer, altoMm: number): number[] {
  const altoPt = altoMm * MM_A_PT;
  const re = /([\d.-]+)\s+([\d.-]+)\s+Td\s*\n?\((?:\\[\s\S]|[^()\\])*\)\s*Tj/g;
  const stream = textoDelPdf(buf);
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stream)) !== null) {
    out.push(((altoPt - Number(m[2])) * 25.4) / 72);
  }
  return out;
}

describe("buildEtiquetasPdf — el texto no invade la banda del QR", () => {
  // El bloque QR + barcode va pegado al borde inferior del cuadrado util, en una
  // `y` FIJA (base: 100 - 6 - 26 = 68). El texto fluye desde la cabecera, y antes
  // de este arreglo llegaba a ~y=90: PRODUCTO / MONTO / TIENDA salian impresos
  // ENCIMA del QR, que ademas deja de escanear (feature 33).
  const qrTopBase =
    LIENZO_BASE_MM - MAQUETA_BASE.margin - MAQUETA_BASE.qrSize;

  it("en las cuatro hojas y con datos largos, ninguna linea entra en la banda", () => {
    const larga = etiqueta({
      destinatario: "María Fernanda de los Ángeles Rodríguez Villalobos",
      direccion:
        "Avenida Siempre Viva 742, casa esquinera de dos plantas color celeste, 300 metros al norte de la escuela, portón negro",
      producto:
        "Juego de sartenes antiadherentes de cinco piezas con tapa de vidrio templado y mango desmontable",
      zonaNombre: "Zona Metropolitana Ampliada Norte",
      tiendaNombre: "Comercializadora de Electrodomésticos del Valle S.A.",
    });
    for (const hoja of HOJAS_ETIQUETA) {
      const layout = crearLayout(hoja);
      const doc = construir([larga], new Map(), hoja);
      const ys = textosConY(bytesDe(doc), hoja.altoMm);
      expect(ys.length).toBeGreaterThanOrEqual(16); // sanidad del parseo
      // El limite en mm de PAGINA: el borde superior del QR ya escalado y
      // desplazado por el centrado de la hoja.
      expect(Math.max(...ys)).toBeLessThanOrEqual(layout.y(qrTopBase) + 1e-6);
    }
  });

  it("los siete rotulos siguen dibujados: se recorta la cola, no el campo", () => {
    const doc = construir(
      [etiqueta({ producto: "P".repeat(400), direccion: "D".repeat(400) })],
      new Map(),
      getHojaEtiqueta("100x100"),
    );
    const s = textoDelPdf(bytesDe(doc));
    for (const rotulo of [
      "DESTINATARIO",
      "DIRECCI",
      "UBICACI",
      "PRODUCTO",
      "MONTO A COBRAR",
      "TIENDA",
    ]) {
      expect(s).toContain(rotulo);
    }
  });
});

describe("buildEtiquetasPdf — contenido de la etiqueta (R20)", () => {
  it("los nueve datos quedan escritos en cualquier tamaño del catalogo", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const doc = construir([etiqueta({ numGuia: 1042 })], new Map(), hoja);
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
      // Monto a cobrar: la cadena COMPLETA que produce el formateador,
      // simbolo incluido, decodificada por el mapa a Unicode que declara el
      // propio documento (R9). La asercion vieja miraba solo el tramo ASCII.
      expect(textosDecodificados(bytesDe(doc))).toContain(formatMonto(1234.5));
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
      const doc = construir([larga], new Map(), hoja);
      return lineasDe(textoDelPdf(bytesDe(doc)), direccion);
    });
    expect(lineasPorHoja[0]).toBeGreaterThan(1);
    expect(new Set(lineasPorHoja).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Feature 282 — El defecto evidenciado, medido SOBRE EL PDF.
// ---------------------------------------------------------------------------

const PT_A_MM = 25.4 / 72;

/** Linea base de un texto en mm desde el borde SUPERIOR de la pagina. */
function yEnMm(yPt: number, altoMm: number): number {
  return altoMm - yPt * PT_A_MM;
}

describe("R1/R3 — el numero de guia deja de pisar la primera fila (medido en el PDF)", () => {
  it("en las CUATRO hojas, la separacion entre lineas base es >= 1 em del cuerpo de la guia", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const layout = crearLayout(hoja);
      const doc = construir([etiqueta({ numGuia: 19887906 })], new Map(), hoja);
      const u8 = new Uint8Array(bytesDe(doc));
      const fuentes = fuentesDePagina(u8);
      const textos = textosDePagina(u8).map((t) => ({
        t,
        texto: textoLegible(t, fuentes.get(t.fuenteRes)),
      }));

      const guia = textos.find((x) => x.texto === "19887906");
      const destinatario = textos.find((x) => x.texto === "DESTINATARIO");
      expect(guia, `no se encontro el numero de guia en ${hoja.id}`).toBeDefined();
      expect(destinatario, `no se encontro el rotulo DESTINATARIO en ${hoja.id}`).toBeDefined();

      const yGuia = yEnMm(guia!.t.y, hoja.altoMm);
      const yPrimeraFila = yEnMm(destinatario!.t.y, hoja.altoMm);
      const separacion = yPrimeraFila - yGuia;

      // R1: al menos el cuerpo del numero de guia expresado en mm, ESCALADO por
      // el factor de esa hoja (R3). Antes eran 2 mm para un cuerpo de 7,76.
      expect(
        separacion,
        `${hoja.id}: ${separacion.toFixed(3)} mm entre lineas base para un cuerpo de ${layout.fontGuia} pt`,
      ).toBeGreaterThanOrEqual(layout.fontGuia * PT_A_MM - 1e-6);
      // Y el cuerpo de la guia no se ha encogido para lograrlo (R27).
      expect(guia!.t.tamano).toBeCloseTo(layout.fontGuia, 6);
    }
  });
});

describe("R4 — los siete campos, sus rotulos y su orden, intactos", () => {
  it("aparecen los siete y en el mismo orden de arriba abajo", () => {
    const hoja = getHojaEtiqueta("100x100");
    const doc = construir([etiqueta()], new Map(), hoja);
    const u8 = new Uint8Array(bytesDe(doc));
    const fuentes = fuentesDePagina(u8);
    const esperados = [
      "DESTINATARIO",
      "TELÉFONO",
      "DIRECCIÓN",
      "UBICACIÓN",
      "PRODUCTO",
      "MONTO A COBRAR",
      "TIENDA",
    ];
    const rotulos = textosDePagina(u8)
      .map((t) => ({ y: t.y, texto: textoLegible(t, fuentes.get(t.fuenteRes)) }))
      .filter((x) => esperados.includes(x.texto))
      // La `y` del PDF crece hacia ARRIBA: de mayor a menor es de arriba abajo.
      .sort((a, b) => b.y - a.y)
      .map((x) => x.texto);
    expect(rotulos).toEqual(esperados);
  });
});

describe("R6/R7/R26/R34 — el corpus de referencia se imprime COMPLETO, sin recorte", () => {
  it("ningun caso del corpus sale con marca de recorte, en las cuatro hojas", () => {
    for (const caso of CORPUS_282) {
      for (const hoja of HOJAS_ETIQUETA) {
        const doc = construir([caso.dto], new Map(), hoja);
        const textos = textosDecodificados(bytesDe(doc));
        const recortados = textos.filter((t) => t.includes(MARCA_CORTE));
        expect(
          recortados,
          `caso «${caso.id}» en ${hoja.id}: se recorto ${JSON.stringify(recortados)}`,
        ).toEqual([]);
      }
    }
  });

  it("R7 — el caso de la evidencia imprime sus nueve datos enteros", () => {
    const dto = CASO_EVIDENCIA.dto;
    const doc = construir([dto], new Map(), getHojaEtiqueta("100x100"));
    const textos = textosDecodificados(bytesDe(doc));
    const texto = textos.join("");
    expect(texto).toContain(String(dto.numGuia));
    expect(texto).toContain(dto.numRemision);
    expect(texto).toContain(dto.destinatario);
    expect(texto).toContain(dto.telefonoDest);
    expect(texto).toContain(dto.producto);
    expect(texto).toContain(dto.tiendaNombre);
    for (const nivel of ["GAM", "San José", "Mora", "Colón"]) {
      expect(texto).toContain(nivel);
    }
    // El importe entero, simbolo incluido: es EL dato de la evidencia.
    expect(textos).toContain("₡18.000");
  });

  it("R34 — los seis no-ASCII medidos en produccion salen impresos (leidos del PDF)", () => {
    const doc = construir(
      [CASO_ALFABETO_REAL.dto],
      new Map(),
      getHojaEtiqueta("100x100"),
    );
    const texto = textosDecodificados(bytesDe(doc)).join("");
    for (const caracter of NO_ASCII_MEDIDOS) {
      expect(texto, `falta «${caracter}» en la etiqueta impresa`).toContain(caracter);
    }
  });
});

describe("R8/R9/R10/R15 — el simbolo sale de verdad en el papel", () => {
  const hoja = getHojaEtiqueta("100x100");
  const dto = CASO_EVIDENCIA.dto; // montoCobrar = 18000 => "₡18.000"

  function pdfDeLaEvidencia(paginas = 1): Uint8Array {
    const etiquetas = Array.from({ length: paginas }, (_, i) => ({
      ...dto,
      ordenId: `ord-${i}`,
      numGuia: dto.numGuia + i,
      barcodeValue: String(dto.numGuia + i),
    }));
    return new Uint8Array(bytesDe(construir(etiquetas, new Map(), hoja)));
  }

  it("R8 — el recurso de fuente del monto es /Type0 con /Identity-H y trae /FontFile2", () => {
    const u8 = pdfDeLaEvidencia();
    const fuentes = fuentesDePagina(u8);
    const monto = textosDePagina(u8).find(
      (t) => textoLegible(t, fuentes.get(t.fuenteRes)) === formatMonto(18000),
    );
    expect(monto, "no se encontro la fila del monto en el content stream").toBeDefined();

    const recurso = fuentes.get(monto!.fuenteRes);
    expect(recurso).toBeDefined();
    expect(recurso!.subtype).toBe("Type0");
    expect(recurso!.encoding).toBe("Identity-H");
    expect(recurso!.baseFont).toBe(fuenteEtiqueta.nombre);
    expect(recurso!.fontFile2, "la fuente no viaja embebida en el documento").toBeTruthy();
    // Y no es una de las 14 estandar: aquellas son Type1 con WinAnsiEncoding.
    expect(recurso!.subtype).not.toBe("Type1");
  });

  it("R9 — el hex del monto, decodificado por el /ToUnicode DEL PROPIO PDF, es «₡18.000»", () => {
    const u8 = pdfDeLaEvidencia();
    const fuentes = fuentesDePagina(u8);
    const monto = textosDePagina(u8).find((t) => {
      const recurso = fuentes.get(t.fuenteRes);
      return recurso?.subtype === "Type0" && textoLegible(t, recurso).includes("18.000");
    });
    expect(monto).toBeDefined();
    expect(monto!.hex, "con Identity-H el texto va en hexadecimal").toBe(true);

    const recurso = fuentes.get(monto!.fuenteRes)!;
    expect(textoLegible(monto!, recurso)).toBe(formatMonto(18000));
    expect(textoLegible(monto!, recurso)).toBe("₡18.000");
    // El mapa del documento declara el code point del colon, no otra cosa.
    expect([...recurso.toUnicode!.values()]).toContain("₡");
  });

  it("R10 — el CID del simbolo tiene CONTORNO NO VACIO dentro del /FontFile2 embebido", () => {
    const u8 = pdfDeLaEvidencia();
    const fuentes = fuentesDePagina(u8);
    const monto = textosDePagina(u8).find(
      (t) => textoLegible(t, fuentes.get(t.fuenteRes)) === formatMonto(18000),
    )!;
    const recurso = fuentes.get(monto.fuenteRes)!;

    // /CIDToGIDMap /Identity => el CID ES el indice de glifo del subconjunto.
    expect(recurso.cidToGidMap).toBe("Identity");
    const cids = cidsDe(monto);
    const texto = textoLegible(monto, recurso);
    const posicion = [...texto].indexOf("₡");
    expect(posicion).toBeGreaterThanOrEqual(0);
    const cidSimbolo = cids[posicion];

    const programa = recurso.fontFile2!;
    expect(
      contorno(programa, cidSimbolo),
      "el glifo del simbolo esta VACIO en el programa embebido: imprimiria papel en blanco",
    ).toBeGreaterThan(0);
    expect(tieneTinta(programa, cidSimbolo)).toBe(true);
    // Y todos los glifos del importe dejan tinta: este importe no lleva espacios.
    for (const cid of cids) {
      expect(tieneTinta(programa, cid), `el CID ${cid} del importe no deja tinta`).toBe(true);
    }
  });

  it("R15 — el /FontFile2 no pasa de 12 KB y es CONSTANTE al crecer las paginas", () => {
    const bytesDeLaFuente = (u8: Uint8Array): number => {
      const embebida = [...fuentesDePagina(u8).values()].find((f) => f.fontFile2);
      expect(embebida, "el documento no embebe ningun programa de fuente").toBeDefined();
      return embebida!.fontFile2!.byteLength;
    };
    const conUna = bytesDeLaFuente(pdfDeLaEvidencia(1));
    const conVeinte = bytesDeLaFuente(pdfDeLaEvidencia(20));
    expect(conUna, `el /FontFile2 mide ${conUna} B`).toBeLessThanOrEqual(12 * 1024);
    // El subconjunto es por DOCUMENTO, no por pagina: 20 etiquetas no lo mueven.
    expect(conVeinte).toBe(conUna);
  });
});

describe("R12 — el resto del texto sigue con la MISMA fuente que antes", () => {
  it("solo el valor del monto usa la fuente embebida; todo lo demas es Type1 estandar", () => {
    const doc = construir([CASO_EVIDENCIA.dto], new Map(), getHojaEtiqueta("100x100"));
    const u8 = new Uint8Array(bytesDe(doc));
    const fuentes = fuentesDePagina(u8);
    const conType0 = textosDePagina(u8)
      .filter((t) => fuentes.get(t.fuenteRes)?.subtype === "Type0")
      .map((t) => textoLegible(t, fuentes.get(t.fuenteRes)));
    expect(conType0).toEqual([formatMonto(18000)]);

    const conType1 = textosDePagina(u8).filter(
      (t) => fuentes.get(t.fuenteRes)?.subtype === "Type1",
    );
    // 4 textos de cabecera + 7 rotulos + las lineas de los otros seis valores.
    expect(conType1.length).toBeGreaterThanOrEqual(15);
    for (const t of conType1) {
      expect(fuentes.get(t.fuenteRes)!.baseFont).toMatch(/^Helvetica/);
    }
  });
});
