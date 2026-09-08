import { describe, expect, it } from "vitest";

import { COBERTURA } from "@/lib/pdf/etiquetas-fuente-cobertura";
import { evaluarTextoDeEtiqueta } from "@/lib/utils/texto-imprimible-etiqueta";

/**
 * FICHA 383 (T2.2/T2.3/T2.4) — LA REGLA: que se toca, que no se toca y que se rechaza.
 *
 * LOS ESPERADOS SON LITERALES ESCAPADOS, nunca el resultado de llamar a la propia funcion. Es la
 * leccion escrita en `lib/pdf/etiquetas-dibujo.ts:192` y repetida en el design §9: comparar la
 * salida contra la funcion que la genera esta SIEMPRE verde. Y van escapados (`\u{1D560}`) porque
 * un literal invisible en un test es un literal que alguien borra sin darse cuenta.
 *
 * LOS BARRIDOS NO LLEVAN NINGUN `if (…) return;`: afirman un CONTEO ademas del contenido. Un test
 * que retorna temprano reporta `passed` sin haber comprobado nada (medido en este repo).
 */

/** Los 219 code points que la fuente cubre, uno a uno. */
function codePointsCubiertos(): number[] {
  const out: number[] = [];
  for (const [desde, hasta] of COBERTURA) for (let cp = desde; cp <= hasta; cp++) out.push(cp);
  return out;
}

describe("383/R5 — lo que NO se puede imprimir y tiene arreglo, se repara", () => {
  it("(a) el caso medido en produccion: double-struck U+1D560 -> `o`", () => {
    const r = evaluarTextoDeEtiqueta("\u{1D560}rfirio");
    expect(r).toEqual({
      estado: "reparado",
      valor: "orfirio",
      original: "\u{1D560}rfirio",
      culpable: "\u{1D560}",
      codePoint: 0x1d560,
    });
  });

  it("(b) la ligadura `\\uFB01` -> `fi`, que ALARGA el texto en un caracter", () => {
    const r = evaluarTextoDeEtiqueta("ﬁn");
    expect(r).toEqual({
      estado: "reparado",
      valor: "fin",
      original: "ﬁn",
      culpable: "ﬁ",
      codePoint: 0xfb01,
    });
    // El riesgo escrito en el design §8.1: la reparacion puede alargar el texto y una direccion
    // al limite podria pasar a no caber (`ErrorEtiquetaNoCabe`, ficha 350). No es una regresion
    // —hoy ese texto ni siquiera se imprimia— pero queda afirmado para que no sea una sorpresa.
    if (r.estado !== "reparado") throw new Error("caso mal montado");
    expect(r.valor.length).toBe(r.original.length + 1);
  });

  it("(Q2) la `ñ` DESCOMPUESTA de macOS se compone en vez de rechazarse", () => {
    // `n` + U+0303 COMBINING TILDE. Se lee «ñ» en pantalla y sin el `NFC` previo se rechazaria
    // nombrando un U+0303 que quien lo lee no ve por ningun lado.
    const r = evaluarTextoDeEtiqueta("Nun\u0303ez");
    expect(r).toEqual({
      estado: "reparado",
      valor: "Nuñez",
      original: "Nun\u0303ez",
      culpable: "\u0303",
      codePoint: 0x0303,
    });
  });
});

