import { describe, expect, it } from "vitest";

import {
  aislado,
  fraseCaracterNoImprimible,
  mensajeCargaCaracterNoImprimible,
  mensajeCorreccionCaracterNoImprimible,
  mensajeCorreccionSugerencia,
} from "@/lib/utils/mensaje-caracter-no-imprimible";

/**
 * FICHA 383 (T3.1, R14) — EL FRAGMENTO COMPARTIDO Y LOS TRES MENSAJES.
 *
 * Las dos precauciones de la 382 se afirman AQUI, sobre el fragmento, porque son las dos que un
 * refactor se lleva por delante sin romper ningun tipo: los aislantes bidi y la notacion
 * `U+XXXX`. Quitarlas no pone rojo nada mas que este archivo.
 */

/** El code point de un caracter concreto de una cadena, por posicion de code point. */
function cp(texto: string, indice: number): number {
  return [...texto][indice].codePointAt(0) as number;
}

describe("383/R14 — el caracter va AISLADO", () => {
  it("`aislado` envuelve en U+2068 y U+2069, y nada mas", () => {
    const salida = aislado("x");
    expect([...salida].map((c) => c.codePointAt(0))).toEqual([0x2068, 0x78, 0x2069]);
  });

  it("por que: un U+202E en el dato reordenaria el aviso que lo denuncia", () => {
    const salida = aislado("\u202E");
    // El override sigue estando —no se censura el dato—, pero encerrado.
    expect(cp(salida, 0)).toBe(0x2068);
    expect(cp(salida, 1)).toBe(0x202e);
    expect(cp(salida, 2)).toBe(0x2069);
  });
});

describe("383/R14 — la notacion U+XXXX no es decorativa", () => {
  it("un caracter de ANCHO CERO se lee por su numero, que es la unica lectura posible", () => {
    // U+200B ZERO WIDTH SPACE: entre las comillas no se ve nada. Sin `U+200B` escrito al lado, el
    // aviso diria «el caracter «» no se puede imprimir».
    const frase = fraseCaracterNoImprimible("\u200B", 0x200b);
    expect(frase).toContain("U+200B");
    expect([...frase].map((c) => c.codePointAt(0))).toEqual([
      0xab, 0x2068, 0x200b, 0x2069, 0xbb, 0x20, 0x28, 0x55, 0x2b, 0x32, 0x30, 0x30, 0x42, 0x29,
    ]);
  });

  it("y el caso medido en produccion sale con sus cuatro digitos y en mayusculas", () => {
    expect(fraseCaracterNoImprimible("\u{1D560}", 0x1d560)).toBe("«\u2068\u{1D560}\u2069» (U+1D560)");
  });
});

describe("383 — los tres mensajes, literales", () => {
  it("carga masiva, campo irreparable (R14): nombra el campo y NO manda reintentar", () => {
    expect(mensajeCargaCaracterNoImprimible("destinatario", "\u{1F642}", 0x1f642)).toBe(
      "El campo «destinatario» lleva un carácter que la etiqueta no puede imprimir: «\u2068\u{1F642}\u2069» (U+1F642). Reintentar no lo cambia: corrige esa celda y escríbela con letras y números normales.",
    );
  });

  it("correccion, texto irreparable (R17)", () => {
    expect(mensajeCorreccionCaracterNoImprimible("destinatario", "\u{1F642}", 0x1f642)).toBe(
      "«destinatario» lleva un carácter que la etiqueta no puede imprimir: «\u2068\u{1F642}\u2069» (U+1F642). Reintentar no lo cambia: escríbelo con letras y números normales.",
    );
  });

  it("correccion, texto reparable (R18): la sugerencia viaja DENTRO del mensaje", () => {
    expect(mensajeCorreccionSugerencia("destinatario", "\u{1D560}", 0x1d560, "orfirio")).toBe(
      "«destinatario» lleva un carácter que la etiqueta no puede imprimir: «\u2068\u{1D560}\u2069» (U+1D560). Escríbelo así: «orfirio».",
    );
  });

  it("ninguno de los tres manda REINTENTAR como salida (382): o lo niega, o no lo menciona", () => {
    const irreparables = [
      mensajeCargaCaracterNoImprimible("producto", "\u{1F642}", 0x1f642),
      mensajeCorreccionCaracterNoImprimible("producto", "\u{1F642}", 0x1f642),
    ];
    for (const mensaje of irreparables) {
      expect(mensaje).toContain("Reintentar no lo cambia");
    }
    expect(mensajeCorreccionSugerencia("producto", "\u{1D560}", 0x1d560, "o")).not.toContain(
      "Reintentar",
    );
  });
});
