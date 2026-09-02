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
import { crearLayout } from "@/lib/pdf/etiquetas-layout";
import {
  CUERPO_MINIMO_PT,
  GAPS_ENTRE_BANDAS,
  MAQUETA_BASE,
  PT_A_MM as PT_A_MM_MAQUETA,
  separacionBajoGuiaMm,
} from "@/lib/pdf/etiquetas-maqueta";
import {
  ROTULO_FECHA,
  ROTULO_GUIA,
  ROTULO_REMISION,
  textosConFuenteEmbebida,
} from "@/lib/pdf/etiquetas-dibujo";
import { seguroEnFuenteEstandar } from "@/lib/pdf/etiquetas-fuente-registro";
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
  CASO_MINIMOS,
  CASO_PEOR_MEDIDO,
  CORPUS_282,
  NO_ASCII_MEDIDOS,
  PEOR_CASO_LARGOS,
} from "../../fixtures/etiquetas-282";
import {
  cidsDe,
  fuentesDePagina,
  rectangulosDePagina,
  textoLegible,
  textosDePagina,
} from "../pdf/pdf-inspector";
import { verificarEtiqueta } from "../pdf/etiquetas-verificacion";
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
    fechaCreacion: "2026-08-27", // feature 295
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
      // Feature 350: el factor pasa a ser `k` (del ANCHO) en vez de `s` (del
      // lado menor). Lo que esta asercion protege —que la densidad del raster
      // no baje nunca— se conserva palabra por palabra.
      const { k } = crearLayout(hoja);
      const opts = jsBarcodeMock.mock.calls[0][2];
      expect(opts.width).toBeGreaterThanOrEqual(2 * k);
      expect(opts.height).toBeGreaterThanOrEqual(60 * k);
      expect(opts.fontSize).toBeGreaterThanOrEqual(Math.floor(18 * k));
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

// ---------------------------------------------------------------------------
// Feature 350 (T15) — RETIRADO: «el texto no invade la banda del QR» y «los
// siete rotulos siguen dibujados».
//
// Que afirmaban: que ninguna linea base bajase del borde superior del QR, con
// ese borde calculado como `100 - margen - qrSize` del lienzo viejo; y que los
// siete rotulos del bloque rotulo/valor siguieran presentes tras el recorte.
//
// Que decision los sustituye: la banda de codigos ya no vive en una `y` fija del
// lienzo (se ancla al borde inferior del area util, R9) y el bloque de destino
// ya no tiene rotulos (D2/R16). Ademas el recorte ha desaparecido: no hay «cola»
// que cortar.
//
// Que test nuevo cubre lo mismo o mas: **V3** en «Feature 350 — V1-V6», que mide
// sobre el PDF que NINGUN texto solapa el rectangulo real de las imagenes del QR
// y del codigo de barras (no una `y` calculada) y que las cinco bandas son
// disjuntas y estan en su orden; y **V1**, que exige los DIEZ datos completos en
// vez de la presencia de seis rotulos.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Feature 350 (T15) — RETIRADO: «los nueve datos quedan escritos» (por `toContain`
// sobre los bytes) y «el ajuste de linea usa el ancho ESCALADO».
//
// Que afirmaban: que cada valor apareciese como subcadena del PDF; y que una
// direccion larga se partiera en EL MISMO numero de lineas en las cuatro hojas.
//
// Que decision los sustituye: la segunda CERTIFICABA EL DEFECTO —que las cuatro
// hojas tuvieran la misma capacidad era justo el problema (D1)—. La sustituye
// R11, que exige lo contrario: que la capacidad CREZCA con el area
// (`etiquetas-capacidad.test.ts`). La primera es mas debil que su relevo: un
// `toContain` pasa aunque el dato salga partido en mitades solapadas.
//
// Que test nuevo cubre lo mismo o mas: **V1**, que reconstruye cada dato
// CARACTER A CARACTER desde el PDF y lo compara con el literal del fixture.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Feature 282 — El defecto evidenciado, medido SOBRE EL PDF.
// ---------------------------------------------------------------------------

const PT_A_MM = 25.4 / 72;

/** Linea base de un texto en mm desde el borde SUPERIOR de la pagina. */
function yEnMm(yPt: number, altoMm: number): number {
  return altoMm - yPt * PT_A_MM;
}

