import { describe, it, expect, vi, beforeEach } from "vitest";
import { inflateSync } from "node:zlib";

// Feature 136 (T1.2) — el builder corre en Node SIN DOM (R7): se mockean solo las
// libs de rasterizado (qrcode/bwip-js) para (a) afirmar QUE valor codifica cada
// codigo y (b) mantener el test rapido/determinista; jspdf se usa REAL, lo que
// prueba de paso que ensambla el PDF en Node (sin canvas del navegador).

// PNG 1x1 valido: jsPDF decodifica realmente la imagen al hacer addImage("PNG"),
// asi que los mocks devuelven un PNG bien formado (no basta un data URL cualquiera).
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAklEQVR4AewaftIAAAFbSURBVMXBUYrbQBQAwW4x979yJwP7QAivIzsfqhKImyo2lYp3VO44eNjiR8U7KqNCZatQ2SrOKt5ROXjY4kLlrOIulYorlbOKsfiCSsWmMio+dfCwxZdURsWmUvGJxUXFp1S2ilcqfnPwsMUPlU9UbCoVm0rFUPmXVfENla1C5arijoOHLZWt4kqlYlM5q7iqUHmnYqgIxC8q7lAZFUNlq1DZKlTGwcME4q+Kd1ReqVDZKobKbyqGQFxUvKKyVahsFWcqo2JTqdhUKsbBwwTipEJlVGwqZxVXKmcVVyqjYlVcVVxVDJX/UTEOHrZU7qq4q+KVCpWtYvGj4h2VUaGyVaiMiqGyVahsFWcHD1tcqJxVXKlUbCqjYqgMlaEyVA6+UDEqhsqoGBWj4uzgYYsvqWwVo2KoDJWhUjEWFxWfUKkYKqNiU6nYVM4OHrb4oXKXSsWmMlReqXhF5Q9xIO89ads5LwAAAABJRU5ErkJggg==";
const PNG_1X1 = Buffer.from(PNG_1X1_BASE64, "base64");

const qrToDataURL = vi.fn(async (...args: [text: string, opts?: unknown]) => {
  void args;
  return `data:image/png;base64,${PNG_1X1_BASE64}`;
});
vi.mock("qrcode", () => ({
  default: { toDataURL: (text: string, opts?: unknown) => qrToDataURL(text, opts) },
}));

const barcodeToBuffer = vi.fn(async (...args: [opts: { bcid: string; text: string }]) => {
  void args;
  return PNG_1X1;
});
vi.mock("bwip-js/node", () => ({
  default: { toBuffer: (opts: { bcid: string; text: string }) => barcodeToBuffer(opts) },
}));

import { buildEtiquetasLotePdf } from "@/lib/pdf/etiquetas-pdf-lote";
import { buildPaqueteUrl } from "@/lib/utils/paquete-url";
import { formatMonto } from "@/lib/config/moneda";
import { MARCA_CORTE } from "@/lib/pdf/etiquetas-ajuste";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
import {
  CUERPO_MINIMO_PT,
  MAQUETA_BASE,
  separacionBajoGuiaMm,
} from "@/lib/pdf/etiquetas-maqueta";
import { crearLayoutBase } from "@/lib/pdf/etiquetas-layout";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

import {
  CASO_ALFABETO_REAL,
  CASO_EVIDENCIA,
  CASO_PEOR_MEDIDO,
  CORPUS_282,
  NO_ASCII_MEDIDOS,
} from "../../fixtures/etiquetas-282";
import { verificarEtiqueta } from "./etiquetas-verificacion";
import {
  cidsDe,
  fuentesDePagina,
  textoLegible,
  textosDePagina,
} from "./pdf-inspector";
import { contorno, tieneTinta } from "./ttf-lector";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

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
    montoCobrar: 100,
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
 * Cuenta objetos `/Type /Page` (excluye el nodo `/Pages`). Los diccionarios de
 * objeto viajan en claro aunque el documento use `compress: true` (solo se
 * deflatean los streams), asi que este conteo sigue siendo valido.
 */
function contarPaginas(bytes: Uint8Array): number {
  const s = Buffer.from(bytes).toString("latin1");
  return (s.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

/**
 * Texto visible del PDF. El builder emite con `compress: true` (BLOQ-1: sin ello
 * cada etiqueta pesa ~80x mas), asi que los content streams van deflateados y NO
 * se pueden leer escaneando los bytes en crudo: hay que inflarlos. Devuelve la
 * concatenacion de todo lo inflable mas el cuerpo en claro (diccionarios).
 */
function textoDelPdf(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);
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
      // Stream no inflable (imagen ya codificada / datos crudos): no aporta texto.
    }
  }
  return out;
}

