import { describe, expect, it } from "vitest";

import {
  aislado,
  fraseCaracterNoImprimible,
  mensajeCargaCaracterNoImprimible,
  mensajeCorreccionCaracterNoImprimible,
  mensajeCorreccionSugerencia,
  seVenIgual,
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
    expect(
      mensajeCorreccionSugerencia(
        "destinatario",
        "\u{1D560}",
        0x1d560,
        "orfirio",
        "\u{1D560}rfirio",
      ),
    ).toBe(
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
    expect(
      mensajeCorreccionSugerencia("producto", "\u{1D560}", 0x1d560, "o", "\u{1D560}"),
    ).not.toContain("Reintentar");
  });
});

/**
 * ⭑ REVISION DEL 2026-09-07, menor 1 — «ESCRIBELO ASI» ENSEÑANDO LO MISMO QUE HAY EN PANTALLA.
 *
 * Con una `ñ` DESCOMPUESTA (`"n"` + U+0303, lo que produce macOS al copiar) el texto reparado es
 * `"Nuñez"`, que se pinta EXACTAMENTE igual que el `"Nuñez"` que la persona acaba de teclear. El
 * mensaje decia «Escribelo asi: «Nuñez»»: imposible de obedecer, y justo en la superficie donde SI
 * hay alguien mirando la pantalla.
 *
 * Ni una cadena de este bloque se escribe con los caracteres de verdad: van por CODE POINT
 * (`String.fromCodePoint`). Las dos del caso se pintan igual en este archivo, en tu editor y en
 * el diff, asi que escritas tal cual este test seria indistinguible a la vista del bug que
 * persigue — y la marca combinante suelta es ademas invisible, o sea de las que alguien borra
 * sin darse cuenta (misma razon por la que los aislantes bidi no se escriben crudos).
 */
describe("383 + revision — la sugerencia que no se distingue de lo tecleado", () => {
  /** `N u n` + U+0303 COMBINING TILDE + `e z`: seis code points. */
  const NN_DESCOMPUESTA = String.fromCodePoint(0x004e, 0x0075, 0x006e, 0x0303, 0x0065, 0x007a);
  /** `N u` + U+00F1 LATIN SMALL LETTER N WITH TILDE + `e z`: cinco. */
  const NN_COMPUESTA = String.fromCodePoint(0x004e, 0x0075, 0x00f1, 0x0065, 0x007a);
  /** La marca combinante suelta, que es lo que el veredicto reporta como culpable. */
  const TILDE = String.fromCodePoint(0x0303);

  it("son dos cadenas DISTINTAS que se pintan igual (la premisa del caso)", () => {
    // Si esto dejara de ser cierto, el resto de este describe no tendria sentido.
    expect(NN_DESCOMPUESTA).not.toBe(NN_COMPUESTA);
    expect(NN_DESCOMPUESTA).toHaveLength(6);
    expect(NN_COMPUESTA).toHaveLength(5);
    expect(seVenIgual(NN_DESCOMPUESTA, NN_COMPUESTA)).toBe(true);
  });

  it("`seVenIgual` dice que NO en cuanto la diferencia se ve", () => {
    expect(seVenIgual("\u{1D560}rfirio", "orfirio")).toBe(false);
    expect(seVenIgual(NN_COMPUESTA, "Nunez")).toBe(false);
    expect(seVenIgual("", "")).toBe(true);
  });

  it("NO repite el texto: dice que la letra va en dos piezas y que hay que teclearla otra vez", () => {
    const mensaje = mensajeCorreccionSugerencia(
      "destinatario",
      TILDE,
      0x0303,
      NN_COMPUESTA,
      NN_DESCOMPUESTA,
    );

    expect(mensaje).toBe(
      `«destinatario» lleva un carácter que la etiqueta no puede imprimir: «${String.fromCodePoint(0x2068)}${TILDE}${String.fromCodePoint(0x2069)}» (U+0303). Aquí no hay nada que se vea mal: esa letra está escrita en dos piezas —la letra por un lado y su acento por otro—, y así no se puede imprimir. Bórrala y vuelve a teclearla; copiar y pegar el mismo texto la trae otra vez partida.`,
    );
    // Lo que NO puede volver a hacer: mandar escribir algo que ya esta escrito igual.
    expect(mensaje).not.toContain("Escríbelo así");
    expect(mensaje).not.toContain(NN_COMPUESTA);
    // Y sigue nombrando el code point, que es lo UNICO que distingue a los dos textos.
    expect(mensaje).toContain("U+0303");
  });

  it("con una ñ descompuesta Y un doble-trazo SI usa la sugerencia: ahi si se distingue", () => {
    // El caso que mata el atajo de mirar solo el caracter culpable: el culpable sigue siendo la
    // marca combinante —es el primero fuera de cobertura— pero el texto reparado se ve distinto
    // por el `𝕠` de mas atras, asi que «Escribelo asi» vuelve a servir. Un predicado por caracter
    // se equivocaria aqui; el de la cadena entera, no.
    const mensaje = mensajeCorreccionSugerencia(
      "destinatario",
      TILDE,
      0x0303,
      `${NN_COMPUESTA} orfirio`,
      `${NN_DESCOMPUESTA} \u{1D560}rfirio`,
    );

    expect(mensaje).toContain(`Escríbelo así: «${NN_COMPUESTA} orfirio».`);
  });
});

