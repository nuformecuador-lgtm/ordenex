// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Feature 282 (T28, R31/R32/R33) — LA PARIDAD TIPOGRAFICA, COMPROBADA.
//
// Lo que aqui se afirma y por que ningun otro test lo veria:
//
//  · **R31** — la pantalla y el PDF usan EL MISMO artefacto. No «una fuente
//    parecida»: los mismos bytes. Si alguien metiera un `.woff2` en `public/`
//    con una `@font-face` de CSS, la vista previa se veria igual de bien y la
//    paridad seria una coincidencia que caducaria en la siguiente actualizacion
//    de una de las dos copias. Aqui se compara la fuente de los bytes.
//  · **R32** — la familia aplicada al importe en pantalla es EXACTAMENTE la que
//    el PDF declara en su `/BaseFont`. Es el mismo identificador comprobado en
//    los dos lados, no dos aserciones independientes que podrian derivar.
//  · **R33** — si la plataforma no puede registrar la fuente, la vista previa se
//    pinta igual (con la del sistema) en vez de quedarse en blanco.
//
// jsdom NO trae `FontFace` ni `document.fonts` (comprobado en esta sesion con
// jsdom 29.1.1: las dos son `undefined`), y tampoco rasteriza. Por eso se instala
// un doble que GUARDA lo que se le da: lo que se verifica no es que la letra se
// vea, sino QUE BYTES y QUE NOMBRE de familia se registran. Los pixeles los mira
// T15, a ojo, una vez.

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAklEQVR4AewaftIAAAFbSURBVMXBUYrbQBQAwW4x979yJwP7QAivIzsfqhKImyo2lYp3VO44eNjiR8U7KqNCZatQ2SrOKt5ROXjY4kLlrOIulYorlbOKsfiCSsWmMio+dfCwxZdURsWmUvGJxUXFp1S2ilcqfnPwsMUPlU9UbCoVm0rFUPmXVfENla1C5arijoOHLZWt4kqlYlM5q7iqUHmnYqgIxC8q7lAZFUNlq1DZKlTGwcME4q+Kd1ReqVDZKobKbyqGQFxUvKKyVahsFWcqo2JTqdhUKsbBwwTipEJlVGwqZxVXKmcVVyqjYlVcVVxVDJX/UTEOHrZU7qq4q+KVCpWtYvGj4h2VUaGyVaiMiqGyVahsFWcHD1tcqJxVXKlUbCqjYqgMlaEyVA6+UDEqhsqoGBWj4uzgYYsvqWwVo2KoDJWhUjEWFxWfUKkYKqNiU6nYVM4OHrb4oXKXSsWmMlReqXhF5Q9xIO89ads5LwAAAABJRU5ErkJggg==";

type BarcodeOpts = { width: number; height: number; fontSize: number };
const jsBarcodeMock =
  vi.fn<(canvas: HTMLCanvasElement, value: string, opts: BarcodeOpts) => void>();
vi.mock("jsbarcode", () => ({
  default: (...args: Parameters<typeof jsBarcodeMock>) => jsBarcodeMock(...args),
}));

// Stubs de QR/barcode de la vista previa: evitan canvas real y el warning de ref.
vi.mock("qrcode.react", () => ({
  QRCodeCanvas: () => <canvas data-testid="qr-stub" />,
}));
vi.mock("react-barcode", () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="barcode-stub" data-value={value} />
  ),
}));

import { EtiquetaGuia } from "@/app/(app)/ordenes/_components/EtiquetaGuia";
import {
  asegurarFuenteEnPantalla,
  cargarFuenteEtiqueta,
} from "@/app/(app)/ordenes/_components/etiquetas-fuente-carga";
import { buildEtiquetasPdf } from "@/app/(app)/ordenes/_components/etiquetas-pdf";
import { getHojaEtiqueta } from "@/lib/config/etiquetas-hoja";
import { formatMonto } from "@/lib/config/moneda";
import { fuenteEtiqueta } from "@/lib/pdf/etiquetas-fuente";

import { CASO_EVIDENCIA } from "../fixtures/etiquetas-282";
import {
  fuentesDePagina,
  textoLegible,
  textosDePagina,
} from "../unit/pdf/pdf-inspector";

// --------------------------------------------------------------------------
// El doble de la API de fuentes del navegador
// --------------------------------------------------------------------------

/** Copia defensiva: lo que se guarda es lo que se PASO, no una referencia viva. */
function aBytes(origen: BufferSource | string): Uint8Array {
  if (typeof origen === "string") return new TextEncoder().encode(origen);
  const vista =
    origen instanceof ArrayBuffer
      ? new Uint8Array(origen)
      : new Uint8Array(origen.buffer, origen.byteOffset, origen.byteLength);
  return Uint8Array.from(vista);
}

