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

/** Los CUATRO caminos por los que entran los tokens OSCUROS. Cada uno necesita su gemelo. */
const SELECTORES_OSCUROS = [
  ".dark",
  "body:has(> .dark)",
  ".tema-sistema",
  "body:has(> .tema-sistema)",
] as const;

/** La regla de esta ficha: la única dentro de `@media print` que nombra `.dark`. */
const impresion = reglas.filter(
  (r) =>
    r.ancestros.some((a) => /^@media\s+print\b/.test(a)) &&
    r.selectores.some((s) => /(^|[\s>+~])(html\s+)?\.dark\b/.test(s)),
);

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
  return atReglaQueContiene(css, new RegExp(`^\\s*${primero}\\s*[,{]`, "m")).indice;
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

  it("cubre los CUATRO selectores por los que entran los tokens oscuros", () => {
    for (const oscuro of SELECTORES_OSCUROS) {
      const gemelo = impresion[0]!.selectores.filter((s) => s === oscuro || s.endsWith(` ${oscuro}`));
      expect(
        gemelo,
        `el bloque de impresión no cubre \`${oscuro}\`. Los tokens oscuros entran por CUATRO ` +
          "caminos —la clase explícita, el `<body>` que la espeja, y los dos de «sistema»— y basta " +
          "que falte uno para que media app siga imprimiendo en oscuro.",
      ).toHaveLength(1);
    }
    expect(
      impresion[0]!.selectores,
      "el bloque de impresión enganchó un selector de más: cada uno tiene que ser el gemelo de " +
        "uno de los cuatro caminos, no una superficie nueva.",
    ).toHaveLength(SELECTORES_OSCUROS.length);
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
   * MUERDE, comprobado plantando las mutaciones (ver `progress/impl_224.md`):
   *  · quitar el `html ` de los cuatro selectores → rojo aquí (empate, no gana).
   *  · quitar el `html ` de UNO solo → rojo, con el nombre del camino que dejó de ganar.
   */
  it("cada selector de impresión le gana en especificidad al que redeclara los tokens oscuros", () => {
    const orden = indiceDelBloque() > css.search(/^\.dark[,\s{]/m);
    expect(
      orden,
      "el bloque de impresión pasó a estar DESPUÉS de `.dark`. Entonces ganaría por orden, sí, " +
        "pero envenena el lector de tokens de pantalla: hay dos guardias más que lo prohíben. Si " +
        "de verdad se movió a propósito, hay que releer las tres a la vez.",
    ).toBe(false);

    for (const oscuro of SELECTORES_OSCUROS) {
      const gemelo = impresion[0]!.selectores.find((s) => s === oscuro || s.endsWith(` ${oscuro}`))!;
      const suyo = especificidadDe(gemelo);
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
    const oscuro = css.search(/^\.dark[,\s{]/m);
    // El espejo de «sistema» se localiza por lo que CONTIENE, no por el primer
    // `prefers-color-scheme` del archivo: el primero es la rama del `@custom-variant dark`, 500
    // líneas más arriba, y anclar ahí dejaba este caso comparando contra otra cosa (medido).
    const sistema = atReglaQueContiene(css, /^\s*\.tema-sistema\s*,/m).indice;
    expect(oscuro, "no se encontró el selector `.dark` a principio de línea").toBeGreaterThan(-1);
    expect(sistema, "no se encontró el espejo `prefers-color-scheme: dark`").toBeGreaterThan(-1);
    expect(bloque).toBeLessThan(oscuro);
    expect(bloque).toBeLessThan(sistema);
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
