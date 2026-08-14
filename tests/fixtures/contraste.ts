import { readFileSync } from "node:fs";
import path from "node:path";

import { quitarComentariosCss } from "./sin-comentarios";

/**
 * Feature 217 — LA aritmética de contraste del repo, y EL lector de tokens. Una sola copia.
 *
 * ## Por qué existe este archivo
 *
 * La fórmula y el lector nacieron dentro de `tests/unit/guards/contraste-tokens.guardia.test.ts`
 * (feature 210), donde estaban VALIDADOS —tres razones publicadas por WCAG, los dos extremos de
 * la composición alfa, y el parser leyendo el token vigente y no un hex de un comentario— pero
 * ENCERRADOS: ninguna otra guardia podía usarlos sin copiarlos.
 *
 * La 217 necesita medir los pares (tinta, fondo) de la factura del cierre. Copiar la fórmula era
 * la salida fácil y es exactamente la que este repo ya pagó dos veces:
 *
 *  - Feature 209: **74 archivos de `tests/` con su propio quitador de comentarios**, 78
 *    apariciones y CINCO semánticas distintas para la misma pasada.
 *  - 2026-08-12: una fórmula de contraste mal escrita (`lab()` parseado como `rgb`) produjo una
 *    tabla entera de números plausibles e inventados. Un medidor que se equivoca no falla: MIENTE
 *    en verde.
 *
 * Y hay una razón que no es de estilo sino de correción: la trampa de `@media print` (ver
 * `partirPorTema`) hay que arreglarla UNA vez. Con dos copias quedaría arreglada en una guardia y
 * viva en la otra.
 *
 * ## Qué NO es
 *
 * No mide una pantalla. No compone estilos, no resuelve la cascada ni sabe qué clase gana: mide
 * el contraste entre DOS hexes que quien llama le da. Decidir qué dos hexes son los del par real
 * es del que llama, y ahí es donde se equivoca un medidor, no en la aritmética.
 *
 * PROHIBIDO sostener una medición de este repo sobre `.claude/skills/impeccable/scripts/detector/`
 * o sobre cualquier otra herramienta sin autocontroles corriendo en el gate (feature 217, D9).
 */

const RAIZ = path.resolve(__dirname, "../..");
const CSS = path.join(RAIZ, "app", "globals.css");

// ─────────────────────────────────────────────────────────────────────────────────────────
// Aritmética de color (sRGB → luminancia relativa → razón de contraste)
// ─────────────────────────────────────────────────────────────────────────────────────────

export function aRgb(hex: string): [number, number, number] {
  const s = hex.replace("#", "");
  const n = s.length === 3
    ? s.split("").map((c) => c + c).join("")
    : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
}

