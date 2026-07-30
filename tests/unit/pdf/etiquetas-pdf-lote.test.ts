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
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

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

/**
 * ¿Aparece `valor` como texto dibujado en el PDF? jsPDF escribe los literales en
 * WinAnsi (ASCII tal cual), PERO si la cadena trae algun caracter fuera de ese
 * juego —el simbolo de moneda, p. ej.— codifica TODO ese texto en UTF-16BE, y
 * entonces cada caracter va precedido de un byte 0x00. Se acepta cualquiera de
 * las dos formas para no atar el test a la moneda configurada.
 */
function incluyeTexto(pdf: string, valor: string): boolean {
  if (pdf.includes(valor)) return true;
  const utf16be = [...valor].map((c) => `\u0000${c}`).join("");
  return pdf.includes(utf16be);
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

describe("buildEtiquetasLotePdf — el texto no invade la banda del QR", () => {
  // El QR se dibuja en una `y` FIJA: 100 - 6 (margen) - 26 (lado) = 68 de borde
  // superior. Antes de este arreglo el texto fluia hasta ~y=90 y los ultimos
  // campos (PRODUCTO, MONTO, TIENDA) se imprimian ENCIMA del QR.
  const QR_TOP_MM = 100 - 6 - 26;

  it("con datos normales, ninguna linea baja del borde superior del QR", async () => {
    const bytes = await buildEtiquetasLotePdf([etiqueta()]);
    const textos = textosConY(bytes);
    // Sanidad del parseo: cabecera (2) + 7 rotulos + 7 valores.
    expect(textos.length).toBeGreaterThanOrEqual(16);
    const masAbajo = Math.max(...textos.map((t) => t.y));
    expect(masAbajo).toBeLessThanOrEqual(QR_TOP_MM);
  });

  it("con direccion, ubicacion y producto largos tampoco (se recorta, no se superpone)", async () => {
    const bytes = await buildEtiquetasLotePdf([
      etiqueta({
        destinatario: "María Fernanda de los Ángeles Rodríguez Villalobos",
        direccion:
          "Avenida Siempre Viva 742, casa esquinera de dos plantas color celeste, 300 metros al norte de la escuela, portón negro",
        producto:
          "Juego de sartenes antiadherentes de cinco piezas con tapa de vidrio templado y mango desmontable",
        zonaNombre: "Zona Metropolitana Ampliada Norte",
        provinciaNombre: "Provincia de San José",
        cantonNombre: "Cantón Central de San José",
        distritoNombre: "Distrito Catedral",
        tiendaNombre: "Comercializadora de Electrodomésticos del Valle S.A.",
      }),
    ]);
    const textos = textosConY(bytes);
    const masAbajo = Math.max(...textos.map((t) => t.y));
    expect(masAbajo).toBeLessThanOrEqual(QR_TOP_MM);
    // Y los siete rotulos siguen dibujados: el recorte quita cola de texto,
    // nunca campos enteros.
    const s = textoDelPdf(bytes);
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
    // R4: los NUEVE datos que exige el requisito quedan escritos como texto en el
    // content stream (guia, remision, destinatario, telefono, direccion, ubicacion
    // geografica, producto, monto a cobrar y tienda).
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
    // Monto a cobrar: formateado con la moneda configurada (p. ej. "₡1 234,50").
    // Se afirma el tramo ASCII visible mas largo del importe ("234,50"), valido
    // para cualquier locale/moneda configurada, sin hardcodear el simbolo.
    const tramosAscii = formatMonto(1234.5)
      .split(/[^\x21-\x7E]+/)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    expect(tramosAscii[0].length).toBeGreaterThan(1);
    expect(incluyeTexto(s, tramosAscii[0])).toBe(true);
  });
});
