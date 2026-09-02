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
const addFileToVFSMock = vi.fn<(archivo: string, base64: string) => void>();
const addFontMock = vi.fn<(archivo: string, nombre: string, estilo: string) => void>();
const rectMock = vi.fn<(...args: unknown[]) => void>();
const lineMock = vi.fn<(...args: unknown[]) => void>();

class JsPDFDoble {
  constructor(public opciones: unknown) {}
  save = (nombre: string) => saveMock(nombre);
  addPage = (formato: unknown) => addPageMock(formato);
  // Feature 282: el generador registra la fuente embebida una vez por documento.
  // El doble solo ANOTA la llamada; NO finge el subsetting, que se prueba con
  // jspdf de verdad en `etiquetas-pdf.test.ts` (ahi es donde se afirma que el
  // glifo del simbolo acaba con contorno en el /FontFile2).
  addFileToVFS = (archivo: string, base64: string) => addFileToVFSMock(archivo, base64);
  addFont = (archivo: string, nombre: string, estilo: string) =>
    addFontMock(archivo, nombre, estilo);
  setFont = () => undefined;
  setFontSize = () => undefined;
  text = () => undefined;
  addImage = () => undefined;
  splitTextToSize = (texto: string) => [texto];
  // Feature 350: el recuadro del importe (R15) es un `rect` con su grosor de
  // linea. El doble solo ANOTA que se dibujo; la geometria del rectangulo se
  // afirma con jspdf de verdad en `etiquetas-pdf.test.ts` (V5) y la paridad
  // entre los dos generadores en `etiquetas-dos-generadores.test.ts`.
  rect = (...args: unknown[]) => rectMock(...args);
  // Feature 353: la regla horizontal bajo la cabecera es un `line`. Mismo
  // criterio que el `rect`: el doble solo ANOTA la llamada; su geometria y su
  // grosor se afirman con jspdf de verdad en `etiquetas-diseno-353.test.ts` y la
  // paridad entre los dos generadores en `etiquetas-dos-generadores.test.ts`.
  line = (...args: unknown[]) => lineMock(...args);
  setLineWidth = () => undefined;
  // La maqueta mide textos para repartir lineas y colocar los rotulos en linea;
  // 0,5 mm por caracter basta para que el doble responda algo coherente Y para
  // que el ajuste tenga que partir de verdad las direcciones largas (con 1 mm
  // por caracter ni la mas corta cabria en 88 mm y todo acabaria en R7).
  getTextWidth = (texto: string) => texto.length * 0.5;
}

vi.mock("jspdf", () => ({
  jsPDF: class {
    constructor(opciones: unknown) {
      return new JsPDFDoble(opciones) as unknown as object;
    }
  },
}));
vi.mock("jsbarcode", () => ({ default: () => undefined }));
// El cargador diferido se dobla para poder forzar su fallo (R16) sin tocar el
// `import()` real; por defecto entrega el artefacto de verdad.
vi.mock("@/app/(app)/ordenes/_components/etiquetas-fuente-carga", async () => {
  const real = await vi.importActual<
    typeof import("@/app/(app)/ordenes/_components/etiquetas-fuente-carga")
  >("@/app/(app)/ordenes/_components/etiquetas-fuente-carga");
  return { ...real, cargarFuenteEtiqueta: vi.fn(real.cargarFuenteEtiqueta) };
});

import { descargarEtiquetasPdf } from "@/app/(app)/ordenes/_components/etiquetas-pdf";
import { cargarFuenteEtiqueta } from "@/app/(app)/ordenes/_components/etiquetas-fuente-carga";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";
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
    fechaCreacion: "2026-08-27", // feature 295
    qrValue: "1042",
    barcodeValue: "1042",
  };
}

const cargarFuenteEtiquetaMock = vi.mocked(cargarFuenteEtiqueta);

beforeEach(() => {
  saveMock.mockClear();
  addPageMock.mockClear();
  addFileToVFSMock.mockClear();
  addFontMock.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,AAAA",
  );
});