export function luminancia([r, g, b]: [number, number, number]): number {
  const canal = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

export function contraste(a: string, b: string): number {
  const la = luminancia(aRgb(a));
  const lb = luminancia(aRgb(b));
  const [alto, bajo] = la > lb ? [la, lb] : [lb, la];
  return (alto + 0.05) / (bajo + 0.05);
}

/**
 * Compone `color` al `alpha` dado sobre un `fondo` OPACO. Es la técnica «soft-badge» que el
 * `Badge` usa en tema oscuro (`dark:bg-warning/15`): ahí no hay token `-soft`, el fondo se
 * compone en ejecución, y sin reproducir esa composición el número de oscuro no significa nada.
 */
export function componer(color: string, fondo: string, alpha: number): string {
  const c = aRgb(color);
  const f = aRgb(fondo);
  return (
    "#" +
    c
      .map((v, i) => Math.round(v * alpha + f[i] * (1 - alpha)).toString(16).padStart(2, "0"))
      .join("")
  );
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Lectura de los tokens REALES del archivo
// ─────────────────────────────────────────────────────────────────────────────────────────

/** `app/globals.css` con los comentarios fuera (quitador COMPARTIDO, feature 209). */
export const cssSinComentarios = quitarComentariosCss(readFileSync(CSS, "utf8"));

/**
 * ⚠️ Feature 217 — QUITA LOS BLOQUES `@media print { … }` ANTES DE LEER NINGÚN TOKEN.
 *
 * Éste es el arreglo más fácil de tirar de toda la ficha, y su ausencia NO se nota: rompe en
 * VERDE. El fallo concreto que evita, paso a paso:
 *
 *  1. La 217 añade a `globals.css` un bloque `@media print { .papel-al-imprimir { … } }` que
 *     repite, hex a hex, TODAS las declaraciones del tema CLARO (para que el papel salga blanco).
 *  2. `partirPorTema` (aquí abajo) corta el archivo por el primer `.dark` a principio de línea, y
 *     `token()` se queda con la ÚLTIMA declaración de cada token dentro de su mitad.
 *  3. Si alguien mueve ese bloque DETRÁS de `.dark` —o lo añade al final del archivo, que es
 *     donde uno añade cosas—, sus hexes claros caen en la mitad «oscuro» y GANAN por ser los
 *     últimos: `token("oscuro", "foreground")` devuelve `#12233f` en vez de `#e6ecf8`, y
 *     `token("oscuro", "card")` devuelve `#ffffff` en vez de `#10203a`.
 *  4. Resultado: TODAS las comprobaciones de tema oscuro pasan a medir los pares CLAROS creyendo
 *     que son los oscuros… y siguen en verde. Una guardia de contraste midiendo el tema
 *     equivocado y aprobando.
 *
 * Vive AQUÍ y no dentro de una guardia por la razón por la que existe este archivo: hay dos
 * guardias que leen estos tokens (la 210 y la de la factura). Arreglado en una sola de las dos,
 * quedaría vivo en la otra.
 *
 * El bloque de impresión tiene su propia guardia —espejo `toEqual` contra `:root, .tema-claro`,
 * ancestro `@media print` obligatorio, en `tema-encendido.guardia.test.ts`—. El lector de tokens
 * no debe verlo: aquí se leen los tokens de PANTALLA.
 *
 * Nota de alcance, CORREGIDA por la feature 221: quita cualquier at-rule de medio que nombre
 * `print`, y desde la 221 eso incluye el `@media not print` que envuelve al `@custom-variant
 * dark`. Aquella nota decía «hoy no existe ninguno así» y ya no es cierto. Ese bloque SÍ aplica en
 * pantalla, así que borrarlo aquí es inocuo SÓLO mientras no declare ningún token, y hoy no
 * declara ninguno: dentro sólo viven las dos ramas del variant. Lo sostiene un caso propio en
 * `tests/unit/guards/impresion-sin-dark.guardia.test.ts`. El día que haga falta declarar un token
 * bajo `@media not print`, esta pasada hay que afinarla —distinguir `print` de `not print`— y no
 * darla por buena: ese token es de los de PANTALLA y este lector se lo estaría comiendo.
 */
export function quitarBloquesDeImpresion(css: string): string {
  const apertura = /@media[^{}]*\bprint\b[^{}]*\{/g;
  let salida = "";
  let cursor = 0;
  for (let m = apertura.exec(css); m; m = apertura.exec(css)) {
    const abre = m.index + m[0].length - 1;
    let hondura = 0;
    let i = abre;
    for (; i < css.length; i += 1) {
      if (css[i] === "{") hondura += 1;
      else if (css[i] === "}") {
        hondura -= 1;
        if (hondura === 0) break;
      }
    }
    if (i >= css.length) {
      throw new Error(
        "app/globals.css tiene un bloque `@media print` sin cerrar. Fallar es lo correcto: si " +
          "esta pasada se saltara el bloque, el lector de tokens mediría el tema equivocado en " +
          "verde.",
      );
    }
    salida += css.slice(cursor, m.index);
    cursor = i + 1;
    apertura.lastIndex = cursor;
  }
  return salida + css.slice(cursor);
}

/** El CSS del que salen los tokens de PANTALLA: sin comentarios y sin las reglas de impresión. */
const cssDePantalla = quitarBloquesDeImpresion(cssSinComentarios);

/**
 * Los `-strong` se declaran DOS veces: en `:root` (claro, :149) y en `.dark` + el bloque
 * `prefers-color-scheme` (oscuro, :210 y :269). Se parte por el selector `.dark` REAL a principio
 * de línea.
 *
 * ⚠️ No vale `indexOf(".dark")`: el archivo abre con `@custom-variant dark {` (:23), que menciona
 * `.dark` dentro. Cortar ahí dejaba el `:root` entero del lado «oscuro» y la primera versión de
 * esta guardia falló por eso — con un mensaje que culpaba al token, no al parser.
 */
export function partirPorTema(css: string): { claro: string; oscuro: string } {
  const corte = css.match(/^\.dark[,\s{]/m);
  if (!corte || corte.index === undefined) {
    throw new Error(
      "app/globals.css ya no declara un selector `.dark` a principio de línea: el parser de esta " +
        "guardia caducó y hay que revisarlo a mano.",
    );
  }
  return { claro: css.slice(0, corte.index), oscuro: css.slice(corte.index) };
}

const TEMAS = partirPorTema(cssDePantalla);

/** Un token con variante por tema (`--warning-strong`, `--card`): vive en `:root` y en `.dark`. */
export function token(tema: "claro" | "oscuro", nombre: string): string {
  // La ÚLTIMA declaración gana, igual que en la cascada del navegador.
  const encontrados = [
    ...TEMAS[tema].matchAll(new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, "g")),
  ];
  const ultimo = encontrados.at(-1);
  if (!ultimo) {
    throw new Error(
      `--${nombre} no aparece como hex en el bloque ${tema} de app/globals.css. ` +
        "Si el token cambió de nombre o pasó a otra notación de color, esta guardia hay que " +
        "actualizarla A MANO: fallar es lo correcto, no adivinar.",
    );
  }
  return ultimo[1];
}

/**
 * Un token de paleta SIN variante por tema: los `-soft` y los base viven una sola vez, en el
 * bloque `@theme inline` y con el prefijo `--color-` (`--color-warning-soft`, `--color-warning`).
 * Que no tengan variante oscura es justamente por lo que en oscuro el badge compone `base/15`.
 */
export function paleta(nombre: string): string {
  const m = cssDePantalla.match(new RegExp(`--color-${nombre}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`));
  if (!m) {
    throw new Error(
      `--color-${nombre} no aparece como hex en app/globals.css. Esta guardia asume que los ` +
        "tokens `-soft` y base viven en `@theme inline`; si eso cambió, revísala a mano.",
    );
  }
  return m[1];
}