class FontFaceDoble {
  family: string;
  bytes: Uint8Array;
  cargada = false;
  constructor(family: string, source: BufferSource | string) {
    this.family = family;
    this.bytes = aBytes(source);
  }
  async load(): Promise<this> {
    this.cargada = true;
    return this;
  }
}

const anadidas: FontFaceDoble[] = [];
const addSpy = vi.fn((cara: FontFaceDoble) => {
  anadidas.push(cara);
});

function instalarApiDeFuentes(): void {
  const conjunto = {
    add: addSpy,
    [Symbol.iterator]: () => anadidas[Symbol.iterator](),
  };
  Object.defineProperty(document, "fonts", {
    value: conjunto,
    configurable: true,
    writable: true,
  });
  (globalThis as unknown as { FontFace: unknown }).FontFace = FontFaceDoble;
}

function desinstalarApiDeFuentes(): void {
  Reflect.deleteProperty(document, "fonts");
  Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, "FontFace");
}

/** Primera familia declarada en un `font-family`, sin comillas ni espacios. */
function primeraFamilia(el: HTMLElement): string {
  return (el.style.fontFamily.split(",")[0] ?? "").replace(/["']/g, "").trim();
}

beforeEach(() => {
  anadidas.length = 0;
  addSpy.mockClear();
  jsBarcodeMock.mockClear();
  instalarApiDeFuentes();
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    `data:image/png;base64,${PNG_1X1_BASE64}`,
  );
});

afterEach(() => {
  cleanup();
  desinstalarApiDeFuentes();
  vi.restoreAllMocks();
});

// --------------------------------------------------------------------------
// R31 — un solo artefacto, dos consumidores
// --------------------------------------------------------------------------

describe("R31 — la pantalla y el PDF salen del MISMO artefacto", () => {
  it("`cargarFuenteEtiqueta` devuelve el objeto del modulo compartido, no una copia", async () => {
    const fuente = await cargarFuenteEtiqueta();
    // Identidad de referencia: si alguien clonara el artefacto para la pantalla
    // (o metiera un segundo archivo), esto deja de ser el mismo objeto.
    expect(fuente).toBe(fuenteEtiqueta);
    expect(fuente.base64).toBe(fuenteEtiqueta.base64);
    expect(fuente.nombre).toBe(fuenteEtiqueta.nombre);
  });

  it("la `FontFace` se construye con los MISMOS bytes que se embeben en el PDF", async () => {
    const fuente = await cargarFuenteEtiqueta();
    const familia = await asegurarFuenteEnPantalla(fuente);

    expect(familia).toBe(fuenteEtiqueta.nombre);
    expect(addSpy).toHaveBeenCalledTimes(1);

    const cara = anadidas[0];
    expect(cara.family).toBe(fuenteEtiqueta.nombre);
    expect(cara.cargada, "se registra despues de cargar, no antes").toBe(true);

    // Byte a byte contra el base64 del artefacto. No «la misma longitud»: la
    // misma cadena de bytes. Un TTF distinto del mismo tamaño pasaria un
    // `toHaveLength` y aqui no pasa.
    const esperados = new Uint8Array(Buffer.from(fuenteEtiqueta.base64, "base64"));
    expect(cara.bytes.byteLength).toBe(esperados.byteLength);
    expect(Buffer.compare(Buffer.from(cara.bytes), Buffer.from(esperados))).toBe(0);
    // Y son un TrueType de verdad, no cualquier cosa: `sfntVersion` 0x00010000.
    expect([...cara.bytes.slice(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it("es idempotente: abrir el modal dos veces no registra la familia dos veces", async () => {
    const fuente = await cargarFuenteEtiqueta();
    const primera = await asegurarFuenteEnPantalla(fuente);
    const segunda = await asegurarFuenteEnPantalla(fuente);

    expect(primera).toBe(segunda);
    expect(addSpy, "la segunda llamada no debe volver a añadir").toHaveBeenCalledTimes(1);
  });

  it("R33 — sin la API de fuentes no registra nada y NO lanza: la vista previa sigue viva", async () => {
    desinstalarApiDeFuentes();
    const fuente = await cargarFuenteEtiqueta();

    await expect(asegurarFuenteEnPantalla(fuente)).resolves.toBeNull();
    expect(addSpy).not.toHaveBeenCalled();

    // Control positivo de la aserción de arriba: con la API instalada SI
    // registra. Sin esto, un `asegurarFuenteEnPantalla` que no hiciera nunca
    // nada pasaria este test en verde.
    instalarApiDeFuentes();
    await expect(asegurarFuenteEnPantalla(fuente)).resolves.toBe(
      fuenteEtiqueta.nombre,
    );
    expect(addSpy).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------
// R32 — la familia, aplicada donde el PDF la usa
// --------------------------------------------------------------------------

describe("R32 — el importe de la vista previa lleva la familia registrada", () => {
  it("la primera familia del importe es la que devolvio el registro", async () => {
    const familia = await asegurarFuenteEnPantalla(await cargarFuenteEtiqueta());
    expect(familia).not.toBeNull();

    render(<EtiquetaGuia etiqueta={CASO_EVIDENCIA.dto} familiaMonto={familia} />);

    const monto = screen.getByTestId("etiqueta-monto");
    // Se compara contra `familia` —lo REALMENTE registrado— y no contra un
    // literal ni contra `fuenteEtiqueta.nombre`: asi el test sigue siendo un
    // cruce y no una tautologia con la constante del artefacto.
    expect(primeraFamilia(monto)).toBe(familia);
    // Y con respaldo detras, que es lo que se ve mientras la fuente no llega.
    expect(monto.style.fontFamily).toContain("system-ui");
    // Control positivo del contenido: la familia se aplica al importe, no a un
    // hueco vacio.
    expect(monto).toHaveTextContent(formatMonto(CASO_EVIDENCIA.dto.montoCobrar));
  });

  it("solo el importe cambia de tipografia: los demas valores no la llevan", async () => {
    const familia = await asegurarFuenteEnPantalla(await cargarFuenteEtiqueta());

    render(<EtiquetaGuia etiqueta={CASO_EVIDENCIA.dto} familiaMonto={familia} />);

    const monto = screen.getByTestId("etiqueta-monto");
    const destinatario = screen.getByText(CASO_EVIDENCIA.dto.destinatario);
    expect(primeraFamilia(monto)).toBe(familia);
    // El de al lado NO la lleva (con el de arriba como control positivo: si el
    // componente dejara de aplicar la familia, el primero fallaria).
    expect(destinatario.style.fontFamily).toBe("");
  });

  it("R33 — sin familia el importe se pinta igual, con la del sistema", () => {
    render(<EtiquetaGuia etiqueta={CASO_EVIDENCIA.dto} />);

    const monto = screen.getByTestId("etiqueta-monto");
    expect(monto.style.fontFamily).toBe("");
    // Control positivo: la ausencia de `font-family` no puede confundirse con
    // «el importe no se pinto». El importe ESTA, con su simbolo.
    expect(monto).toHaveTextContent(formatMonto(CASO_EVIDENCIA.dto.montoCobrar));
    expect(monto.textContent).toContain("₡");
  });
});

// --------------------------------------------------------------------------
// R32 — el cruce: el mismo identificador en pantalla y dentro del PDF
// --------------------------------------------------------------------------

describe("R32 — la familia de pantalla es la del /BaseFont con el que el PDF dibuja el monto", () => {
  it("el nombre registrado en `document.fonts` y el `/BaseFont` del importe coinciden", async () => {
    // (1) Lado pantalla: lo que REALMENTE se registro en el navegador.
    await asegurarFuenteEnPantalla(await cargarFuenteEtiqueta());
    const familiaEnPantalla = anadidas[0]?.family;
    expect(familiaEnPantalla, "no se registro ninguna familia").toBeTruthy();

    // (2) Lado PDF: el recurso de fuente activo en la fila del monto, extraido
    // de los BYTES del documento que produce el generador de verdad.
    const doc = buildEtiquetasPdf(
      [CASO_EVIDENCIA.dto],
      new Map(),
      getHojaEtiqueta("100x100"),
      fuenteEtiqueta,
    );
    const u8 = new Uint8Array(Buffer.from(doc.output("arraybuffer")));
    const fuentes = fuentesDePagina(u8);
    const monto = textosDePagina(u8).find(
      (t) => textoLegible(t, fuentes.get(t.fuenteRes)) === formatMonto(18000),
    );
    expect(monto, "no se encontro la fila del monto en el content stream").toBeDefined();
    const recurso = fuentes.get(monto!.fuenteRes)!;

    // (3) El cruce. Un solo identificador comprobado en los dos lados: si
    // alguien registrase en pantalla una familia con otro nombre, aqui sale
    // rojo aunque las dos mitades siguieran «funcionando» por separado.
    expect(recurso.baseFont).toBe(familiaEnPantalla);
    // Control positivo de que el recurso hallado es el embebido y no una de las
    // 14 estandar (que no tendrian el simbolo).
    expect(recurso.subtype).toBe("Type0");
    expect(recurso.fontFile2).toBeTruthy();
  });
});
