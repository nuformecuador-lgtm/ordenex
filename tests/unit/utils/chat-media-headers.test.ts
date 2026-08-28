import { describe, it, expect } from "vitest";
import {
  contentDisposition,
  contentTypeSeguro,
  esMimeIncrustable,
  nombreAsciiSeguro,
  sanearNombreArchivo,
} from "@/lib/utils/chat-media-headers";

// Feature 311 — F4.T (R25). Reglas de cabecera del proxy de media. Son decisiones de SEGURIDAD
// (que se puede incrustar y con que nombre se descarga), por eso son helpers puros con test
// propio y no logica enterrada en el route handler.

describe("esMimeIncrustable — lista blanca (R25)", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "image/gif"])("%s es incrustable", (mime) => {
    expect(esMimeIncrustable(mime)).toBe(true);
  });

  it("las familias audio/* y video/* completas son incrustables", () => {
    expect(esMimeIncrustable("audio/ogg")).toBe(true);
    expect(esMimeIncrustable("video/mp4")).toBe(true);
    // Con parametros: Meta manda `audio/ogg; codecs=opus` en las notas de voz.
    expect(esMimeIncrustable("audio/ogg; codecs=opus")).toBe(true);
  });

  it("image/svg+xml NO es incrustable: un SVG es scriptable (XSS almacenado)", () => {
    expect(esMimeIncrustable("image/svg+xml")).toBe(false);
    expect(contentTypeSeguro("image/svg+xml")).toBe("application/octet-stream");
  });

  it("application/pdf y un mime ausente tampoco se incrustan", () => {
    expect(esMimeIncrustable("application/pdf")).toBe(false);
    expect(esMimeIncrustable(null)).toBe(false);
    expect(contentTypeSeguro(null)).toBe("application/octet-stream");
  });

  it("un mime incrustable se emite normalizado, sin parametros", () => {
    expect(contentTypeSeguro("IMAGE/PNG")).toBe("image/png");
    expect(contentTypeSeguro("audio/ogg; codecs=opus")).toBe("audio/ogg");
  });
});

describe("sanearNombreArchivo (R25)", () => {
  it('quita comillas, CR/LF y separadores de ruta de "a\\"b\\r\\nc/../d.pdf"', () => {
    const saneado = sanearNombreArchivo('a"b\r\nc/../d.pdf');
    expect(saneado).not.toContain('"');
    expect(saneado).not.toContain("\r");
    expect(saneado).not.toContain("\n");
    expect(saneado).not.toContain("/");
    expect(saneado).not.toContain("\\");
    expect(saneado).not.toContain("..");
  });

  it("un nombre ausente o que queda vacio cae al generico", () => {
    expect(sanearNombreArchivo(null)).toBe("adjunto");
    expect(sanearNombreArchivo('"""')).toBe("adjunto");
    expect(sanearNombreArchivo("   ")).toBe("adjunto");
  });

  it("recorta a 100 caracteres", () => {
    expect(sanearNombreArchivo("a".repeat(500))).toHaveLength(100);
  });

  it("conserva un nombre normal tal cual", () => {
    expect(sanearNombreArchivo("factura-agosto.pdf")).toBe("factura-agosto.pdf");
  });
});

describe("contentDisposition (R25)", () => {
  it("inline solo para la lista segura y sin ?descarga=1", () => {
    expect(contentDisposition("image/png", null, false)).toBe("inline");
    expect(contentDisposition("audio/ogg", null, false)).toBe("inline");
  });

  it("?descarga=1 fuerza attachment incluso para una imagen", () => {
    expect(contentDisposition("image/png", "foto.png", true)).toBe(
      'attachment; filename="foto.png"',
    );
  });

  it("lo que no es incrustable siempre sale como attachment con nombre saneado", () => {
    expect(contentDisposition("application/pdf", 'fac"tura.pdf', false)).toBe(
      'attachment; filename="factura.pdf"',
    );
    expect(contentDisposition("image/svg+xml", null, false)).toBe(
      'attachment; filename="adjunto"',
    );
  });
});

// --------------------------------------------------------------------------------------------
// Nombres NO ASCII (R25/R29). Una cabecera HTTP es una ByteString: interpolar un nombre con CJK
// o emoji tal cual lanza `TypeError: Cannot convert argument to a ByteString ...` y el proxy
// responde 500 en vez del archivo. Los acentos del español caen dentro de Latin-1, por eso el
// agujero no se veia. La salida correcta es RFC 5987/6266.
// --------------------------------------------------------------------------------------------