describe("383/R4 — lo que la fuente YA cubre no se toca JAMAS", () => {
  it("(c) `½` (U+00BD) entra y sale `½`, aunque su NFKC sea `1` + U+2044 + `2`", () => {
    // ESTE es el caso que mata el `NFKC` a ciegas: U+2044 FRACTION SLASH no esta en la fuente
    // (los rangos saltan de 0x203A a 0x20A1), asi que normalizar la cadena entera convertiria una
    // etiqueta que hoy sale perfecta en un RECHAZO NUEVO.
    expect(evaluarTextoDeEtiqueta("½")).toEqual({ estado: "intacto", valor: "½" });
    expect(evaluarTextoDeEtiqueta("1½ kg")).toEqual({
      estado: "intacto",
      valor: "1½ kg",
    });
  });

  it("(d) `™`, `…` y `m²` salen intactos: NFKC los reescribiria gratis", () => {
    for (const texto of ["™", "…", "m²", "¼", "¾", "´¨"]) {
      expect(evaluarTextoDeEtiqueta(texto)).toEqual({ estado: "intacto", valor: texto });
    }
  });

  it("(g) la `ñ` PRECOMPUESTA y el resto de acentos, intactos", () => {
    const texto = "Nuñez áéíóú ₡18.000";
    expect(evaluarTextoDeEtiqueta(texto)).toEqual({ estado: "intacto", valor: texto });
  });
});

describe("383/R6 — lo que no tiene arreglo se RECHAZA, no se borra ni se sustituye", () => {
  it("(e) un emoji: irreparable, con su code point, y el texto NO sale mutilado", () => {
    const r = evaluarTextoDeEtiqueta("Ana \u{1F642}");
    expect(r).toEqual({ estado: "irreparable", culpable: "\u{1F642}", codePoint: 0x1f642 });
    // Lo que NO puede pasar: que devuelva un `valor`. Sustituirlo por `?` o quitarlo dejaria una
    // orden con un nombre que nadie escribio.
    expect("valor" in r).toBe(false);
  });

  it("(f) cirilico: `NFKC` no lo vuelve latino, y se rechaza", () => {
    const r = evaluarTextoDeEtiqueta("\u0410\u043D\u0430");
    expect(r).toEqual({ estado: "irreparable", culpable: "\u0410", codePoint: 0x0410 });
  });

  it("(R7) la GRIEGA del bloque matematico se rechaza: `α` tampoco esta en la fuente", () => {
    const r = evaluarTextoDeEtiqueta("\u{1D6C2}");
    expect(r).toEqual({ estado: "irreparable", culpable: "\u{1D6C2}", codePoint: 0x1d6c2 });
  });
});

describe("383/R12 — `reparar: false` es SOLO veredicto", () => {
  it("(h) un texto REPARABLE sale `irreparable` y no se toca", () => {
    const r = evaluarTextoDeEtiqueta("\u{1D560}rfirio", { reparar: false });
    expect(r).toEqual({ estado: "irreparable", culpable: "\u{1D560}", codePoint: 0x1d560 });
  });

  it("y un texto imprimible sigue saliendo intacto", () => {
    expect(evaluarTextoDeEtiqueta("REM-1042", { reparar: false })).toEqual({
      estado: "intacto",
      valor: "REM-1042",
    });
  });

  it("tampoco compone la `ñ` descompuesta: con `reparar: false` no se toca NADA", () => {
    expect(evaluarTextoDeEtiqueta("n\u0303", { reparar: false })).toEqual({
      estado: "irreparable",
      culpable: "\u0303",
      codePoint: 0x0303,
    });
  });
});

