import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contraste, paleta, token, tokenAlImprimir } from "../../fixtures/contraste";
import { atReglaQueContiene, reglasDe, selectoresDe, type Regla } from "../../fixtures/css-reglas";
import { codigoCssSinComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 224 — GUARDIA del bloque que hace que AL IMPRIMIR los tokens sean los CLAROS.
 *
 * La 221 apagó el variant `dark:` en papel; su guardia vive en `impresion-sin-dark.guardia.test.ts`.
 * Ésta vigila la otra mitad: el `@media print` que redeclara los 35 tokens claros para `.dark`,
 * `body:has(> .dark)`, `.tema-sistema` y `body:has(> .tema-sistema)`.
 *
 * ── QUÉ VIGILA, Y POR QUÉ CADA COSA SE ROMPE EN SILENCIO
 *  1. **Que el bloque exista** y cubra los CUATRO selectores por los que entran los tokens
 *     oscuros. Quitar uno deja media app imprimiendo en oscuro y ninguna pantalla lo muestra.
 *  2. **Que GANE.** Es lo específico de esta ficha y lo más fácil de romper «limpiando»: un
 *     `@media print { .dark { … } }` está escrito, compila, se lee perfecto… y NO HACE NADA,
 *     porque empata en especificidad con `.dark` y pierde por orden. El bloque gana por el `html`
 *     que lleva delante, y aquí se calcula la especificidad para comprobarlo.
 *  3. **Que siga ANTES de `.dark`.** No por la cascada —no gana por orden— sino por el lector de
 *     tokens: un bloque de impresión detrás de `.dark` mete 35 hexes claros en la mitad «oscuro»
 *     del archivo y `token("oscuro", …)` empieza a devolverlos, EN VERDE.
 *  4. **Que sea un ESPEJO exacto**: las mismas claves que `.dark`, con los valores de
 *     `:root, .tema-claro`. Un token nuevo en `.dark` sin su gemelo aquí sale en papel oscuro.
 *  5. **Los números**, medidos con la aritmética canónica y atados al comentario del CSS.
 *
 * ── LO QUE NO AFIRMA
 * Aquí no imprime nadie: no hay motor de impresión ni papel. Lo que se comprueba es la ESTRUCTURA
 * del CSS y la ARITMÉTICA de los pares. Que en un navegador real la cascada resuelva como aquí se
 * calcula se midió UNA vez, a mano y fuera del gate (Chromium 149.0.7827.55, `emulateMedia`
 * `{ media: "print" }` sobre este archivo compilado con tailwindcss 4.3.2): con `.dark` a secas la
 * tinta impresa salía `#e6ecf8` y con `html .dark` salía `#12233f`. La tabla está en el comentario
 * del bloque y en `progress/impl_224.md`.
 */

const GLOBALS = "app/globals.css";
const RAIZ = path.resolve(__dirname, "../../..");

/** El CÓDIGO del CSS, con la prosa fuera (quitador compartido, feature 209). */
const css = codigoCssSinComentarios(GLOBALS);
/** El fuente TAL CUAL. Sólo para los casos que exigen que algo esté escrito en un COMENTARIO. */
const crudo = readFileSync(path.join(RAIZ, GLOBALS), "utf8");
const reglas = reglasDe(css);

// ─────────────────────────────────────────────────────────────────────────────────────────
// El instrumento: la especificidad (a-b-c) de un selector
// ─────────────────────────────────────────────────────────────────────────────────────────

type Especificidad = [number, number, number];

/** Los funcionales que toman la especificidad de su argumento MÁS específico, no la suya. */
const DELEGAN = new Set(["is", "not", "has", "matches"]);

/** El contenido de un `(…)` que abre en `desde`, y el índice del carácter siguiente al `)`. */
function parentesis(selector: string, desde: number): { texto: string; fin: number } {
  let hondura = 0;
  for (let i = desde; i < selector.length; i += 1) {
    if (selector[i] === "(") hondura += 1;
    else if (selector[i] === ")") {
      hondura -= 1;
      if (hondura === 0) return { texto: selector.slice(desde + 1, i), fin: i + 1 };
    }
  }
  throw new Error(`selector con paréntesis sin cerrar: ${selector}`);
}

function mayor(a: Especificidad, b: Especificidad): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

/**
 * La especificidad de un selector COMPLEJO, según CSS Selectors 4 §17: identificadores, clases /
 * atributos / pseudo-clases, y tipos / pseudo-elementos. Los combinadores no suman, `*` no suma,
 * `:where()` vale cero, y `:is()` / `:not()` / `:has()` toman la de su argumento más específico.
 *
 * NO es un parser de CSS: no valida, no normaliza y no resuelve nada. Cubre la forma de los
 * selectores de `app/globals.css`, y su autocomprobación —abajo— es la que dice hasta dónde llega.
 */
function especificidadDe(selector: string): Especificidad {
  let ids = 0;
  let clases = 0;
  let tipos = 0;
  let i = 0;
  while (i < selector.length) {
    const resto = selector.slice(i);
    const c = selector[i]!;
    if (c === "#") {
      ids += 1;
      i += /^#[\w-]+/.exec(resto)![0].length;
    } else if (c === ".") {
      clases += 1;
      i += /^\.[\w-]+/.exec(resto)![0].length;
    } else if (c === "[") {
      clases += 1;
      i += selector.indexOf("]", i) - i + 1;
    } else if (c === ":" && selector[i + 1] === ":") {
      tipos += 1;
      i += /^::[\w-]+/.exec(resto)![0].length;
    } else if (c === ":") {
      const nombre = /^:([\w-]+)/.exec(resto)![1]!.toLowerCase();
      let j = i + nombre.length + 1;
      if (selector[j] === "(") {
        const { texto, fin } = parentesis(selector, j);
        j = fin;
        if (nombre !== "where") {
          if (DELEGAN.has(nombre)) {
            const peor = selectoresDe(texto)
              .map(especificidadDe)
              .reduce<Especificidad>((mejor, uno) => (mayor(uno, mejor) ? uno : mejor), [0, 0, 0]);
            ids += peor[0];
            clases += peor[1];
            tipos += peor[2];
          } else {
            clases += 1;
          }
        }
      } else {
        clases += 1;
      }
      i = j;
    } else if (/[a-zA-Z*]/.test(c)) {
      const pieza = /^(\*|[a-zA-Z][\w-]*)/.exec(resto)![0];
      if (pieza !== "*") tipos += 1;
      i += pieza.length;
    } else {
      i += 1; // combinadores, espacios y comas
    }
  }
  return [ids, clases, tipos];
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Las piezas: la regla de impresión, las dos de pantalla, y dónde cae cada una
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los CUATRO caminos por los que se encienden los tokens OSCUROS, escritos A MANO y a propósito.
 * Es el INVENTARIO: si mañana aparece una quinta forma de encender el tema oscuro, esta lista es
 * lo que se pone rojo, y el rojo dice que el bloque de impresión no la conoce.
 *
 * NO se usa para comprobar que el bloque GANA. Eso se mide contra los selectores REALES de las
 * reglas de pantalla (`selectoresOscurosReales`), que es otra cosa: con esta lista, el caso
 * demostraba que le gana «a esos cuatro textos», no «a la regla que hoy existe», y subir la
 * especificidad de la regla de PANTALLA —que devuelve el papel a oscuro sin tocar este bloque—
 * no lo ponía rojo por su propio cálculo.
 */
const SELECTORES_OSCUROS = [
  ".dark",
  "body:has(> .dark)",
  ".tema-sistema",
  "body:has(> .tema-sistema)",
] as const;

/**
 * Las reglas de PANTALLA que encienden el tema oscuro, localizadas por lo que DECLARAN
 * (`--foreground: #e6ecf8`) y no por su selector. Son las que este bloque tiene que vencer, y si
 * alguien las reescribe —o les sube la especificidad— hay que vencerlas en su forma nueva.
 */
const reglasOscurasDePantalla = reglas.filter(
  (r) =>
    r.declaraciones["--foreground"] === "#e6ecf8" &&
    // Una at-rule NO es una regla de estilo. `reglasDe` devuelve también el `@media
    // (prefers-color-scheme: dark)` que ENVUELVE al espejo, y sus «declaraciones» son las de su
    // hijo: sin este filtro entraba como un tercer «selector» al que ganar, y no selecciona nada.
    !r.selectores.some((s) => s.startsWith("@")) &&
    !r.ancestros.some((a) => /^@media\s+print\b/.test(a)),
);
const selectoresOscurosReales = reglasOscurasDePantalla.flatMap((r) => r.selectores);

/** La regla de esta ficha: la única dentro de `@media print` que nombra `.dark`. */
const impresion = reglas.filter(
  (r) =>
    r.ancestros.some((a) => /^@media\s+print\b/.test(a)) &&
    r.selectores.some((s) => /(^|[\s>+~])\.dark\b/.test(s)),
);

/**
 * El gemelo de impresión de un selector de pantalla: el que selecciona los MISMOS elementos, o un
 * subconjunto (el original con un ancestro delante). `undefined` si no hay ninguno.
 */
function gemeloDeImpresion(oscuro: string): string | undefined {
  return impresion[0]?.selectores.find((s) => s === oscuro || s.endsWith(` ${oscuro}`));
}

function reglaUnica(selector: string): Regla {
  const hallazgos = reglas.filter((r) => r.selectores.includes(selector));
  expect(hallazgos.length, `no hay exactamente una regla para \`${selector}\` en ${GLOBALS}`).toBe(1);
  return hallazgos[0]!;
}

/**
 * Índice, dentro del CÓDIGO, del `@media print` que envuelve al bloque de esta ficha.
 *
 * El ancla se DERIVA del primer selector que el bloque tiene de verdad, en vez de escribir aquí
 * `html .dark`. No es cosmético: `html` es una de las formas de subir la especificidad y hay
 * otras que también ganan (`:root .dark`, la clase duplicada). Con el literal escrito, cambiar a
 * una de ellas ponía este censo rojo por no encontrar el bloque —un rojo que no señala ningún
 * defecto—, mientras que el caso que de verdad importa (¿gana?) seguiría comprobándose solo.
 */
function indiceDelBloque(): number {
  const primero = impresion[0]!.selectores[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `[^\S\n]*` y no `\s*`: `\s` cruza saltos de línea, así que el ancla podía empezar a casar
  // varias líneas ANTES del bloque —fuera de su `@media print`— y devolver un índice plausible
  // de otra at-rule. Aquí la sangría es sangría, no cualquier blanco.
  const bloque = atReglaQueContiene(css, new RegExp(`^[^\\S\\n]*${primero}[^\\S\\n]*[,{]`, "m"));
  expect(
    bloque.prelude,
    "el ancla del bloque de tokens de impresión enganchó otra at-rule. Un índice plausible de " +
      "otro sitio es peor que no encontrarlo: los casos de orden compararían contra otra cosa.",
  ).toMatch(/^@media\s+print\b/);
  return bloque.indice;
}

describe("feature 224 — el instrumento: la especificidad de un selector", () => {
  /**
   * Autocomprobación del calculador. Sin esto, un `especificidadDe` que devolviera siempre
   * `[0,0,0]` dejaría el caso central verde sin haber comparado nada — y ES el caso central:
   * toda la ficha depende de que el bloque de impresión gane por especificidad.
   */
  it.each([
    [".dark", [0, 1, 0]],
    ["html .dark", [0, 1, 1]],
    ["body:has(> .dark)", [0, 1, 1]],
    ["html body:has(> .dark)", [0, 1, 2]],
    [".tema-sistema", [0, 1, 0]],
    ["html body:has(> .tema-sistema)", [0, 1, 2]],
    ["*", [0, 0, 0]],
    ["div", [0, 0, 1]],
    ["#x", [1, 0, 0]],
    [".a.b", [0, 2, 0]],
    ["[hidden]", [0, 1, 0]],
    ["a:hover", [0, 1, 1]],
    [":where(.a, #b)", [0, 0, 0]],
    [":not(.a, #b)", [1, 0, 0]],
    ["::before", [0, 0, 1]],
    ['body:has([role="dialog"] .hoja-imprimible)', [0, 2, 1]],
  ])("calcula la especificidad de `%s`", (selector, esperada) => {
    expect(especificidadDe(selector as string)).toEqual(esperada);
  });

  it("el desempate lexicográfico distingue de verdad, y no dice que todo gana", () => {
    expect(mayor([0, 1, 1], [0, 1, 0])).toBe(true);
    expect(mayor([0, 1, 0], [0, 1, 1])).toBe(false);
    expect(mayor([0, 1, 0], [0, 1, 0]), "un empate NO es ganar: es justo el bug de esta ficha").toBe(
      false,
    );
    expect(mayor([1, 0, 0], [0, 9, 9])).toBe(true);
    expect(mayor([0, 0, 2], [0, 1, 0])).toBe(false);
  });
});

describe("feature 224 — el bloque existe, y cubre los cuatro caminos", () => {
  /**
   * Autocomprobación del censo. Si el localizador dejara de encontrar el bloque, los casos de
   * abajo medirían `undefined` y varios pasarían por vacuidad.
   */
  it("el censo lee el CÓDIGO del CSS —no su prosa— y encuentra el bloque", () => {
    expect(css.length).toBeGreaterThan(5000);
    expect(crudo, "el fuente crudo ya no explica esta ficha").toMatch(/Feature 224/);
    expect(
      css,
      "el quitador de comentarios no está pasando: se estaría censando PROSA, y el comentario de " +
        "este bloque nombra a propósito `html .dark`, `@media print` y las especificidades.",
    ).not.toMatch(/Feature 224/);
    expect(
      impresion,
      "no hay ninguna regla dentro de `@media print` que redeclare los tokens de `.dark`. Sin " +
        "ella, quien imprime desde tema oscuro vuelve a sacar tinta `#e6ecf8` sobre papel blanco " +
        "en las quince rutas del portal, y no hay pantalla que lo muestre.",
    ).toHaveLength(1);
  });

  /**
   * El INVENTARIO de caminos, y va antes que todo lo demás: si aparece una quinta forma de
   * encender el tema oscuro —o desaparece una— el bloque de impresión no puede enterarse solo.
   * Las reglas se localizan por lo que DECLARAN, no por su selector, para que reescribirlas no
   * esconda el cambio.
   */
  it("los caminos que encienden el tema oscuro son los CUATRO conocidos, en DOS reglas", () => {
    expect(
      reglasOscurasDePantalla,
      "el CÓDIGO dejó de tener exactamente dos reglas de pantalla que declaren la tinta oscura " +
        "(`.dark` y el espejo de «sistema»). Todo este censo mide contra ellas.",
    ).toHaveLength(2);
    expect(
      [...selectoresOscurosReales].sort(),
      "cambió la lista de selectores por los que se enciende el tema oscuro. El bloque de " +
        "impresión tiene un gemelo por cada uno: si aparece un camino nuevo, hay que darle el suyo " +
        "o media app seguirá imprimiendo en oscuro por ahí.",
    ).toEqual([...SELECTORES_OSCUROS].sort());
  });

  it("cubre los CUATRO selectores por los que entran los tokens oscuros", () => {
    for (const oscuro of selectoresOscurosReales) {
      expect(
        impresion[0]!.selectores.filter((s) => s === oscuro || s.endsWith(` ${oscuro}`)),
        `el bloque de impresión no cubre \`${oscuro}\`. Los tokens oscuros entran por CUATRO ` +
          "caminos —la clase explícita, el `<body>` que la espeja, y los dos de «sistema»— y basta " +
          "que falte uno para que media app siga imprimiendo en oscuro.",
      ).toHaveLength(1);
    }
    expect(
      impresion[0]!.selectores,
      "el bloque de impresión enganchó un selector de más: cada uno tiene que ser el gemelo de " +
        "uno de los cuatro caminos, no una superficie nueva.",
    ).toHaveLength(selectoresOscurosReales.length);
  });

  it("vive dentro de `@media print` y de NINGÚN `@layer`", () => {
    const ancestros = impresion[0]!.ancestros.join(" | ");
    expect(
      ancestros,
      "el bloque quedó fuera de `@media print`: aplicaría EN PANTALLA y apagaría el tema oscuro " +
        "de toda la aplicación, que es lo contrario de lo que hace esta ficha.",
    ).toMatch(/^@media\s+print\b/);
    expect(
      ancestros,
      "el bloque quedó dentro de un `@layer`: ahí lo vence cualquier utilidad de Tailwind y deja " +
        "de hacer nada, en verde.",
    ).not.toMatch(/@layer/);
  });
});

describe("feature 224 — EL CASO: el bloque GANA, y no por casualidad", () => {
  /**
   * EL caso de la ficha. La contradicción que resuelve, dicha entera:
   *
   *  · Donde el bloque TIENE que estar es ANTES de `.dark` (lo exige el lector de tokens, y hay
   *    dos guardias que lo vigilan).
   *  · Ahí, un selector `.dark` a secas EMPATA en especificidad (0-1-0) con la regla de abajo y
   *    PIERDE por orden: el bloque queda escrito, compila, y no hace nada.
   *
   * La salida es subir la especificidad, y por eso los selectores llevan `html` delante. Esto lo
   * comprueba: para cada camino, el gemelo de impresión tiene que ganarle a su original.
   *
   * ⚠️ SE MIDE CONTRA LOS SELECTORES **REALES** de las reglas de pantalla, no contra una lista
   * escrita aquí. La diferencia no es de estilo: con la lista escrita, esto demostraba que el
   * bloque le gana «a esos cuatro TEXTOS», y una mutación que suba la especificidad de la regla de
   * PANTALLA —`.dark` → `html .dark`, que devuelve el papel a oscuro sin tocar este bloque— salía
   * roja sólo DE REBOTE, por anclajes `^\.dark` de otras guardias. Anclado en las reglas reales,
   * el empate lo canta este mismo cálculo y con su mensaje.
   *
   * MUERDE, comprobado plantando las mutaciones (ver `progress/impl_224.md`):
   *  · quitar el `html ` de los cuatro selectores → rojo aquí (empate, no gana).
   *  · quitar el `html ` de UNO solo → rojo, con el nombre del camino que dejó de ganar.
   *  · subir la especificidad de la regla de PANTALLA → rojo aquí, por el mismo empate.
   */
  it("cada selector de impresión le gana en especificidad al que redeclara los tokens oscuros", () => {
    const orden = indiceDelBloque() > css.search(/^\.dark[,\s{]/m);
    expect(
      orden,
      "el bloque de impresión pasó a estar DESPUÉS de `.dark`. Entonces ganaría por orden, sí, " +
        "pero envenena el lector de tokens de pantalla: hay dos guardias más que lo prohíben. Si " +
        "de verdad se movió a propósito, hay que releer las tres a la vez.",
    ).toBe(false);

    for (const oscuro of selectoresOscurosReales) {
      const gemelo = gemeloDeImpresion(oscuro);
      // Sin este `expect`, el `!` de abajo revienta con un `TypeError` cuando falta el gemelo y el
      // diagnóstico redactado no llega a imprimirse nunca.
      expect(
        gemelo,
        `el bloque de impresión no tiene gemelo para \`${oscuro}\`, así que ese camino imprime ` +
          "todavía con la tinta del tema oscuro. Falla aquí antes de intentar medirlo.",
      ).toBeDefined();

      const suyo = especificidadDe(gemelo!);
      const original = especificidadDe(oscuro);
      expect(
        mayor(suyo, original),
        `\`${gemelo}\` (${suyo.join("-")}) NO le gana a \`${oscuro}\` (${original.join("-")}). Un ` +
          "`@media` NO suma especificidad: con un empate manda el ORDEN, y este bloque vive " +
          "ANTES a propósito, así que perdería. Estaría escrito, compilaría, se leería perfecto… " +
          "y el papel seguiría saliendo con la tinta del tema oscuro. Medido en Chromium: con " +
          "`.dark` a secas la tinta impresa es `#e6ecf8`; con `html .dark`, `#12233f`.",
      ).toBe(true);
    }
  });

  /**
   * La otra mitad del mismo hecho, y hace falta decirla aparte: hoy el bloque NO gana por orden.
   * Si mañana alguien lo moviera al final del archivo, el caso de arriba seguiría pidiendo
   * especificidad de más sin motivo… y las guardias del lector de tokens se pondrían rojas. Este
   * caso deja escrito cuál de las dos razones es la que está en juego, para que nadie «simplifique»
   * el selector creyendo que gana por dónde está.
   */
  it("y NO gana por orden: está antes que todo lo que pisa, y ésa es la razón de la especificidad", () => {
    const bloque = indiceDelBloque();

    /*
     * Se ancla en LA TINTA OSCURA, no en los selectores que la declaran. Es la lección de la 221
     * y la 223 aplicada una vez más: un ancla que nombra un selector caduca en cuanto alguien lo
     * escribe distinto, y devuelve un índice plausible de otro sitio en vez de no encontrar nada.
     * `--foreground: #e6ecf8` sólo aparece dos veces en el CÓDIGO —`.dark` y su espejo de
     * «sistema»— y son exactamente las dos declaraciones que este bloque tiene que vencer.
     */
    const declaracionesOscuras = [...css.matchAll(/--foreground:\s*#e6ecf8/g)].map((m) => m.index!);
    expect(
      declaracionesOscuras,
      "el CÓDIGO dejó de declarar la tinta oscura dos veces (`.dark` y el espejo de «sistema»). " +
        "Este censo mide contra ellas: si cambiaron, hay que releerlo en vez de darlo por bueno.",
    ).toHaveLength(2);

    for (const donde of declaracionesOscuras) {
      expect(
        bloque,
        "el bloque de tokens de impresión quedó DESPUÉS de una declaración de la tinta oscura. " +
          "Ganaría por orden, sí, pero envenena el lector de tokens de pantalla: sus 35 hexes " +
          'claros pasan a ser los últimos de la mitad «oscuro» y `token("oscuro", …)` empieza a ' +
          "devolverlos, con toda la verificación de tema oscuro midiendo el tema claro EN VERDE.",
      ).toBeLessThan(donde);
    }
  });
});

describe("feature 224 — el bloque es un ESPEJO: claves de `.dark`, valores de `.tema-claro`", () => {
  it("declara EXACTAMENTE los tokens que `.dark` pisa, ni uno más ni uno menos", () => {
    const oscuro = reglaUnica(".dark");
    const papel = impresion[0]!;
    expect(Object.keys(oscuro.declaraciones).length).toBeGreaterThan(30);
    expect(
      Object.keys(papel.declaraciones).sort(),
      "el bloque de impresión y `.dark` dejaron de declarar el mismo juego de tokens. Si `.dark` " +
        "estrenó uno, en papel sale con su valor OSCURO; si aquí sobra uno, se está fijando algo " +
        "que el tema oscuro no toca y el papel deja de ser el tema claro.",
    ).toEqual(Object.keys(oscuro.declaraciones).sort());
  });

  it("y sus valores son los de `:root, .tema-claro`, hex a hex", () => {
    const claro = reglaUnica(".tema-claro");
    for (const [nombre, valor] of Object.entries(impresion[0]!.declaraciones)) {
      expect(
        valor,
        `\`${nombre}\` no imprime el valor del tema claro. El papel tiene que ser EXACTAMENTE el ` +
          "tema claro: un hex propio aquí es una tercera paleta que nadie ve hasta que sale del " +
          "cajón de la impresora.",
      ).toBe(claro.declaraciones[nombre]);
    }
  });

  it("fija la TINTA y no sólo las superficies (los navegadores no imprimen fondos)", () => {
    const papel = impresion[0]!.declaraciones;
    expect(papel["--foreground"]).toBe("#12233f");
    expect(papel["--card-foreground"]).toBe("#12233f");
    for (const familia of ["success", "warning", "danger", "info"]) {
      expect(
        papel[`--${familia}-strong`],
        `el bloque no fija --${familia}-strong: ese texto saldría con su valor de tema oscuro ` +
          "sobre papel blanco, que es exactamente el bug que esta ficha cierra.",
      ).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("NO fuerza la impresión de fondos: sigue sin haber `print-color-adjust`", () => {
    expect(
      css,
      "`print-color-adjust: exact` obligaría a imprimir la superficie, y con los tokens ya claros " +
        "eso sólo añade tóner sin añadir legibilidad. La decisión humana de la 217 lo descarta.",
    ).not.toMatch(/print-color-adjust/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// LOS NÚMEROS  ·  aritmética canónica de `tests/fixtures/contraste.ts`
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Redondeo a dos decimales, que es la precisión con la que se anotan los números en el CSS. */
function medir(tinta: string, fondo: string): number {
  return Number(contraste(tinta, fondo).toFixed(2));
}

const PAPEL = "#ffffff";

/**
 * El camino POR DEFECTO: papel sin fondos —los navegadores no imprimen superficies salvo que el
 * usuario marque «gráficos de fondo», que viene desmarcado—. Ahí lo único que decide la
 * legibilidad es la TINTA, y esta ficha la cambia de la oscura a la clara.
 *
 * `antes` sale de `token("oscuro", …)` (lo que había en papel hasta esta ficha) y `despues` de
 * `tokenAlImprimir(…)`, que lee el bloque nuevo. Son DOS lectores distintos a propósito: el
 * primero es ciego al papel, y confundirlos es exactamente el defecto que esta ficha vino a
 * corregir en la guardia de la 221.
 */
const EN_PAPEL = [
  { id: "T1", que: "texto `--foreground` (el 1.19 que nombra la ficha)", cual: "foreground", antes: 1.19, despues: 15.7 },
  { id: "T2", que: "`Badge` success (`--success-strong`)", cual: "success-strong", antes: 1.92, despues: 5.48 },
  { id: "T3", que: "`Badge` warning (`--warning-strong`)", cual: "warning-strong", antes: 1.67, despues: 7.09 },
  { id: "T4", que: "`Badge` danger (`--danger-strong`)", cual: "danger-strong", antes: 2.77, despues: 6.47 },
  { id: "T5", que: "`Badge` info (`--info-strong`)", cual: "info-strong", antes: 2.08, despues: 6.7 },
  { id: "T6", que: "texto secundario (`--muted-foreground`)", cual: "muted-foreground", antes: 2.26, despues: 7.7 },
] as const;

describe("feature 224 — en papel sin fondos, la tinta pasa a ser la clara", () => {
  it.each(EN_PAPEL.map((f) => [f.id, f] as const))("%s mejora sobre papel blanco", (_id, fila) => {
    const antes = medir(token("oscuro", fila.cual), PAPEL);
    const despues = medir(tokenAlImprimir(fila.cual), PAPEL);

    expect(antes, `${fila.id} — ${fila.que}: la medida de ANTES se movió`).toBe(fila.antes);
    expect(despues, `${fila.id} — ${fila.que}: la medida de DESPUÉS se movió`).toBe(fila.despues);
    expect(
      despues,
      `${fila.id} dejó de cumplir AA sobre papel blanco. Esta ficha existe para que el texto del ` +
        "portal se lea en papel; por debajo de 4.5 no lo hace.",
    ).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * LO QUE ESTA FICHA **NO** ARREGLA, hecho ejecutable para que nadie la lea como «en papel todo
   * cumple». El papel pasa a ser EXACTAMENTE el tema claro, con los límites que ese tema ya tiene
   * en pantalla: `--destructive` y `--primary` son ACENTOS, no texto de lectura, y sobre blanco no
   * llegan a 4.5 ni aquí ni en «claro». Es deuda de PALETA (fichas 210/216), no de esta regla.
   */
  it("LÍMITE: los acentos `--destructive` y `--primary` mejoran pero NO llegan a AA", () => {
    expect(medir(tokenAlImprimir("destructive"), PAPEL)).toBe(3.76);
    expect(medir(tokenAlImprimir("primary"), PAPEL)).toBe(3.18);
    // Y lo que hace honesto al límite: en pantalla, en tema CLARO, miden lo mismo. El papel no
    // empeoró nada; heredó un límite que ya existía.
    expect(medir(token("claro", "destructive"), PAPEL)).toBe(3.76);
    expect(medir(token("claro", "primary"), PAPEL)).toBe(3.18);
    expect(
      crudo,
      "el comentario del bloque dejó de declarar su límite con los números medidos. Un límite que " +
        "sólo vive en un informe no lo lee nadie.",
    ).toMatch(/3\.76[\s\S]{0,200}3\.18/);
  });
});

/**
 * LO QUE ESTA FICHA **EMPEORA**, con caso ejecutable y no como nota al pie.
 *
 * Es el mismo estándar que se le aplicó al límite de arriba, y por honestidad tiene que aplicarse
 * también aquí: hay tinta que se apoyaba en un fondo de color y en papel ese fondo NO se imprime.
 * `--primary-foreground` era `#0a1524` en oscuro —casi negro, legible por ACCIDENTE sobre papel
 * blanco— y pasa a `#ffffff`: blanco sobre blanco, desaparece. Son 15 usos (`Badge` default,
 * `Button` default, `Pagination`, `RankingPodio`).
 *
 * ── POR QUÉ NO SE ARREGLA AQUÍ, y por qué el caso mide las DOS columnas
 * Los mismos pares miden EXACTAMENTE lo mismo imprimiendo desde «claro», hoy y desde antes de esta
 * ficha. O sea: no es una regresión CONTRA el tema claro, es el tema claro. Darles un valor propio
 * en el bloque de impresión rompería el espejo exacto —que es lo que la ficha compra y lo que su
 * guardia exige— y dejaría el papel de «oscuro» mejor que el de «claro». El arreglo de raíz es el
 * patrón de la 208 llevado al papel y toca `Badge`/`Button`/`Pagination`: ficha propia.
 *
 * La segunda columna (`claro`) no es adorno: es la que convierte «esto empeora» en «esto iguala al
 * tema claro». Si algún día dejaran de coincidir, una de las dos afirmaciones sería falsa.
 */
const SE_PIERDE_EN_PAPEL = [
  { id: "P1", que: "`Badge`/`Button` default y `Pagination` (`--primary-foreground`)", cual: "primary-foreground", antes: 18.33, despues: 1 },
  { id: "P2", que: "el ítem activo de la barra lateral (`--sidebar-primary-foreground`)", cual: "sidebar-primary-foreground", antes: 18.21, despues: 1 },
  { id: "P3", que: "los bordes (`--border`)", cual: "border", antes: 12.3, despues: 1.23 },
  { id: "P4", que: "el borde de los campos (`--input`)", cual: "input", antes: 10.29, despues: 1.23 },
] as const;

describe("feature 224 — LO QUE EMPEORA: la tinta que se apoyaba en un fondo que no se imprime", () => {
  it.each(SE_PIERDE_EN_PAPEL.map((f) => [f.id, f] as const))(
    "%s se pierde sobre papel blanco, y es EXACTAMENTE lo que ya hacía el tema claro",
    (_id, fila) => {
      const antes = medir(token("oscuro", fila.cual), PAPEL);
      const despues = medir(tokenAlImprimir(fila.cual), PAPEL);

      expect(antes, `${fila.id} — ${fila.que}: la medida de ANTES se movió`).toBe(fila.antes);
      expect(despues, `${fila.id} — ${fila.que}: la medida de DESPUÉS se movió`).toBe(fila.despues);
      expect(
        despues,
        `${fila.id} dejó de empeorar. Si eso pasó es una buena noticia, pero la prosa del bloque ` +
          "dice lo contrario y hay que reescribirla: un límite retirado que sigue escrito manda a " +
          "buscar un agujero que ya no existe.",
      ).toBeLessThan(antes);

      // LA MITAD QUE LO HACE HONESTO: imprimiendo desde «claro» da el MISMO número. No es una
      // regresión contra el tema claro; es el tema claro, que es lo que esta ficha compra.
      expect(
        medir(token("claro", fila.cual), PAPEL),
        `${fila.id} dejó de coincidir con el tema claro en pantalla. Eso rompe la razón por la que ` +
          "esto se declara en vez de arreglarse aquí: si el papel de «oscuro» y el de «claro» ya " +
          "no miden lo mismo, el espejo dejó de ser exacto y hay que releer el bloque entero.",
      ).toBe(despues);
    },
  );

  it("y queda declarado JUNTO al bloque, con sus números y con por qué no se arregla aquí", () => {
    expect(
      crudo,
      "el comentario del bloque ya no declara que `--primary-foreground` se pierde en papel " +
        "(18.33 → 1.00). Es lo que esta ficha EMPEORA, y una ficha que sólo publica lo que mejora " +
        "no está midiendo: está vendiendo.",
    ).toMatch(/18\.33 → 1\.00/);
    expect(crudo, "falta el segundo par que se pierde entero").toMatch(/18\.21 → 1\.00/);
    expect(
      crudo,
      "falta la RAZÓN por la que no se arregla en este bloque: los mismos pares miden lo mismo " +
        "imprimiendo desde «claro», así que un valor propio aquí rompería el espejo exacto.",
    ).toMatch(/espejo exacto/);
  });
});

describe("feature 224 — con «gráficos de fondo», el par vuelve a ser el del tema claro", () => {
  /**
   * El PRECIO que cobraba la 221, borrado y medido. Si el usuario marca «gráficos de fondo»
   * —desmarcado por defecto—, los cuatro `Badge` imprimen su fondo `-soft` CLARO. Hasta esta ficha
   * la tinta seguía siendo la OSCURA y el par se hundía; ahora las dos mitades son claras.
   */
  it.each(["success", "warning", "danger", "info"] as const)(
    "`Badge` %s imprime su par claro completo, por encima de AA",
    (familia) => {
      const fondo = paleta(`${familia}-soft`);
      const con221 = medir(token("oscuro", `${familia}-strong`), fondo);
      const con224 = medir(tokenAlImprimir(`${familia}-strong`), fondo);

      expect(
        con224,
        `\`Badge\` ${familia} volvió a caer bajo AA con «gráficos de fondo» marcado. Es el precio ` +
          "que la 221 declaró y esta ficha borra: si vuelve, es que la tinta dejó de girar al " +
          "imprimir y el fondo `-soft` no.",
      ).toBeGreaterThanOrEqual(4.5);
      expect(con224).toBeGreaterThan(con221);

      // La prosa no puede separarse del dato: el comentario del bloque anota este mismo par.
      expect(
        crudo,
        `el comentario del bloque ya no anota «${con221.toFixed(2)} → ${con224.toFixed(2)}» para ` +
          `${familia}. Una explicación que describe números que ya no son manda a quien la lea a ` +
          "decidir sobre datos falsos.",
      ).toContain(`${con221.toFixed(2)} → ${con224.toFixed(2)}`);
    },
  );
});