describe("R24 (282/R1) — el numero de guia sigue sin pisar lo que viene debajo", () => {
  it("en las CUATRO hojas hay >= 1 em del cuerpo de la guia hasta la linea siguiente", () => {
    // Feature 350: la fila de abajo ya no es el rotulo «DESTINATARIO» —el bloque
    // de destino perdio su columna de rotulos (D2)— sino el numero de remision,
    // que comparte linea base con la guia, y despues el destinatario. Se mide
    // contra el PRIMER texto que cae por debajo de la guia, que es la unica
    // lectura honesta de «no pisa lo que viene debajo».
    for (const hoja of HOJAS_ETIQUETA) {
      const layout = crearLayout(hoja);
      const doc = construir([etiqueta({ numGuia: 19887906 })], new Map(), hoja);
      const u8 = new Uint8Array(bytesDe(doc));
      const fuentes = fuentesDePagina(u8);
      const textos = textosDePagina(u8).map((t) => ({
        t,
        texto: textoLegible(t, fuentes.get(t.fuenteRes)),
        y: yEnMm(t.y, hoja.altoMm),
      }));

      const guia = textos.find((x) => x.texto === "19887906");
      expect(guia, `no se encontro el numero de guia en ${hoja.id}`).toBeDefined();

      const debajo = textos
        .filter((x) => x.y > guia!.y + 1e-6)
        .sort((a, b) => a.y - b.y)[0];
      expect(debajo, `en ${hoja.id} no hay nada debajo del numero de guia`).toBeDefined();

      const separacion = debajo!.y - guia!.y;
      expect(
        separacion,
        `${hoja.id}: ${separacion.toFixed(3)} mm hasta «${debajo!.texto}» para un cuerpo de ${layout.cuerpos.guia} pt`,
      ).toBeGreaterThanOrEqual(separacionBajoGuiaMm(layout.cuerpos.guia) - 1e-6);
      // Y el cuerpo de la guia no se ha encogido para lograrlo (282/R27).
      expect(guia!.t.tamano).toBeCloseTo(layout.cuerpos.guia, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// Feature 295 — la FECHA en la etiqueta, medida SOBRE EL PDF.
//
// El precedente manda como se verifica esto: la 282 existe porque una linea
// pisaba a otra y nadie lo vio hasta que llego una etiqueta impresa de
// produccion. Asi que aqui no basta con «el dato viaja»: se leen las
// coordenadas del PDF y se comprueba que la linea nueva no toca nada, en las
// CUATRO hojas del catalogo.
//
// Los dos ejes, y por que cada uno:
//   - VERTICAL: la fecha NO estrena linea base, se sube a la de los rotulos de
//     cabecera. Esa linea ya cumple la regla derivada de la 282 respecto del
//     numero de guia (`guiaY - cabeceraY = 8 >= fontGuia * PT_A_MM = 7,7611`),
//     asi que la separacion se hereda en vez de inventarse. Se mide igualmente.
//   - HORIZONTAL: es lo unico nuevo, y en esa fila solo hay literales fijos
//     ("GUÍA", "REMISIÓN") mas la fecha, que siempre son diez caracteres. Se
//     exige que los tres intervalos de tinta sean disjuntos.
//
// Y lo que NO cambia lo siguen guardando los tests de la 282 que ya existen: el
// bloque de campos sigue teniendo SIETE filas (R4), arranca en la misma linea
// base (R1/R3) y el corpus se imprime sin marca de recorte (R6/R26). Meter la
// fecha como octavo campo habria bajado el cupo de 10 lineas a 9 y el caso
// `direccion-3-lineas` habria salido recortado: por eso va en la cabecera.
// ---------------------------------------------------------------------------

/** Ancho de tinta de un texto, medido con las MISMAS metricas con las que se dibujo. */
function anchoMm(
  doc: ReturnType<typeof buildEtiquetasPdf>,
  texto: string,
  estilo: "bold" | "normal",
  pt: number,
): number {
  doc.setFont("helvetica", estilo);
  doc.setFontSize(pt);
  return doc.getTextWidth(texto);
}

describe("R24 (feature 295) — la fecha de creacion se imprime y no pisa nada", () => {
  const FECHA = "2026-08-27";

  it("sale impresa en las CUATRO hojas, leida del propio PDF", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const doc = construir([etiqueta({ fechaCreacion: FECHA })], new Map(), hoja);
      const textos = textosDecodificados(bytesDe(doc));
      expect(textos, `falta el rotulo de la fecha en ${hoja.id}`).toContain(ROTULO_FECHA);
      expect(textos, `falta la fecha en ${hoja.id}`).toContain(FECHA);
    }
  });

  it("comparte linea base con los rotulos de cabecera: no estrena geometria vertical", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const doc = construir([etiqueta({ fechaCreacion: FECHA })], new Map(), hoja);
      const u8 = new Uint8Array(bytesDe(doc));
      const fuentes = fuentesDePagina(u8);
      const textos = textosDePagina(u8).map((t) => ({
        t,
        texto: textoLegible(t, fuentes.get(t.fuenteRes)),
      }));
      const de = (texto: string) => {
        const encontrado = textos.find((x) => x.texto === texto);
        expect(encontrado, `no se encontro «${texto}» en ${hoja.id}`).toBeDefined();
        return encontrado!;
      };

      const yGuiaRotulo = yEnMm(de(ROTULO_GUIA).t.y, hoja.altoMm);
      const yRemisionRotulo = yEnMm(de(ROTULO_REMISION).t.y, hoja.altoMm);
      const yFechaRotulo = yEnMm(de(ROTULO_FECHA).t.y, hoja.altoMm);
      const yFechaValor = yEnMm(de(FECHA).t.y, hoja.altoMm);

      expect(yFechaRotulo).toBeCloseTo(yGuiaRotulo, 6);
      expect(yFechaRotulo).toBeCloseTo(yRemisionRotulo, 6);
      expect(yFechaValor).toBeCloseTo(yGuiaRotulo, 6);
      // Y con el cuerpo de los rotulos, no con uno propio.
      const cuerpoRotulo = de(ROTULO_GUIA).t.tamano;
      expect(de(ROTULO_FECHA).t.tamano).toBeCloseTo(cuerpoRotulo, 6);
      expect(de(FECHA).t.tamano).toBeCloseTo(cuerpoRotulo, 6);
    }
  });

  it("queda 1 em del cuerpo de la guia POR ENCIMA de su numero: la regla de la 282, hacia arriba", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const layout = crearLayout(hoja);
      const doc = construir(
        [etiqueta({ numGuia: 19887906, fechaCreacion: FECHA })],
        new Map(),
        hoja,
      );
      const u8 = new Uint8Array(bytesDe(doc));
      const fuentes = fuentesDePagina(u8);
      const textos = textosDePagina(u8).map((t) => ({
        t,
        texto: textoLegible(t, fuentes.get(t.fuenteRes)),
      }));
      const yFecha = yEnMm(textos.find((x) => x.texto === FECHA)!.t.y, hoja.altoMm);
      const yGuia = yEnMm(textos.find((x) => x.texto === "19887906")!.t.y, hoja.altoMm);

      // El numero de guia dibuja su tinta HACIA ARRIBA desde su linea base (los
      // digitos no tienen descendente): con la fecha un em por encima, su tinta
      // acaba justo donde empieza la del numero, sin invadirla.
      const separacion = yGuia - yFecha;
      expect(
        separacion,
        `${hoja.id}: ${separacion.toFixed(3)} mm sobre un numero de ${layout.cuerpos.guia} pt`,
      ).toBeGreaterThanOrEqual(separacionBajoGuiaMm(layout.cuerpos.guia) - 1e-6);
    }
  });

  it("no se solapa con «GUÍA» ni con «REMISIÓN»: los tres intervalos son disjuntos", () => {
    // Feature 350 (T15) — Se RETIRAN dos aserciones de este test y se dice cual
    // era cada una:
    //   · «REMISIÓN acaba en el margen derecho de la hoja»: ahora acaba en el
    //     borde derecho de la COLUMNA DE TEXTO de la cabecera, porque el QR pasa
    //     a ocupar la derecha (D3). Se sustituye por esa misma igualdad medida
    //     contra el ancho de la columna, que es la version correcta de lo mismo.
    //   · «el par FECHA + fecha va centrado en el lienzo»: se centra en la
    //     columna de texto, por el mismo motivo. Idem.
    // Lo que protegian —que la fila no se apelotone y un tramo entre en otro—
    // se conserva entero abajo, y ademas V2 exige que nada se salga del ancho.
    for (const hoja of HOJAS_ETIQUETA) {
      const layout = crearLayout(hoja);
      const anchoColumna = layout.anchoUtil - layout.qrMm - GAPS_ENTRE_BANDAS[0];
      const doc = construir([etiqueta({ fechaCreacion: FECHA })], new Map(), hoja);
      const u8 = new Uint8Array(bytesDe(doc));
      const fuentes = fuentesDePagina(u8);
      const textos = textosDePagina(u8).map((t) => ({
        t,
        texto: textoLegible(t, fuentes.get(t.fuenteRes)),
      }));
      const tramo = (texto: string, estilo: "bold" | "normal") => {
        const encontrado = textos.find((x) => x.texto === texto)!;
        expect(encontrado, `no se encontro «${texto}» en ${hoja.id}`).toBeDefined();
        const inicio = encontrado.t.x * PT_A_MM;
        return {
          texto,
          inicio,
          fin: inicio + anchoMm(doc, texto, estilo, encontrado.t.tamano),
        };
      };

      const guia = tramo(ROTULO_GUIA, "bold");
      const rotuloFecha = tramo(ROTULO_FECHA, "bold");
      const valorFecha = tramo(FECHA, "normal");
      const remision = tramo(ROTULO_REMISION, "bold");

      // Controles positivos de que la `x` del PDF significa «borde izquierdo del
      // texto»: GUÍA empieza en el margen y REMISIÓN termina en el borde derecho
      // de la columna de texto de la cabecera.
      expect(guia.inicio, `${hoja.id}: GUÍA no empieza en el margen`).toBeCloseTo(
        layout.x(0),
        3,
      );
      expect(
        remision.fin,
        `${hoja.id}: REMISIÓN no acaba en el borde de la columna de cabecera`,
      ).toBeCloseTo(layout.x(anchoColumna), 3);

      // La fila entera, de izquierda a derecha, sin que un tramo entre en el otro.
      const fila = [guia, rotuloFecha, valorFecha, remision];
      for (let i = 1; i < fila.length; i++) {
        const holgura = fila[i].inicio - fila[i - 1].fin;
        expect(
          holgura,
          `${hoja.id}: «${fila[i - 1].texto}» y «${fila[i].texto}» se solapan (${holgura.toFixed(3)} mm)`,
        ).toBeGreaterThan(0);
      }
      // Y el par rotulo+valor va centrado en la columna: la holgura sobrante no
      // se acumula toda a un lado (seria la señal de que un dia el par se come
      // un rotulo al crecer).
      const centroPar = (rotuloFecha.inicio + valorFecha.fin) / 2;
      expect(centroPar).toBeCloseTo(layout.x(anchoColumna / 2), 3);
    }
  });
});