describe("descargarEtiquetasPdf (R19)", () => {
  it("guarda con el nombre que incluye el identificador del tamaño elegido", async () => {
    for (const hoja of HOJAS_ETIQUETA) {
      saveMock.mockClear();
      await descargarEtiquetasPdf([etiqueta()], new Map(), hoja);
      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledWith(`etiquetas-guia-${hoja.id}.pdf`);
    }
  });

  it("dos descargas con tamaños distintos NO producen el mismo nombre", async () => {
    await descargarEtiquetasPdf([etiqueta()], new Map(), getHojaEtiqueta("a4"));
    await descargarEtiquetasPdf([etiqueta()], new Map(), getHojaEtiqueta("carta"));
    const nombres = saveMock.mock.calls.map((c) => c[0]);
    expect(nombres).toEqual(["etiquetas-guia-a4.pdf", "etiquetas-guia-carta.pdf"]);
    expect(new Set(nombres).size).toBe(2);
  });

  it("R12: añade una pagina por etiqueta adicional, con el formato de la hoja", async () => {
    const hoja = getHojaEtiqueta("a4");
    await descargarEtiquetasPdf(
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

describe("descargarEtiquetasPdf — la fuente embebida (feature 282)", () => {
  it("registra la fuente UNA vez por documento, con el artefacto que ships", async () => {
    await descargarEtiquetasPdf(
      [etiqueta("a"), etiqueta("b"), etiqueta("c")],
      new Map(),
      getHojaEtiqueta("100x100"),
    );
    // Una sola vez para las tres etiquetas: `addFont` descodifica y parsea el
    // TTF entero, y ese coste se paga por PDF, no por pagina.
    expect(addFileToVFSMock).toHaveBeenCalledTimes(1);
    expect(addFontMock).toHaveBeenCalledTimes(1);
    expect(addFileToVFSMock).toHaveBeenCalledWith(
      fuenteEtiqueta.archivoVfs,
      fuenteEtiqueta.base64,
    );
    expect(addFontMock).toHaveBeenCalledWith(
      fuenteEtiqueta.archivoVfs,
      fuenteEtiqueta.nombre,
      fuenteEtiqueta.estilo,
    );
    // R15: NUNCA con "WinAnsiEncoding". Esa rama de jsPDF embebe la fuente
    // COMPLETA (`metadata.rawData`) en vez de un subconjunto.
    for (const llamada of addFontMock.mock.calls) {
      expect(llamada).not.toContain("WinAnsiEncoding");
    }
  });

  it("R16: si la fuente no carga, NO se descarga nada y el error sube con contexto", async () => {
    const fallo = new Error("chunk perdido");
    cargarFuenteEtiquetaMock.mockRejectedValueOnce(fallo);
    await expect(
      descargarEtiquetasPdf([etiqueta()], new Map(), getHojaEtiqueta("100x100")),
    ).rejects.toBe(fallo);
    // Lo que NO puede pasar: un PDF descargado con el importe sin simbolo.
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe("R28 — simbolo no cubierto: en el navegador tampoco se descarga nada", () => {
  it("el generador LANZA y `save` no llega a llamarse", async () => {
    // Se fuerza el simbolo a uno fuera del subconjunto (U+20B9). El modulo de
    // moneda lee el entorno al importarse, asi que hay que reimportar la cadena
    // entera; por eso el `resetModules`.
    vi.resetModules();
    process.env.MONEDA_SIMBOLO = "₹";
    try {
      const { descargarEtiquetasPdf: descargar } = await import(
        "@/app/(app)/ordenes/_components/etiquetas-pdf"
      );
      await expect(
        descargar([etiqueta()], new Map(), getHojaEtiqueta("100x100")),
      ).rejects.toThrow(/U\+20B9[\s\S]*Monto a cobrar/);
    } finally {
      delete process.env.MONEDA_SIMBOLO;
      vi.resetModules();
    }
    // Lo que NO puede pasar: un PDF descargado con el importe sin simbolo.
    expect(saveMock).not.toHaveBeenCalled();
  });
});
