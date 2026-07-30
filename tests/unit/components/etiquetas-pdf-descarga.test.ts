// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Feature 150 (T7, R19) — Cablea la DESCARGA: que `descargarEtiquetasPdf` guarde
// con el nombre del tamaño elegido. Se separa de `etiquetas-pdf.test.ts` (que usa
// jspdf REAL para afirmar el /MediaBox) por una razon tecnica: `save` es una
// propiedad de INSTANCIA de jsPDF —no del prototipo— asi que no hay donde
// espiarla, y el build de Node de jspdf la implementa con `fs.writeFileSync`, es
// decir escribiria archivos de verdad durante la suite. Aqui jspdf se sustituye
// por un doble minimo que solo registra el nombre con el que se guarda.

const saveMock = vi.fn<(nombre: string) => void>();
const addPageMock = vi.fn();

class JsPDFDoble {
  constructor(public opciones: unknown) {}
  save = (nombre: string) => saveMock(nombre);
  addPage = (formato: unknown) => addPageMock(formato);
  setFont = () => undefined;
  setFontSize = () => undefined;
  text = () => undefined;
  addImage = () => undefined;
  splitTextToSize = (texto: string) => [texto];
  // La maqueta mide el rotulo mas ancho para colocar la columna del valor; 1 mm
  // por caracter basta para que el doble responda algo coherente (el ancho real
  // se afirma con jspdf de verdad en `etiquetas-pdf.test.ts`).
  getTextWidth = (texto: string) => texto.length;
}

vi.mock("jspdf", () => ({
  jsPDF: class {
    constructor(opciones: unknown) {
      return new JsPDFDoble(opciones) as unknown as object;
    }
  },
}));
vi.mock("jsbarcode", () => ({ default: () => undefined }));

import { descargarEtiquetasPdf } from "@/app/(app)/ordenes/_components/etiquetas-pdf";
import { HOJAS_ETIQUETA, getHojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import type { EtiquetaGuiaDTO } from "@/lib/types/etiqueta-guia";

function etiqueta(ordenId = "ord-1"): EtiquetaGuiaDTO {
  return {
    ordenId,
    numGuia: 1042,
    numRemision: "REM-1",
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
    qrValue: "1042",
    barcodeValue: "1042",
  };
}

beforeEach(() => {
  saveMock.mockClear();
  addPageMock.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,AAAA",
  );
});

describe("descargarEtiquetasPdf (R19)", () => {
  it("guarda con el nombre que incluye el identificador del tamaño elegido", () => {
    for (const hoja of HOJAS_ETIQUETA) {
      saveMock.mockClear();
      descargarEtiquetasPdf([etiqueta()], new Map(), hoja);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledWith(`etiquetas-guia-${hoja.id}.pdf`);
    }
  });

  it("dos descargas con tamaños distintos NO producen el mismo nombre", () => {
    descargarEtiquetasPdf([etiqueta()], new Map(), getHojaEtiqueta("a4"));
    descargarEtiquetasPdf([etiqueta()], new Map(), getHojaEtiqueta("carta"));
    const nombres = saveMock.mock.calls.map((c) => c[0]);
    expect(nombres).toEqual(["etiquetas-guia-a4.pdf", "etiquetas-guia-carta.pdf"]);
    expect(new Set(nombres).size).toBe(2);
  });

  it("R12: añade una pagina por etiqueta adicional, con el formato de la hoja", () => {
    const hoja = getHojaEtiqueta("a4");
    descargarEtiquetasPdf(
      [etiqueta("a"), etiqueta("b"), etiqueta("c")],
      new Map(),
      hoja,
    );
    expect(addPageMock).toHaveBeenCalledTimes(2); // la primera pagina ya existe
    for (const call of addPageMock.mock.calls) {
      expect(call[0]).toEqual([hoja.anchoMm, hoja.altoMm]);
    }
  });
});
