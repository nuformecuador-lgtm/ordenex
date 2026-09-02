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

import { CUERPOS_BASE } from "@/lib/pdf/etiquetas-maqueta";

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

// ---------------------------------------------------------------------------
// Feature 350 (T17, R23) — LA VISTA PREVIA NO PUEDE MENTIR SOBRE EL PAPEL.
//
// Se cruzan las DOS cosas que R23 nombra —el ORDEN de los datos y la JERARQUIA
// de tamaños— entre la pantalla y el PDF que produce el generador de verdad. No
// son dos aserciones independientes sobre dos maquetas: es la misma secuencia
// leida de los dos sitios y comparada.
//
// Sobre la jerarquia: jsdom NO computa estilos (no hay CSS de Tailwind cargado),
// asi que el tamaño de pantalla se lee de la CLASE de utilidad y se traduce con
// la escala documentada de Tailwind. Es indirecto y se dice: lo que se afirma es
// el ORDEN relativo de los seis datos, que es lo que R23 exige, no un pixel.
// ---------------------------------------------------------------------------

/** La escala de Tailwind que usa la etiqueta, en px. */
const TAMANO_DE_CLASE: Record<string, number> = {
  "text-xl": 20,
  "text-lg": 18,
  "text-base": 16,
  "text-sm": 14,
  "text-xs": 12,
  "text-[11px]": 11,
  "text-[10px]": 10,
};

/** Tamaño heredado de un elemento: la primera clase `text-*` subiendo por el DOM. */
function tamanoDe(el: HTMLElement | null): number {
  let actual: HTMLElement | null = el;
  while (actual) {
    for (const clase of Array.from(actual.classList)) {
      if (clase in TAMANO_DE_CLASE) return TAMANO_DE_CLASE[clase];
    }
    actual = actual.parentElement;
  }
  throw new Error("ningun ancestro declara un tamaño de texto");
}