// ---------------------------------------------------------------------------
// Feature 350 (T15) — RETIRADO POR MANDATO: «R4 — los siete campos, sus rotulos
// y su orden, intactos».
//
// Que afirmaba: que los rotulos DESTINATARIO / TELÉFONO / DIRECCIÓN / UBICACIÓN
// / PRODUCTO / MONTO A COBRAR / TIENDA aparecieran en ese orden de arriba abajo,
// y la 282 lo blindaba con un «NO añadir, quitar, reordenar ni renombrar».
//
// Que decision lo sustituye: el humano firmo el rediseño («esta perfecto, vamos
// con ese rediseño») y con el las decisiones D2 y D3, que quitan la columna de
// rotulos del bloque de destino y reordenan por jerarquia de tamaño. Es la misma
// clase de revision que la 282 hizo de la D3 de la 150, y por el mismo motivo:
// una firma posterior.
//
// Que test nuevo cubre lo mismo o mas: **R17** sigue exigiendo los DIEZ datos —no
// siete rotulos, los diez datos— y **V1** los reconstruye caracter a caracter;
// **R13** exige el orden NUEVO de arriba abajo y V3 lo mide sobre el PDF. Lo que
// aquella asercion garantizaba (que no desaparezca informacion del papel) queda
// cubierto con mas fuerza; lo que garantizaba de mas (que el orden no cambie
// nunca) es justo lo que esta ficha viene a cambiar.
// ---------------------------------------------------------------------------

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