beforeEach(() => {
  qrToDataURL.mockClear();
  barcodeToBuffer.mockClear();
});

/** Pagina cuadrada de 100 mm expresada en puntos (unidad interna del PDF). */
const SIZE_PT = (100 * 72) / 25.4;

/**
 * Posiciones del texto dibujado, en mm desde el borde SUPERIOR (la misma
 * orientacion en la que maqueta el generador). jsPDF emite un `x y Td` por
 * llamada a `text()` y coordenadas en pt medidas desde el borde inferior.
 */
function textosConY(bytes: Uint8Array): Array<{ y: number; texto: string }> {
  const re = /([\d.-]+)\s+([\d.-]+)\s+Td\s*\n?\(((?:\\[\s\S]|[^()\\])*)\)\s*Tj/g;
  const out: Array<{ y: number; texto: string }> = [];
  let m: RegExpExecArray | null;
  const stream = textoDelPdf(bytes);
  while ((m = re.exec(stream)) !== null) {
    out.push({ y: ((SIZE_PT - Number(m[2])) * 25.4) / 72, texto: m[3] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Feature 350 (T15) — RETIRADO: «el texto no invade la banda del QR» (las dos
// aserciones) y «los siete rotulos siguen dibujados».
//
// Que afirmaban: que ninguna linea base bajase de `100 - 6 - 26 = 68`, la `y`
// FIJA en la que vivia el bloque de codigos; y que los siete rotulos del bloque
// rotulo/valor siguieran presentes despues del recorte.
//
// Que decision los sustituye: la banda de codigos ya no esta en una `y` fija del
// lienzo —se ancla al borde inferior del area util (R9)— y el bloque de destino
// ya no lleva rotulos (D2/R16). El recorte, que era la razon de la segunda
// asercion, ha desaparecido del camino.
//
// Que test nuevo cubre lo mismo o mas: **V3** en «Feature 350 — V1-V6 del lado
// del servidor», que mide sobre el PDF que ningun texto solapa el rectangulo
// REAL de las dos imagenes, en vez de una `y` calculada a mano.
// ---------------------------------------------------------------------------

describe("buildEtiquetasLotePdf (R1-R7)", () => {
  it("genera un PDF con una pagina por etiqueta", async () => {
    const etiquetas = [
      etiqueta({ ordenId: "a", numGuia: 1 }),
      etiqueta({ ordenId: "b", numGuia: 2 }),
      etiqueta({ ordenId: "c", numGuia: 3 }),
    ];
    const bytes = await buildEtiquetasLotePdf(etiquetas);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);
    // R3: tantas paginas como etiquetas (sin duplicar ni omitir).
    expect(contarPaginas(bytes)).toBe(3);
    // R2: pagina cuadrada de 100 mm = ~283.46 pt; el MediaBox lo refleja.
    const s = Buffer.from(bytes).toString("latin1");
    expect(s).toMatch(/\/MediaBox\s*\[0 0 283\.\d+ 283\.\d+\]/);
  });

  it("el QR codifica la URL /paquete/<numGuia>", async () => {
    await buildEtiquetasLotePdf([etiqueta({ numGuia: 1042 })]);
    // R5: el QR recibe buildPaqueteUrl(numGuia), no el numero pelado.
    expect(qrToDataURL).toHaveBeenCalledTimes(1);
    const arg = qrToDataURL.mock.calls[0][0];
    expect(arg).toBe(buildPaqueteUrl(1042));
    expect(arg).toContain("/paquete/1042");
    expect(arg).not.toBe("1042");
  });

  it("el barcode codifica el num_guia en CODE128", async () => {
    await buildEtiquetasLotePdf([etiqueta({ numGuia: 777, barcodeValue: "777" })]);
    // R6: bwip-js genera CODE128 del barcodeValue (= num_guia).
    expect(barcodeToBuffer).toHaveBeenCalledTimes(1);
    const opts = barcodeToBuffer.mock.calls[0][0];
    expect(opts.bcid).toBe("code128");
    expect(opts.text).toBe("777");
  });

  it("cada pagina incluye los campos de la orden", async () => {
    const bytes = await buildEtiquetasLotePdf([
      etiqueta({
        numGuia: 1042,
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
      }),
    ]);
    // R4: los datos que exige el requisito quedan escritos como texto en el
    // content stream (guia, remision, destinatario, telefono, direccion, ubicacion
    // geografica, producto, monto a cobrar y tienda). Feature 350: la version
    // FUERTE de esto —reconstruir cada dato caracter a caracter— es V1; este
    // `toContain` se conserva como red de seguridad barata.
    const s = textoDelPdf(bytes);
    expect(s).toContain("1042"); // numero de guia
    expect(s).toContain("REM-1"); // numero de remision
    expect(s).toContain("AnaDestinatario");
    expect(s).toContain("0999999999"); // telefono
    expect(s).toContain("CalleDireccion 123");
    expect(s).toContain("ProductoTest");
    expect(s).toContain("TiendaTest");
    // Ubicacion geografica: los 4 niveles (se dibujan unidos por " / ", pero el
    // ajuste de linea puede partirlos, asi que se afirma nivel a nivel).
    expect(s).toContain("ZonaTest");
    expect(s).toContain("ProvinciaTest");
    expect(s).toContain("CantonTest");
    expect(s).toContain("DistritoTest");
    // Monto a cobrar: la cadena COMPLETA que produce el formateador, simbolo
    // incluido, decodificada por el mapa a Unicode que declara el propio
    // documento. Feature 282: la asercion vieja miraba el tramo ASCII mas largo
    // ("234,50") porque el simbolo NO se podia afirmar -- precisamente porque
    // no se imprimia. Ahora si se imprime, y se afirma entero.
    expect(textosDecodificados(bytes)).toContain(formatMonto(1234.5));
  });
});

// ---------------------------------------------------------------------------
// Feature 282 (T21) — El MISMO defecto vivia aqui, y aqui se mide igual: sobre
// los bytes del PDF que produce ESTE generador, no sobre los del navegador.
// ---------------------------------------------------------------------------

const PT_A_MM_282 = 25.4 / 72;

/** Todas las cadenas dibujadas, decodificadas por el `/ToUnicode` del documento. */
function textosDecodificados(bytes: Uint8Array, indice = 0): string[] {
  const fuentes = fuentesDePagina(bytes, indice);
  return textosDePagina(bytes, indice).map((t) =>
    textoLegible(t, fuentes.get(t.fuenteRes)),
  );
}

describe("R24 (282/R19) — el servidor tampoco pisa lo que viene debajo de la guia", () => {
  it("la separacion hasta la linea siguiente es >= 1 em del cuerpo del numero de guia", async () => {
    const bytes = await buildEtiquetasLotePdf([CASO_EVIDENCIA.dto]);
    const fuentes = fuentesDePagina(bytes);
    const textos = textosDePagina(bytes).map((t) => ({
      t,
      texto: textoLegible(t, fuentes.get(t.fuenteRes)),
      // La pagina es cuadrada de 100 mm; la `y` del PDF crece hacia arriba.
      y: 100 - t.y * PT_A_MM_282,
    }));

    const guia = textos.find((x) => x.texto === String(CASO_EVIDENCIA.dto.numGuia));
    expect(guia, "no se encontro el numero de guia").toBeDefined();

    // Feature 350: debajo de la guia ya no hay un rotulo «DESTINATARIO» —el
    // bloque de destino perdio su columna de rotulos (D2)—, asi que se mide
    // contra el PRIMER texto que cae por debajo, que es la lectura honesta de
    // «no pisa lo que viene debajo».
    const debajo = textos.filter((x) => x.y > guia!.y + 1e-6).sort((a, b) => a.y - b.y)[0];
    expect(debajo, "no hay nada debajo del numero de guia").toBeDefined();

    const separacion = debajo!.y - guia!.y;
    expect(
      separacion,
      `${separacion.toFixed(3)} mm hasta «${debajo!.texto}» para un cuerpo de ${MAQUETA_BASE.fontGuia} pt`,
    ).toBeGreaterThanOrEqual(separacionBajoGuiaMm(MAQUETA_BASE.fontGuia) - 1e-6);
    // Y el cuerpo de la guia sigue siendo el de siempre (282/R27).
    expect(guia!.t.tamano).toBeCloseTo(MAQUETA_BASE.fontGuia, 6);
  });
});

describe("R20 — el simbolo, impreso tambien en el PDF del servidor", () => {
  /** El caso de la evidencia: montoCobrar = 18000 => "₡18.000". */
  const dto = CASO_EVIDENCIA.dto;

  function conPaginas(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      ...dto,
      ordenId: `ord-${i}`,
      numGuia: dto.numGuia + i,
      barcodeValue: String(dto.numGuia + i),
    }));
  }

  it("eslabon 1 — el recurso de fuente del monto es /Type0 con /Identity-H y /FontFile2", async () => {
    const bytes = await buildEtiquetasLotePdf([dto]);
    const fuentes = fuentesDePagina(bytes);
    const monto = textosDePagina(bytes).find(
      (t) => textoLegible(t, fuentes.get(t.fuenteRes)) === formatMonto(18000),
    );
    expect(monto, "no se encontro la fila del monto").toBeDefined();
    const recurso = fuentes.get(monto!.fuenteRes)!;
    expect(recurso.subtype).toBe("Type0");
    expect(recurso.encoding).toBe("Identity-H");
    expect(recurso.baseFont).toBe(fuenteEtiqueta.nombre);
    expect(recurso.fontFile2).toBeTruthy();
  });

  it("eslabon 2 — decodificado por el /ToUnicode DEL PROPIO PDF da «₡18.000»", async () => {
    const bytes = await buildEtiquetasLotePdf([dto]);
    const fuentes = fuentesDePagina(bytes);
    const monto = textosDePagina(bytes).find((t) => {
      const recurso = fuentes.get(t.fuenteRes);
      return recurso?.subtype === "Type0" && textoLegible(t, recurso).includes("18.000");
    })!;
    expect(monto.hex).toBe(true);
    const recurso = fuentes.get(monto.fuenteRes)!;
    expect(textoLegible(monto, recurso)).toBe(formatMonto(18000));
    expect(textoLegible(monto, recurso)).toBe("₡18.000");
    expect([...recurso.toUnicode!.values()]).toContain("₡");
  });

  it("eslabon 3 — el CID del simbolo tiene contorno NO VACIO en su /FontFile2", async () => {
    const bytes = await buildEtiquetasLotePdf([dto]);
    const fuentes = fuentesDePagina(bytes);
    const monto = textosDePagina(bytes).find(
      (t) => textoLegible(t, fuentes.get(t.fuenteRes)) === formatMonto(18000),
    )!;
    const recurso = fuentes.get(monto.fuenteRes)!;
    expect(recurso.cidToGidMap).toBe("Identity");
    const cids = cidsDe(monto);
    const posicion = [...textoLegible(monto, recurso)].indexOf("₡");
    expect(posicion).toBeGreaterThanOrEqual(0);
    const programa = recurso.fontFile2!;
    expect(
      contorno(programa, cids[posicion]),
      "el glifo del simbolo esta VACIO: imprimiria papel en blanco",
    ).toBeGreaterThan(0);
    expect(tieneTinta(programa, cids[posicion])).toBe(true);
  });

  it("R15 — el /FontFile2 no pasa de 12 KB y no crece con las paginas", async () => {
    const medir = async (n: number): Promise<number> => {
      const bytes = await buildEtiquetasLotePdf(conPaginas(n));
      const embebida = [...fuentesDePagina(bytes).values()].find((f) => f.fontFile2);
      expect(embebida).toBeDefined();
      return embebida!.fontFile2!.byteLength;
    };
    const conUna = await medir(1);
    const conDiez = await medir(10);
    expect(conUna, `el /FontFile2 mide ${conUna} B`).toBeLessThanOrEqual(12 * 1024);
    expect(conDiez).toBe(conUna);
  });

  it("R23 — la fuente NO se lee del sistema de archivos en tiempo de ejecucion", () => {
    // SIN comentarios: la cabecera del modulo explica por que aqui no hay
    // `readFileSync`, y un barrido sobre el texto crudo denunciaria la
    // explicacion en vez del codigo.
    const codigo = codigoSinComentarios("lib/pdf/etiquetas-pdf-lote.ts");
    expect(codigo).not.toMatch(/readFileSync|readFile\(|node:fs/);
    // Y si que la importa de forma ESTATICA (nada de `import()` diferido, que en
    // el servidor no ahorra bundle y añade un modo de fallo).
    expect(codigo).toMatch(/^import .*from "\.\/etiquetas-fuente";$/m);
  });
});

describe("R26/R34 — el corpus tampoco se recorta en el servidor", () => {
  it("ningun caso del corpus sale con marca de recorte", async () => {
    for (const caso of CORPUS_282) {
      const bytes = await buildEtiquetasLotePdf([caso.dto]);
      const recortados = textosDecodificados(bytes).filter((t) =>
        t.includes(MARCA_CORTE),
      );
      expect(
        recortados,
        `caso «${caso.id}»: se recorto ${JSON.stringify(recortados)}`,
      ).toEqual([]);
    }
  });

  it("los seis no-ASCII medidos en produccion salen impresos", async () => {
    const bytes = await buildEtiquetasLotePdf([CASO_ALFABETO_REAL.dto]);
    const texto = textosDecodificados(bytes).join("");
    for (const caracter of NO_ASCII_MEDIDOS) {
      expect(texto, `falta «${caracter}» en la etiqueta impresa`).toContain(caracter);
    }
  });
});

describe("R28 — un caracter fuera del subconjunto falla de forma VISIBLE", () => {
  it("no produce un PDF con el importe mutilado: lanza con el code point en el mensaje", async () => {
    // Se fuerza el simbolo a uno que el subconjunto cp1252 no cubre (la rupia
    // india, U+20B9). El sistema NO debe imprimir la etiqueta sin el.
    vi.resetModules();
    process.env.MONEDA_SIMBOLO = "₹";
    try {
      const { buildEtiquetasLotePdf: build } = await import("@/lib/pdf/etiquetas-pdf-lote");
      await expect(build([CASO_EVIDENCIA.dto])).rejects.toThrow(
        /U\+20B9[\s\S]*Monto a cobrar/,
      );
    } finally {
      delete process.env.MONEDA_SIMBOLO;
      vi.resetModules();
    }
  });
});

describe("R24 — el coste de la fuente es por DOCUMENTO, cero por pagina adicional", () => {
  it("un lote de 20 paginas declara UN solo recurso Type0 y UN solo /FontFile2", async () => {
    const etiquetas = Array.from({ length: 20 }, (_, i) => ({
      ...CASO_EVIDENCIA.dto,
      ordenId: `o${i}`,
      numGuia: CASO_EVIDENCIA.dto.numGuia + i,
      barcodeValue: String(CASO_EVIDENCIA.dto.numGuia + i),
    }));
    const bytes = await buildEtiquetasLotePdf(etiquetas);
    const pdf = Buffer.from(bytes).toString("latin1");
    // Es la forma ESTRUCTURAL de la medida de tiempo (f = 0,79 ms por documento,
    // medido en `progress/impl_282.md`): si el registro se colara dentro del
    // bucle de paginas, aqui habria 20 de cada uno y el coste seria f x N.
    expect((pdf.match(/\/Subtype \/Type0/g) ?? []).length).toBe(1);
    expect((pdf.match(/\/FontFile2/g) ?? []).length).toBe(1);
    expect((pdf.match(/\/Type \/Page(?![s])/g) ?? []).length).toBe(20);
  });
});

// ===========================================================================
// Feature 350 (T12) — V1-V6 DEL LADO DEL SERVIDOR.
//
// Las mismas seis aserciones que corre el generador de cliente, sobre los bytes
// que produce ESTE generador. No es duplicacion: es la unica forma de que un
// fallo que solo ocurriese en el camino del servidor —el que reciben los
// integradores por API— no pase inadvertido. El modulo de aserciones es
// compartido; lo que cambia es de donde salen los bytes.
// ===========================================================================

describe("Feature 350 — V1-V6 sobre el PDF consolidado del lote", () => {
  for (const caso of CORPUS_282) {
    it(`caso «${caso.id}» en la pagina de 100 x 100`, async () => {
      const bytes = await buildEtiquetasLotePdf([caso.dto]);
      // El `doc` es solo un medidor: se le registra la MISMA fuente embebida
      // para que `getTextWidth` use las metricas con las que se dibujo.
      const { jsPDF } = await import("jspdf");
      const medidor = new jsPDF({ unit: "mm", format: [100, 100] });
      const { registrarFuente } = await import("@/lib/pdf/etiquetas-fuente-registro");
      registrarFuente(medidor, fuenteEtiqueta);
      verificarEtiqueta(
        medidor,
        bytes,
        0,
        crearLayoutBase(),
        fuenteEtiqueta,
        caso,
        `servidor/${caso.id}`,
      );
    });
  }
});

describe("R5 — el peor caso medido tambien se emite en el PDF del lote", () => {
  it("no lanza y ningun texto baja del suelo de legibilidad", async () => {
    const bytes = await buildEtiquetasLotePdf([CASO_PEOR_MEDIDO.dto]);
    const cuerpos = textosDePagina(bytes).map((t) => t.tamano);
    expect(cuerpos.length).toBeGreaterThan(10);
    expect(Math.min(...cuerpos)).toBeGreaterThanOrEqual(CUERPO_MINIMO_PT);
  });
});
