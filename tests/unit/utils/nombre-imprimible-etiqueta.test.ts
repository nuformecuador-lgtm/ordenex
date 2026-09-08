import { describe, expect, it } from "vitest";

import { COBERTURA } from "@/lib/pdf/etiquetas-fuente-cobertura";
import { CAMPO_NOMBRE, rechazoDeNombreDeEtiqueta } from "@/lib/utils/nombre-imprimible-etiqueta";

// FICHA 392 — la puerta de los nombres de CATALOGO que la etiqueta imprime.
//
// ⚠️ LOS MENSAJES ESPERADOS VAN COMO LITERALES, nunca compuestos con las funciones que los
// generan: comparar un texto contra la funcion que lo produce esta siempre verde y no prueba
// nada (leccion escrita en `lib/pdf/etiquetas-dibujo.ts` y repetida en la 383). Los caracteres
// invisibles —los aislantes bidi U+2068/U+2069, la marca combinante U+0303— van ESCAPADOS: un
// literal invisible es un literal que alguien borra sin darse cuenta.

/** Los code points que la fuente cubre, uno a uno. La fuente de verdad es UNA. */
function codePointsCubiertos(): number[] {
  const out: number[] = [];
  for (const [desde, hasta] of COBERTURA) for (let cp = desde; cp <= hasta; cp++) out.push(cp);
  return out;
}

describe("392 — un nombre imprimible no produce NADA", () => {
  it("«San José» pasa: devuelve null, no un objeto vacio", () => {
    expect(rechazoDeNombreDeEtiqueta("San José")).toBeNull();
  });

  it("«Pérez Zeledón» pasa (acentos y mayusculas, que es como se guarda el catalogo)", () => {
    expect(rechazoDeNombreDeEtiqueta("Pérez Zeledón")).toBeNull();
  });

  it("la cadena vacia no es asunto de esta puerta: las cotas de longitud son del zod", () => {
    expect(rechazoDeNombreDeEtiqueta("")).toBeNull();
  });
});

describe("392/R1 — la definicion de «imprimible» es LA DE LA FUENTE, no una propia", () => {
  // Estos cinco estan EN la cobertura y FUERA de Latin-1. Una regexp escrita a mano del tipo
  // `/^[\x20-\x7E\xA0-\xFF]*$/` —la forma en que renace una segunda definicion— los rechazaria a
  // los cinco, y con ellos rechazaria nombres que hoy se imprimen perfectamente.
  it.each([
    ["Zona ₡entral", "el colon U+20A1"],
    ["Tienda €uro", "el euro U+20AC"],
    ["Tienda™", "el simbolo de marca U+2122"],
    ["Œuvre", "la ligadura OE U+0152"],
    ["Cartago – Oreamuno", "la raya U+2013"],
  ])("«%s» pasa porque la FUENTE cubre %s", (nombre) => {
    expect(rechazoDeNombreDeEtiqueta(nombre)).toBeNull();
  });

  it("barrido: los code points cubiertos pasan TODOS, y son 219", () => {
    const cubiertos = codePointsCubiertos();
    // Sin `if (…) return;` en ningun sitio: el conteo se afirma ADEMAS del contenido, para que
    // un barrido que no recorriera nada no pudiera reportarse en verde.
    expect(cubiertos.length).toBe(219);

    const rechazados = cubiertos.filter(
      (cp) => rechazoDeNombreDeEtiqueta(String.fromCodePoint(cp)) !== null,
    );
    expect(rechazados.map((cp) => cp.toString(16))).toEqual([]);
  });

  it("y lo que la fuente NO cubre no pasa: las 32 mayusculas cirilicas, todas", () => {
    // Ninguna tiene una normalizacion latina, asi que todas caen del lado irreparable. El conteo
    // se afirma para que el barrido no pueda estar vacio.
    const cirilicas: number[] = [];
    for (let cp = 0x0410; cp <= 0x042f; cp++) cirilicas.push(cp);
    expect(cirilicas.length).toBe(32);

    const pasaron = cirilicas.filter(
      (cp) => rechazoDeNombreDeEtiqueta(String.fromCodePoint(cp)) === null,
    );
    expect(pasaron).toEqual([]);
  });
});