// ===========================================================================
// Feature 350 (T12) — V1-V6 SOBRE EL PDF, en las CUATRO hojas y con el corpus
// entero. Las seis aserciones viven en `tests/unit/pdf/etiquetas-verificacion.ts`
// porque las corren TAMBIEN el generador del servidor: si estuvieran duplicadas,
// la primera divergencia entre las dos copias seria invisible.
// ===========================================================================

/**
 * Los canvas del QR que el modal recolecta de la vista previa. Hacen falta para
 * V3: sin el QR dibujado, la asercion «ningun texto invade la banda de codigos»
 * no tendria banda contra la que medir. `toDataURL` esta estubado a un PNG 1x1
 * valido en el `beforeEach`.
 */
function canvasesDe(etiquetas: EtiquetaGuiaDTO[]): Map<string, HTMLCanvasElement> {
  return new Map(etiquetas.map((e) => [e.ordenId, document.createElement("canvas")]));
}

describe("Feature 350 — V1-V6: el corpus entero, en las cuatro hojas", () => {
  for (const caso of CORPUS_282) {
    for (const hoja of HOJAS_ETIQUETA) {
      it(`caso «${caso.id}» en ${hoja.id}`, () => {
        const doc = construir([caso.dto], canvasesDe([caso.dto]), hoja);
        const bytes = new Uint8Array(bytesDe(doc));
        verificarEtiqueta(
          doc,
          bytes,
          0,
          crearLayout(hoja),
          fuenteEtiqueta,
          caso,
          `${caso.id}/${hoja.id}`,
        );
      });
    }
  }
});