/** Lo que el navegador acepta como valor de cabecera: un ByteString (todo <= U+00FF). */
function esByteString(valor: string): boolean {
  return [...valor].every((c) => (c.codePointAt(0) as number) <= 0xff);
}

describe("nombres no ASCII en Content-Disposition (R25/R29)", () => {
  const CJK_EMOJI = "报告 final 🎉.pdf";

  it("un nombre con CJK y emoji produce una cabecera que el navegador puede emitir", () => {
    const disposicion = contentDisposition("application/pdf", CJK_EMOJI, true);
    // El caso que reventaba: `new Headers({...})` rechaza cualquier char > 255.
    expect(esByteString(disposicion)).toBe(true);
    expect(() => new Headers({ "Content-Disposition": disposicion })).not.toThrow();
  });

  it("conserva el nombre real en filename* y deja un fallback ASCII en filename", () => {
    const disposicion = contentDisposition("application/pdf", CJK_EMOJI, true);
    expect(disposicion).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
    // El nombre real viaja entero: decodificarlo devuelve exactamente lo que mando el cliente.
    const codificado = disposicion.split("filename*=UTF-8''")[1] as string;
    expect(decodeURIComponent(codificado)).toBe(CJK_EMOJI);
    // Y el fallback sigue siendo legible para un cliente antiguo.
    expect(disposicion).toContain('filename="_ final _.pdf"');
  });

  it("el filename* percent-encoded NO puede reintroducir un salto de cabecera", () => {
    const disposicion = contentDisposition("application/pdf", '报告\r\nX-Fake: 1"\\/../.pdf', true);
    expect(disposicion).not.toContain("\r");
    expect(disposicion).not.toContain("\n");
    // Ni el CR/LF codificado: el saneado los quita ANTES de codificar, no los transporta.
    expect(disposicion).not.toContain("%0D");
    expect(disposicion).not.toContain("%0A");
    expect(esByteString(disposicion)).toBe(true);
  });

  it("un emoji partido por el recorte de 100 chars no revienta el encoder", () => {
    // El char 100 cae en mitad del par surrogate: `encodeURIComponent` lanzaria `URIError`.
    const nombre = `${"a".repeat(99)}🎉.pdf`;
    expect(() => contentDisposition("application/pdf", nombre, true)).not.toThrow();
    expect(sanearNombreArchivo(nombre)).not.toMatch(/[\uD800-\uDFFF]/);
  });

  it("los acentos del español se conservan y ademas se emite el filename* (Latin-1 no basta)", () => {
    const disposicion = contentDisposition("application/pdf", "informe-año.pdf", true);
    expect(disposicion).toContain('filename="informe-a_o.pdf"');
    expect(disposicion).toContain("filename*=UTF-8''informe-a%C3%B1o.pdf");
  });

  it("un nombre ASCII puro NO arrastra filename*: la cabecera corta de siempre", () => {
    expect(contentDisposition("application/pdf", "factura-agosto.pdf", true)).toBe(
      'attachment; filename="factura-agosto.pdf"',
    );
  });
});

describe("nombreAsciiSeguro — el fallback tambien esta saneado (R25)", () => {
  it("no deja pasar comillas, barras, CR/LF ni `..`", () => {
    const ascii = nombreAsciiSeguro('报告"a\r\nb/../c.pdf');
    expect(ascii).not.toContain('"');
    expect(ascii).not.toContain("\r");
    expect(ascii).not.toContain("\n");
    expect(ascii).not.toContain("/");
    expect(ascii).not.toContain("\\");
    expect(ascii).not.toContain("..");
    expect(esByteString(ascii)).toBe(true);
  });

  it("un nombre integramente no ASCII cae al generico en vez de a un `_` mudo", () => {
    expect(nombreAsciiSeguro("报告")).toBe("adjunto");
    expect(nombreAsciiSeguro("🎉")).toBe("adjunto");
    expect(nombreAsciiSeguro(null)).toBe("adjunto");
  });

  it("es idempotente sobre un nombre que ya era ASCII", () => {
    expect(nombreAsciiSeguro("factura-agosto.pdf")).toBe("factura-agosto.pdf");
  });
});