describe("392 — irreparable: se NOMBRA el caracter y no se manda reintentar", () => {
  it("un emoji en el nombre de la tienda", () => {
    expect(rechazoDeNombreDeEtiqueta("Tienda \u{1F642}")).toEqual({
      nombre: [
        "«nombre» lleva un carácter que la etiqueta no puede imprimir: «\u2068\u{1F642}\u2069» (U+1F642). Reintentar no lo cambia: escríbelo con letras y números normales.",
      ],
    });
  });

  it("una griega del bloque matematico, irreparable porque `α` tampoco esta en la fuente", () => {
    expect(rechazoDeNombreDeEtiqueta("Zona \u{1D6C2}")).toEqual({
      nombre: [
        "«nombre» lleva un carácter que la etiqueta no puede imprimir: «\u2068\u{1D6C2}\u2069» (U+1D6C2). Reintentar no lo cambia: escríbelo con letras y números normales.",
      ],
    });
  });

  it("el culpable es UN caracter, no media unidad UTF-16: su code point es el real", () => {
    const rechazo = rechazoDeNombreDeEtiqueta("Tienda \u{1F642}");
    // U+1F642 es un par suplente. Un recorrido por unidades UTF-16 diria «U+D83D», que no existe
    // en ninguna tabla y que nadie podria buscar en su propio archivo.
    expect(rechazo?.nombre[0]).toContain("(U+1F642)");
    expect(rechazo?.nombre[0]).not.toContain("U+D83D");
  });
});

describe("392 — reparable: NO se guarda reparado, se devuelve el texto bueno como sugerencia", () => {
  it("«𝕋ienda Feliz» (U+1D54B) -> la sugerencia «Tienda Feliz», dentro del mensaje", () => {
    expect(rechazoDeNombreDeEtiqueta("\u{1D54B}ienda Feliz")).toEqual({
      nombre: [
        "«nombre» lleva un carácter que la etiqueta no puede imprimir: «\u2068\u{1D54B}\u2069» (U+1D54B). Escríbelo así: «Tienda Feliz».",
      ],
    });
  });

  it("una ligadura tipografica: «Oﬁcina» (U+FB01) -> la sugerencia «Oficina»", () => {
    expect(rechazoDeNombreDeEtiqueta("Oﬁcina")).toEqual({
      nombre: [
        "«nombre» lleva un carácter que la etiqueta no puede imprimir: «\u2068ﬁ\u2069» (U+FB01). Escríbelo así: «Oficina».",
      ],
    });
  });

  it("la `ñ` DESCOMPUESTA no dice «escríbelo así» —se veria igual—: dice que se vuelva a teclear", () => {
    // `"n"` + U+0303, que es lo que produce macOS al copiar. En pantalla se lee «Nuñez».
    expect(rechazoDeNombreDeEtiqueta("Nun\u0303ez")).toEqual({
      nombre: [
        "«nombre» lleva un carácter que la etiqueta no puede imprimir: «\u2068\u0303\u2069» (U+0303). Aquí no hay nada que se vea mal: ese carácter se ve igual que el de siempre pero está escrito de otra forma —lo normal es que la letra y su acento vayan por separado—, y así no se puede imprimir. Bórralo y vuelve a teclearlo; copiar y pegar el mismo texto lo trae otra vez igual.",
      ],
    });
  });
});

describe("392 — la clave del error y el campo que el mensaje nombra son el MISMO", () => {
  it("`CAMPO_NOMBRE` es la clave del `fieldErrors` y aparece dentro del texto", () => {
    const rechazo = rechazoDeNombreDeEtiqueta("Tienda \u{1F642}");
    expect(Object.keys(rechazo ?? {})).toEqual([CAMPO_NOMBRE]);
    expect(rechazo?.[CAMPO_NOMBRE]?.[0]).toContain(`«${CAMPO_NOMBRE}»`);
  });
});