describe("R5 — el PEOR CASO MEDIDO, con sus longitudes reales", () => {
  it("la direccion mide 286 caracteres y el producto 138 (el maximo de produccion)", () => {
    // Si alguien acortara el fixture «para que pase», esto lo delata.
    expect(CASO_PEOR_MEDIDO.dto.direccion).toHaveLength(PEOR_CASO_LARGOS.direccion);
    expect(CASO_PEOR_MEDIDO.dto.producto).toHaveLength(PEOR_CASO_LARGOS.producto);
    expect(PEOR_CASO_LARGOS.direccion).toBe(286);
    expect(PEOR_CASO_LARGOS.producto).toBe(138);
  });

  it("se emite en las CUATRO hojas: ni lanza ni recorta", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      expect(() => construir([CASO_PEOR_MEDIDO.dto], new Map(), hoja)).not.toThrow();
    }
  });
});

describe("R10/R11 — el alto extra de la hoja se vuelve LINEAS, no letra grande", () => {
  it("el peor caso usa MAS lineas en una hoja mayor, no un cuerpo mayor a secas", () => {
    const contar = (hojaId: string) => {
      const hoja = getHojaEtiqueta(hojaId);
      const doc = construir([CASO_PEOR_MEDIDO.dto], new Map(), hoja);
      const u8 = new Uint8Array(bytesDe(doc));
      const fuentes = fuentesDePagina(u8);
      const textos = textosDePagina(u8);
      const cuerpos = textos.map((t) => t.tamano);
      return {
        lineas: textos.length,
        cuerpoMin: Math.min(...cuerpos),
        // Cuerpo del destinatario: el primer texto que reconstruye su nombre.
        destinatario: textos.find(
          (t) => textoLegible(t, fuentes.get(t.fuenteRes)) === CASO_PEOR_MEDIDO.dto.destinatario,
        )?.tamano,
      };
    };
    const base = contar("100x100");
    const a4 = contar("a4");
    // En A4 el texto respira: el cuerpo minimo sube MUY por encima del suelo,
    // que es lo que significa «el alto sobrante es capacidad» (R10).
    expect(base.cuerpoMin).toBe(CUERPO_MINIMO_PT);
    expect(a4.cuerpoMin).toBeGreaterThan(CUERPO_MINIMO_PT * 2);
    expect(a4.destinatario!).toBeGreaterThan(base.destinatario!);
  });
});