describe("383/R8 (T2.3a) — barrido de los 219 code points cubiertos", () => {
  it("los 219 entran y salen IDENTICOS, y son 219", () => {
    const cubiertos = codePointsCubiertos();
    // El conteo se afirma primero: si mañana la cobertura crece, este test lo dice en vez de
    // barrer en silencio un conjunto distinto.
    expect(cubiertos.length).toBe(219);

    const cambiados: string[] = [];
    let evaluados = 0;
    for (const cp of cubiertos) {
      const texto = String.fromCodePoint(cp);
      const r = evaluarTextoDeEtiqueta(texto);
      evaluados++;
      if (r.estado !== "intacto" || r.valor !== texto) {
        cambiados.push(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    }
    // Sin este conteo, un `continue` mal puesto dejaria el test verde sin evaluar nada.
    expect(evaluados).toBe(219);
    // Igualdad EXACTA con la lista vacia, no un `toHaveLength(0)`: si algo cae, el mensaje dice
    // CUAL. Con `NFKC` sobre la cadena entera caerian nueve —`¨ ¯ ´ µ ¸ ¼ ½ ¾ ˜`— (medicion T0.1).
    expect(cambiados).toEqual([]);
  });
});

describe("383/R7 (T2.3b) — barrido del bloque U+1D400-U+1D7FF", () => {
  it("cada code point o repara a algo cubierto o se rechaza, con los conteos medidos", () => {
    let reparables = 0;
    let irreparables = 0;
    let evaluados = 0;
    for (let cp = 0x1d400; cp <= 0x1d7ff; cp++) {
      const r = evaluarTextoDeEtiqueta(String.fromCodePoint(cp));
      evaluados++;
      if (r.estado === "reparado") reparables++;
      else if (r.estado === "irreparable") irreparables++;
    }
    // 1024 code points, ni uno «intacto»: NINGUNO de este bloque esta en la fuente.
    expect(evaluados).toBe(1024);
    expect(reparables + irreparables).toBe(1024);
    // Los dos conteos de la medicion T0.2, pegados en `progress/impl_383.md`. Fijar el veredicto
    // a «reparable» para todo el bloque —que es como suena «normaliza el bloque U+1D400»— pone
    // este test rojo: las griegas normalizan a griego, que tampoco esta en la fuente.
    expect(reparables).toBe(702);
    expect(irreparables).toBe(322);
  });

  it("y los dos nombrados: `𝕠` repara, `𝛂` no", () => {
    expect(evaluarTextoDeEtiqueta("\u{1D560}")).toMatchObject({ estado: "reparado", valor: "o" });
    expect(evaluarTextoDeEtiqueta("\u{1D6C2}")).toMatchObject({ estado: "irreparable" });
  });
});

describe("383/R6 (T2.4) — un par suplente es UN caracter, no dos mitades", () => {
  it("el culpable ocupa dos unidades UTF-16 y su codePointAt(0) es el real", () => {
    const r = evaluarTextoDeEtiqueta("Ana \u{1F642} Perez");
    expect(r.estado).toBe("irreparable");
    if (r.estado !== "irreparable") throw new Error("caso mal montado");
    // Con `split("")` en el recorrido, `culpable` seria una mitad suelta: `length === 1` y un
    // code point de la zona suplente (0xD83D), que no se puede buscar en ninguna tabla Unicode.
    expect(r.culpable.length).toBe(2);
    expect(r.culpable.codePointAt(0)).toBe(0x1f642);
    expect(r.codePoint).toBe(0x1f642);
  });

  it("y el reparado tampoco parte el par: `𝕠` (2 unidades) sale como `o` (1)", () => {
    const r = evaluarTextoDeEtiqueta("\u{1D560}");
    expect(r).toMatchObject({ estado: "reparado", valor: "o" });
    expect("\u{1D560}".length).toBe(2);
  });
});

describe("383 — bordes", () => {
  it("la cadena vacia sale intacta", () => {
    expect(evaluarTextoDeEtiqueta("")).toEqual({ estado: "intacto", valor: "" });
  });

  it("un texto con DOS caracteres reparables repara los dos", () => {
    expect(evaluarTextoDeEtiqueta("\u{1D560}\u{1D55D}a")).toEqual({
      estado: "reparado",
      valor: "ola",
      original: "\u{1D560}\u{1D55D}a",
      culpable: "\u{1D560}",
      codePoint: 0x1d560,
    });
  });

  it("uno reparable y uno irreparable: manda el rechazo, no la reparacion a medias", () => {
    expect(evaluarTextoDeEtiqueta("\u{1D560}\u{1F642}")).toEqual({
      estado: "irreparable",
      culpable: "\u{1F642}",
      codePoint: 0x1f642,
    });
  });
});