describe("R23 — la pantalla y el papel dicen lo mismo, en el mismo orden y con la misma jerarquia", () => {
  const dto = CASO_EVIDENCIA.dto;
  const esperado = CASO_EVIDENCIA.esperado;

  /** Los datos, con el valor LITERAL del fixture (nunca `geografiaLegible`). */
  const DATOS: Array<{ id: string; valor: string }> = [
    { id: "fechaCreacion", valor: esperado.fechaCreacion },
    { id: "numGuia", valor: esperado.numGuia },
    { id: "numRemision", valor: esperado.numRemision },
    { id: "destinatario", valor: esperado.destinatario },
    { id: "telefonoDest", valor: esperado.telefonoDest },
    { id: "direccion", valor: esperado.direccion },
    { id: "ubicacion", valor: esperado.ubicacion },
    { id: "montoCobrar", valor: esperado.montoCobrar },
    { id: "producto", valor: esperado.producto },
    { id: "tiendaNombre", valor: esperado.tiendaNombre },
  ];

  function ordenEnPantalla(container: HTMLElement): string[] {
    const texto = container.textContent ?? "";
    return [...DATOS]
      .map((d) => {
        const posicion = texto.indexOf(d.valor);
        expect(posicion, `«${d.id}» no aparece en la vista previa`).toBeGreaterThanOrEqual(0);
        return { id: d.id, posicion };
      })
      .sort((a, b) => a.posicion - b.posicion)
      .map((d) => d.id);
  }

  function ordenEnPapel(): string[] {
    const doc = buildEtiquetasPdf(
      [dto],
      new Map([[dto.ordenId, document.createElement("canvas")]]),
      getHojaEtiqueta("100x100"),
      fuenteEtiqueta,
    );
    const u8 = new Uint8Array(Buffer.from(doc.output("arraybuffer")));
    const fuentes = fuentesDePagina(u8);
    const textos = textosDePagina(u8).map((t) => ({
      texto: textoLegible(t, fuentes.get(t.fuenteRes)),
      // La `y` del PDF crece hacia ARRIBA: se invierte para leer de arriba abajo.
      y: -t.y,
      x: t.x,
    }));
    return [...DATOS]
      .map((d) => {
        // La primera linea del dato: el primer texto dibujado que es prefijo del
        // valor esperado (los datos largos se parten en varias lineas).
        const primera = textos.find(
          (t) => t.texto.length > 0 && d.valor.startsWith(t.texto),
        );
        expect(primera, `«${d.id}» no aparece en el PDF`).toBeDefined();
        return { id: d.id, y: primera!.y, x: primera!.x };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((d) => d.id);
  }

  it("el ORDEN de los diez datos es el mismo en la pantalla y en el PDF", () => {
    const { container } = render(<EtiquetaGuia etiqueta={dto} />);
    const pantalla = ordenEnPantalla(container);
    const papel = ordenEnPapel();

    expect(pantalla).toEqual(papel);
    // Y ese orden es el de R13, escrito para que se lea sin ejecutar nada.
    // Feature 353 — el orden cambia por el diseño aprobado: la fecha baja a la
    // fila que va DEBAJO del numero, junto a la remision, y arriba solo queda el
    // rotulo de marca. Lo que la asercion sigue garantizando es lo de antes:
    // que pantalla y papel digan lo mismo en el mismo orden.
    expect(papel).toEqual([
      "numGuia",
      "numRemision",
      "fechaCreacion",
      "destinatario",
      "telefonoDest",
      "direccion",
      "ubicacion",
      "montoCobrar",
      "producto",
      "tiendaNombre",
    ]);
  });

  it("la JERARQUIA de tamaños es la misma: el ranking de los seis datos coincide", () => {
    render(<EtiquetaGuia etiqueta={dto} />);

    // Pantalla: el tamaño heredado de cada valor.
    const enPantalla = [
      { id: "montoCobrar", px: tamanoDe(screen.getByTestId("etiqueta-monto")) },
      { id: "destinatario", px: tamanoDe(screen.getByText(esperado.destinatario)) },
      { id: "telefonoDest", px: tamanoDe(screen.getByText(esperado.telefonoDest)) },
      { id: "direccion", px: tamanoDe(screen.getByText(esperado.direccion)) },
      { id: "ubicacion", px: tamanoDe(screen.getByText(esperado.ubicacion)) },
      { id: "producto", px: tamanoDe(screen.getByText(esperado.producto)) },
    ];

    // Papel: el cuerpo BASE de la maqueta compartida, que es la fuente de verdad
    // de la jerarquia (el ajuste puede bajarlos todos, pero conserva su orden).
    const enPapel = [
      { id: "montoCobrar", pt: CUERPOS_BASE.importe },
      { id: "destinatario", pt: CUERPOS_BASE.destinatario },
      { id: "telefonoDest", pt: CUERPOS_BASE.telefono },
      { id: "direccion", pt: CUERPOS_BASE.direccion },
      { id: "ubicacion", pt: CUERPOS_BASE.ubicacion },
      { id: "producto", pt: CUERPOS_BASE.detalle },
    ];

    const rankingPantalla = [...enPantalla].sort((a, b) => b.px - a.px).map((d) => d.id);
    const rankingPapel = [...enPapel].sort((a, b) => b.pt - a.pt).map((d) => d.id);
    expect(rankingPantalla).toEqual(rankingPapel);

    // Control positivo: los tamaños de pantalla no son todos iguales (si lo
    // fueran, dos rankings arbitrarios podrian coincidir por accidente).
    expect(new Set(enPantalla.map((d) => d.px)).size).toBe(enPantalla.length);
  });

  it("el importe va DESTACADO en su recuadro, no como una fila mas de la lista", () => {
    // Es la mitad de R23 que no se ve en el orden: en el papel el importe esta
    // dentro de un rectangulo dibujado y es el cuerpo mayor. Si en pantalla
    // fuera una fila mas, la previa mentiria sobre lo que va a imprimirse.
    render(<EtiquetaGuia etiqueta={dto} />);
    const recuadro = screen.getByTestId("etiqueta-importe");
    expect(recuadro.className).toMatch(/border/);
    expect(recuadro).toContainElement(screen.getByTestId("etiqueta-monto"));
    const monto = tamanoDe(screen.getByTestId("etiqueta-monto"));
    expect(monto).toBeGreaterThan(tamanoDe(screen.getByText(esperado.destinatario)));
  });

  it("el bloque de destino NO tiene columna de rotulos (D2/R16)", () => {
    // La rejilla `dt`/`dd` era la version en pantalla de la columna que se comia
    // el 24 % del ancho en el papel. Si volviera, la previa dejaria de parecerse.
    const { container } = render(<EtiquetaGuia etiqueta={dto} />);
    const destino = screen.getByTestId("etiqueta-destino");
    expect(destino.querySelectorAll("dt")).toHaveLength(0);
    expect(container.querySelectorAll("dl")).toHaveLength(0);
    // Control positivo: el bloque SI tiene los cuatro valores del destino.
    expect(destino).toHaveTextContent(esperado.destinatario);
    expect(destino).toHaveTextContent(esperado.telefonoDest);
    expect(destino).toHaveTextContent(esperado.ubicacion);
  });
});