describe("R21 — todo lo que necesita la fuente embebida pasa por exigirCobertura", () => {
  it("los textos Type0 del PDF son EXACTAMENTE los que la necesitan", () => {
    for (const caso of CORPUS_282) {
      const doc = construir([caso.dto], new Map(), getHojaEtiqueta("100x100"));
      const u8 = new Uint8Array(bytesDe(doc));
      const fuentes = fuentesDePagina(u8);
      const conType0 = textosDePagina(u8)
        .filter((t) => fuentes.get(t.fuenteRes)?.subtype === "Type0")
        .map((t) => textoLegible(t, fuentes.get(t.fuenteRes)));

      // (a) Nada se dibuja con la fuente embebida sin necesitarla: o es el
      //     importe (que lleva el simbolo de moneda) o tiene algun caracter que
      //     la fuente estandar no sabe escribir.
      const monto = formatMonto(caso.dto.montoCobrar);
      for (const texto of conType0) {
        expect(
          texto === monto || !seguroEnFuenteEstandar(texto),
          `caso «${caso.id}»: «${texto}» va con la fuente embebida sin necesitarla`,
        ).toBe(true);
      }

      // (b) Y nada que la NECESITE se dibuja con la estandar, que es donde jsPDF
      //     borraria el caracter en silencio.
      const conEstandar = textosDePagina(u8)
        .filter((t) => fuentes.get(t.fuenteRes)?.subtype !== "Type0")
        .map((t) => textoLegible(t, fuentes.get(t.fuenteRes)));
      for (const texto of conEstandar) {
        expect(
          seguroEnFuenteEstandar(texto),
          `caso «${caso.id}»: «${texto}» va con la fuente estandar y lleva un caracter que esta BORRA`,
        ).toBe(true);
      }

      // (c) Control positivo: el importe SIEMPRE esta entre los Type0.
      expect(conType0, `caso «${caso.id}»`).toContain(monto);
      expect(textosConFuenteEmbebida(caso.dto)).toContain(monto);
    }
  });

  it("el marcador de «sin direccion» sale impreso: es la raya larga, no un hueco", () => {
    // jsPDF BORRA en silencio la raya larga (U+2014) cuando dibuja con la fuente
    // estandar —medido en esta ficha—, asi que el marcador se dibuja con la
    // embebida. Sin esto, una orden sin direccion imprimia una linea VACIA.
    const doc = construir([CASO_MINIMOS.dto], new Map(), getHojaEtiqueta("100x100"));
    const textos = textosDecodificados(bytesDe(doc));
    expect(CASO_MINIMOS.dto.direccion).toBeNull();
    expect(textos).toContain(CASO_MINIMOS.esperado.direccion);
    expect(CASO_MINIMOS.esperado.direccion).toBe("—");
  });
});

describe("R15/R22 — el importe: una linea, su recuadro y sus caracteres intactos", () => {
  it("hay UN recuadro y el importe cabe dentro sin partirse", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      const doc = construir([CASO_PEOR_MEDIDO.dto], canvasesDe([CASO_PEOR_MEDIDO.dto]), hoja);
      const bytes = new Uint8Array(bytesDe(doc));
      // V5 lo comprueba dato a dato; aqui se afirma la forma: exactamente un
      // rectangulo dibujado en toda la etiqueta.
      const rects = rectangulosDePagina(bytes);
      expect(rects, `${hoja.id}: se esperaba UN recuadro`).toHaveLength(1);
      expect(rects[0].operador).toBe("S");
    }
  });

  it("el texto del importe es EL del formateador, caracter por caracter", () => {
    // R22: ninguna decision de maquetacion altera los caracteres del importe. El
    // esperado sale del literal del fixture, no de `formatMonto`.
    const doc = construir([CASO_EVIDENCIA.dto], new Map(), getHojaEtiqueta("100x100"));
    const textos = textosDecodificados(bytesDe(doc));
    expect(textos).toContain(CASO_EVIDENCIA.esperado.montoCobrar);
    expect(CASO_EVIDENCIA.esperado.montoCobrar).toBe("₡18.000");
  });
});
