import { codigoCssSinComentarios } from "./sin-comentarios";

/**
 * Feature 223 — EL parser de reglas CSS del repo. Uno solo.
 *
 * ## Por que existe este archivo
 *
 * Estas tres funciones nacieron DENTRO de `tests/unit/guards/tema-encendido.guardia.test.ts`
 * (feature 211), donde estaban validadas —cortan por comas de primer nivel, llevan la pila de
 * ancestros de cada regla y leen el CODIGO, no la prosa— pero ENCERRADAS: ninguna otra guardia
 * podia usarlas sin copiarlas. La 223 necesita exactamente lo mismo para censar su bloque de
 * impresion, y copiarlas era la salida facil que este repo ya pago dos veces:
 *
 *  - Feature 209: **74 archivos de `tests/` con su propio quitador de comentarios**, 78
 *    apariciones y CINCO semanticas distintas para la misma pasada.
 *  - Feature 217: la aritmetica de contraste, encerrada en una guardia, a punto de duplicarse
 *    (`tests/fixtures/contraste.ts`).
 *
 * Una segunda copia de un parser no falla ruidosamente: las dos guardias siguen verdes y una de
 * las dos empieza a describir un archivo que ya no existe con esa forma.
 *
 * ## Que NO es
 *
 * **No es un parser de CSS.** No entiende `@supports` anidado con condiciones que lleven llaves,
 * no resuelve la cascada, no sabe que regla gana ni compone un estilo. Recorre llaves y comas y
 * devuelve, por regla, sus selectores, la pila de at-rules que la envuelve y sus declaraciones
 * propias. Decidir que significa eso es de quien llama.
 *
 * Tampoco entiende cadenas: un `{` dentro de un `content: "{"` lo descuadraria. En
 * `app/globals.css` no hay ninguno, y si lo hubiera el sintoma seria un rojo, no un verde.
 */

export interface Regla {
  selectores: string[];
  ancestros: string[];
  declaraciones: Record<string, string>;
}

/** Corta por comas de PRIMER nivel: las de `:is(a, b)` o `[attr="x,y"]` no separan. */
export function selectoresDe(prelude: string): string[] {
  const partes: string[] = [];
  let actual = "";
  let hondura = 0;
  for (const c of prelude) {
    if (c === "(" || c === "[") hondura += 1;
    else if (c === ")" || c === "]") hondura -= 1;
    if (c === "," && hondura === 0) {
      partes.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  partes.push(actual);
  return partes.map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
}

export function declaracionesDe(cuerpo: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const trozo of cuerpo.split(";")) {
    if (trozo.includes("{")) continue;
    const i = trozo.indexOf(":");
    if (i < 0) continue;
    const nombre = trozo.slice(0, i).trim();
    if (!nombre || /[{}]/.test(nombre)) continue;
    out[nombre] = trozo.slice(i + 1).trim().replace(/\s+/g, " ");
  }
  return out;
}

/**
 * Todas las reglas del CSS con su prelude, sus ancestros (`@media`, `@layer`…) y sus
 * declaraciones propias. Los comentarios se quitan ANTES con el quitador compartido del
 * repo (feature 209): sin eso, esta misma guardia daria verde con el mecanismo entero
 * borrado, porque `globals.css` explica en prosa todo lo que declara.
 */
export function reglasDe(css: string): Regla[] {
  const reglas: Regla[] = [];
  const pila: { prelude: string; desde: number }[] = [];
  let marca = 0;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === "{") {
      pila.push({ prelude: css.slice(marca, i).trim(), desde: i + 1 });
      marca = i + 1;
    } else if (c === "}") {
      const regla = pila.pop();
      marca = i + 1;
      if (!regla) continue;
      reglas.push({
        selectores: selectoresDe(regla.prelude),
        ancestros: pila.map((p) => p.prelude.replace(/\s+/g, " ")),
        declaraciones: declaracionesDe(css.slice(regla.desde, i)),
      });
    } else if (c === ";") {
      marca = i + 1;
    }
  }
  return reglas;
}

/**
 * Las reglas de un archivo del repo, leido con el quitador de comentarios COMPARTIDO (R30).
 *
 * Con el quitador de **CSS**, no con el de TypeScript: en CSS no existe el comentario `//`, y esa
 * pasada se come una `url(//cdn/x)` y todo lo que le siga en la linea. Ver el porque entero en
 * `quitarComentariosCss`.
 */
export function reglasDeArchivo(rutaRelativa: string): Regla[] {
  return reglasDe(codigoCssSinComentarios(rutaRelativa));
}

/** Una at-rule localizada por lo que CONTIENE, no por su posicion en el archivo. */
export interface AtReglaLocalizada {
  /** Su prelude normalizado (`@media print`). */
  prelude: string;
  /** Indice del primer caracter de su prelude dentro del CSS que se le paso. */
  indice: number;
  /** Numero de linea (base 0) de ese indice, alineado con el fuente crudo (feature 209). */
  linea: number;
}

/**
 * ⚠️ Feature 223 (R24, C3) — LOCALIZAR UN BLOQUE POR SU CONTENIDO, NO POR SER EL PRIMERO.
 *
 * Tres casos vivos de este repo localizaban el bloque de impresion de la 217 como «el primer
 * `@media print` del archivo». Mientras hubo uno solo eso era exacto; la 223 añade un SEGUNDO
 * bloque `@media print` y un ancla posicional habria pasado a vigilar el bloque equivocado **en
 * verde** con solo escribirlo delante. Es el mismo fallo que la 221 ya cazo una vez con
 * `@media not print` (`impresion-sin-dark.guardia.test.ts`), y por eso deja de ser una nota y
 * pasa a ser un instrumento.
 *
 * Devuelve la at-rule ABIERTA mas interna que envuelve a la primera regla cuyo prelude case con
 * `selector`. Es decir: el bloque se identifica por la regla que declara lo que hace, no por
 * donde cae en el archivo.
 *
 * Lanza si no hay tal regla o si no esta dentro de ninguna at-rule: fallar es lo correcto, no
 * devolver un indice plausible.
 */
export function atReglaQueContiene(css: string, selector: RegExp): AtReglaLocalizada {
  const objetivo = css.search(selector);
  if (objetivo < 0) {
    throw new Error(
      `no hay ninguna regla que case con ${selector} en el CODIGO del CSS. O la regla se movio, ` +
        "o este localizador dejo de saber que busca: fallar es lo correcto, no seguir en verde.",
    );
  }
  const pila: { prelude: string; indice: number }[] = [];
  let marca = 0;
  for (let i = 0; i < objetivo; i += 1) {
    const c = css[i];
    if (c === "{") {
      pila.push({ prelude: css.slice(marca, i).trim().replace(/\s+/g, " "), indice: marca });
      marca = i + 1;
    } else if (c === "}") {
      pila.pop();
      marca = i + 1;
    } else if (c === ";") {
      marca = i + 1;
    }
  }
  const envoltorio = pila.at(-1);
  if (!envoltorio) {
    throw new Error(
      `la regla que casa con ${selector} no esta dentro de ninguna at-rule. El bloque que este ` +
        "localizador buscaba dejo de existir, y devolver el indice 0 seria mentir.",
    );
  }
  // El prelude puede arrastrar el blanco de la linea anterior; se ancla en su `@`.
  const indice = envoltorio.indice + Math.max(0, css.slice(envoltorio.indice, objetivo).indexOf("@"));
  return {
    prelude: envoltorio.prelude,
    indice,
    linea: css.slice(0, indice).split("\n").length - 1,
  };
}
