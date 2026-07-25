import { describe, it, expect, vi, beforeEach } from "vitest";

// Feature 112 (T1.2) — el builder corre en Node SIN DOM (R7): se mockean solo las
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

/** Cuenta objetos `/Type /Page` (excluye el nodo `/Pages`) en el PDF sin comprimir. */
function contarPaginas(bytes: Uint8Array): number {
  const s = Buffer.from(bytes).toString("latin1");
  return (s.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

beforeEach(() => {
  qrToDataURL.mockClear();
  barcodeToBuffer.mockClear();
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
        destinatario: "AnaDestinatario",
        producto: "ProductoTest",
        tiendaNombre: "TiendaTest",
      }),
    ]);
    // R4: los valores de la orden quedan escritos como texto en el content stream.
    const s = Buffer.from(bytes).toString("latin1");
    expect(s).toContain("AnaDestinatario");
    expect(s).toContain("ProductoTest");
    expect(s).toContain("TiendaTest");
    expect(s).toContain("REM-1");
  });
});
