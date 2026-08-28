import { describe, it, expect } from "vitest";
import {
  contentDisposition,
  contentTypeSeguro,
  esMimeIncrustable,
  sanearNombreArchivo,
} from "@/lib/utils/chat-media-headers";

// Feature 308 — F4.T (R25). Reglas de cabecera del proxy de media. Son decisiones de SEGURIDAD
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
