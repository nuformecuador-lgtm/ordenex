import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { reglasDe, selectoresDe, type Regla } from "../../fixtures/css-reglas";
import { codigoSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 223 — GUARDIA del FLUJO de impresion de la factura del cierre.
 *
 * La 217 puso el COLOR (la hoja sale blanca en papel). Esta pone el FORMATO: `@page`, ocultar lo
 * que no es la hoja, y paginar. Hoy, sin ella, la hoja se imprime RECORTADA.
 *
 * ── LO QUE ESTA GUARDIA AFIRMA, Y SE LLAMA ASI: **verificacion ESTRUCTURAL** (R33)
 * Ninguna pieza del gate imprime. Lo verificado es que la regla EXISTE, DONDE vive, QUE declara,
 * QUE NO declara, que clase lleva cada hoja y que forma tiene el DOM que la regla supone. Que el
 * papel salga bien no lo dice nadie aqui, y no puede decirlo: no hay motor de impresion.
 *
 * ── LO QUE **NO** QUEDA VERIFICADO (declarado por delante, D7/R33)
 *  · El papel. Ni los cortes, ni cuantas paginas salen, ni como fragmenta cada motor un flex.
 *  · Que `@page`, `size: portrait` y la fragmentacion se comporten como aqui se razona.
 *  · La cifra del KPI en el instante de imprimir (R29, limite declarado junto a la pieza).
 * El complemento es UNA comprobacion manual y fechada, fuera del gate (`progress/impl_223.md`).
 *
 * ── LO QUE SI SE PUDO VERIFICAR MEJOR DE LO PREVISTO
 * El diseño daba por hecho que jsdom «no resuelve `:has()`». **Si lo resuelve** (medido, jsdom
 * 29.1.1), asi que la regla de eleccion tiene ademas casos que la EVALUAN contra el DOM real en
 * `tests/components/CierreFacturaPapel.test.tsx`. Eso no es el papel —sigue sin haber motor de
 * impresion, ni cascada, ni medios paginados—, pero si es «a que elementos engancha el selector».
 * Y es lo que caza el fallo mas caro de esta ficha, que un censo de texto no ve.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const TESTS = path.join(RAIZ, "tests");
const GLOBALS = "app/globals.css";

/** El CODIGO del CSS, con la prosa fuera (quitador COMPARTIDO, feature 209 — R30). */
const css = codigoSinComentarios(GLOBALS);
/** El fuente TAL CUAL. SOLO para los casos que exigen que algo este escrito en un COMENTARIO. */
const cssCrudo = readFileSync(path.join(RAIZ, GLOBALS), "utf8");
const reglas = reglasDe(css);

/** La clase de CANDIDATURA de esta ficha. No se reusa `.papel-al-imprimir` (R23). */
const CANDIDATA = "hoja-imprimible";

// ─────────────────────────────────────────────────────────────────────────────────────────
// R32 — UN SOLO parser de reglas CSS en todo `tests/`
// ─────────────────────────────────────────────────────────────────────────────────────────

const FIXTURE_CANONICO = path.join("tests", "fixtures", "css-reglas.ts");

/**
 * La firma de una copia del parser: las tres funciones por su nombre. Es lo que habia dentro de
 * `tema-encendido.guardia.test.ts` hasta esta ficha, y lo que la 223 habria copiado de no
 * extraerlo. Una copia no falla: se desincroniza y una de las dos guardias empieza a describir un
 * archivo que ya no tiene esa forma, en verde.
 */
const FIRMA_DEL_PARSER = [
  /(?:function|const)\s+reglasDe\b/,
  /(?:function|const)\s+selectoresDe\b/,
  /(?:function|const)\s+declaracionesDe\b/,
] as const;

/** Todos los `.ts`/`.tsx` de `tests/`, con su ruta relativa a la raiz del repo. */
function fuentesDeTests(dir = TESTS): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...fuentesDeTests(completo));
    else if (/\.tsx?$/.test(entrada.name)) salida.push(path.relative(RAIZ, completo));
  }
  return salida;
}

const FUENTES = fuentesDeTests();

/** El codigo de un archivo de `tests/`, sin su prosa. */
function codigoDe(relativa: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, relativa), "utf8"));
}

describe("feature 223 — el instrumento: un solo parser de reglas CSS (R32)", () => {
  /**
   * Autocomprobacion del censo. Sin esto, una ruta mal resuelta o un `readdirSync` sobre una
   * carpeta vacia reporta CERO infractores y pasa en verde sin haber mirado nada. Ya paso en este
   * repo con un censo que se desescapaba.
   */
  it("el censo lee de verdad el arbol de `tests/` y encuentra la copia canonica", () => {
    expect(FUENTES.length).toBeGreaterThan(300);
    expect(FUENTES).toContain(FIXTURE_CANONICO);

    const canonico = codigoDe(FIXTURE_CANONICO);
    for (const firma of FIRMA_DEL_PARSER) {
      expect(
        firma.test(canonico),
        `la firma ${firma.source} ya no aparece en ${FIXTURE_CANONICO}: o el parser se movio, o ` +
          "este censo dejo de saber que busca y estaba dando verde sin mirar",
      ).toBe(true);
    }
  });

  it("ningun otro archivo de `tests/` define una segunda copia del parser", () => {
    const copias = FUENTES.filter((relativa) => {
      if (relativa === FIXTURE_CANONICO) return false;
      const codigo = codigoDe(relativa);
      return FIRMA_DEL_PARSER.some((firma) => firma.test(codigo));
    });

    expect(
      copias,
      "el parser de reglas CSS vive en `tests/fixtures/css-reglas.ts` y se IMPORTA. Una segunda " +
        "copia se desincroniza en silencio: es la feature 209 (74 quitadores de comentarios a " +
        "mano, cinco semanticas distintas) repetida con selectores.",
    ).toEqual([]);
  });

  it("la guardia del tema CONSUME el fixture en vez de tener lo suyo", () => {
    const tema = codigoDe(path.join("tests", "unit", "guards", "tema-encendido.guardia.test.ts"));
    expect(tema, "`tema-encendido.guardia.test.ts` dejo de importar el parser compartido").toMatch(
      /from\s+"\.\.\/\.\.\/fixtures\/css-reglas"/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// EL BLOQUE: se localiza por lo que CONTIENE, nunca por su posicion (R24, leccion de la 221)
// ─────────────────────────────────────────────────────────────────────────────────────────

interface BloqueMedia {
  prelude: string;
  cuerpo: string;
  /** Indice del `@` de su apertura dentro del CODIGO del CSS. */
  indice: number;
}

/** Todos los bloques `@media print { … }` del archivo, con su cuerpo y su indice. */
function bloquesMediaPrint(fuente: string): BloqueMedia[] {
  const apertura = /@media\s+print\b[^{}]*\{/g;
  const salida: BloqueMedia[] = [];
  for (let m = apertura.exec(fuente); m; m = apertura.exec(fuente)) {
    const abre = m.index + m[0].length - 1;
    let hondura = 0;
    let i = abre;
    for (; i < fuente.length; i += 1) {
      if (fuente[i] === "{") hondura += 1;
      else if (fuente[i] === "}") {
        hondura -= 1;
        if (hondura === 0) break;
      }
    }
    if (i >= fuente.length) {
      throw new Error(`${GLOBALS} tiene un bloque \`@media print\` sin cerrar`);
    }
    salida.push({ prelude: m[0].slice(0, -1).trim(), cuerpo: fuente.slice(abre + 1, i), indice: m.index });
    apertura.lastIndex = i + 1;
  }
  return salida;
}

const BLOQUES_PRINT = bloquesMediaPrint(css);

/** EL bloque de esta ficha: el `@media print` que habla de la candidatura. */
const bloqueDelFlujo = BLOQUES_PRINT.find((b) => b.cuerpo.includes(CANDIDATA));
/** El de la 217: el que declara los tokens de la hoja. Se localiza igual, por contenido. */
const bloqueDeLos217 = BLOQUES_PRINT.find((b) => b.cuerpo.includes(".papel-al-imprimir"));

/**
 * Las reglas de esta ficha, identificadas POR CONTENIDO: las que hablan de la candidatura mas la
 * `@page`. Asi el censo sigue encontrandolas si alguien mueve el bloque, y NO las encuentra si
 * alguien lo saca de su `@media print` — que es justo la variante inocua de la mutacion 1.
 */
const reglasDelFlujo: Regla[] = reglas.filter(
  (r) => r.selectores.some((s) => s.includes(CANDIDATA)) || r.selectores.includes("@page"),
);

/** La regla que neutraliza la CADENA de ancestros: la unica que declara `display: block`. */
const reglaCadena = reglasDelFlujo.find((r) => r.declaraciones["display"] === "block");
/** La regla que OCULTA: la unica que declara `display: none`. */
const reglaOculta = reglasDelFlujo.find((r) => r.declaraciones["display"] === "none");
/** La `@page` de esta ficha. */
const reglaPage = reglas.filter((r) => r.selectores.includes("@page"));

/**
 * Corta el primer COMPUESTO de un selector: lo que hay antes del primer combinador o espacio de
 * nivel cero. `body:has(.a) > *:not(.b)` -> `body:has(.a)`.
 */
function compuestoInicial(selector: string): string {
  let hondura = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (c === "(" || c === "[") hondura += 1;
    else if (c === ")" || c === "]") hondura -= 1;
    else if (hondura === 0 && /[\s>+~]/.test(c)) return selector.slice(0, i);
  }
  return selector;
}

/** Los argumentos de todos los `:not(…)` de un selector, a cualquier profundidad. */
function argumentosDeNot(selector: string): string[] {
  const salida: string[] = [];
  const re = /:not\(/g;
  for (let m = re.exec(selector); m; m = re.exec(selector)) {
    let hondura = 1;
    let i = m.index + m[0].length;
    for (; i < selector.length && hondura > 0; i += 1) {
      if (selector[i] === "(") hondura += 1;
      else if (selector[i] === ")") hondura -= 1;
    }
    salida.push(selector.slice(m.index + m[0].length, i - 1));
    re.lastIndex = m.index + m[0].length;
  }
  return salida;
}

/**
 * ¿Es `sel` UN SOLO selector simple? Una clase (`.x`), una pseudo-clase (`:has(…)`), un tipo…
 * pero NO un compuesto (`.a[b]`) ni un complejo (`a b`, `a > b`) ni una lista (`a, b`).
 */
function esSimple(sel: string): boolean {
  const s = sel.trim();
  if (!s) return false;
  // Una lista (`a, b`) no es un simple; un complejo (`a b`, `a > b`) tampoco.
  if (selectoresDe(s).length > 1) return false;
  if (compuestoInicial(s) !== s) return false;
  // Consume UN simple desde el principio y comprueba que no queda nada detras: si queda, es un
  // COMPUESTO (`.a[b]`, `div.x`), que es lo otro que estos motores no soportan dentro de `:not()`.
  const uno =
    /^(?:\*|[a-z][a-z0-9-]*|\.[a-zA-Z_][\w-]*|#[a-zA-Z_][\w-]*|\[[^\]]*\]|::?[a-zA-Z-]+(?:\((?:[^()]|\([^()]*\))*\))?)/;
  const m = uno.exec(s);
  return m !== null && m[0].length === s.length;
}

describe("feature 223 — el bloque del flujo existe y vive donde debe (R24, R26)", () => {
  /**
   * Autocomprobacion del censo. Si el localizador dejara de encontrar el bloque, TODOS los casos
   * de abajo medirian `undefined` y podrian pasar por vacuidad. Este caso lo impide.
   */
  it("el censo lee el CODIGO del CSS —no su prosa— y encuentra los DOS bloques", () => {
    expect(css.length).toBeGreaterThan(5000);
    expect(
      cssCrudo,
      "el fuente crudo ya no explica esta ficha: si la prosa se fue, los casos que la exigen " +
        "mediran una cadena vacia",
    ).toMatch(/Feature 223/);
    expect(
      css,
      "el quitador de comentarios no esta pasando: se estaria censando PROSA. El riesgo aqui es " +
        "maximo, porque el comentario de este bloque nombra a proposito `@page`, los margenes y " +
        "las cabeceras repetidas.",
    ).not.toMatch(/Feature 223/);

    expect(bloqueDelFlujo, `no hay ningun \`@media print\` que hable de \`.${CANDIDATA}\``).toBeDefined();
    expect(bloqueDeLos217, "no hay ningun `@media print` con los tokens de la 217").toBeDefined();
    expect(reglaCadena, "no hay ninguna regla que declare `display: block` en el bloque").toBeDefined();
    expect(reglaOculta, "no hay ninguna regla que declare `display: none` en el bloque").toBeDefined();
  });

  /**
   * R24 — el INVARIANTE. Dos bloques, los dos antes de `.dark`.
   *
   * Un tercero, o uno detras de `.dark`, envenena el lector de tokens de pantalla
   * (`tests/fixtures/contraste.ts`): sus hexes claros pasarian a ser los ultimos de la mitad
   * «oscuro» y TODAS las comprobaciones de tema oscuro medirian el tema claro, EN VERDE.
   */
  it("hay EXACTAMENTE dos `@media print` y los dos van ANTES de `.dark`", () => {
    expect(
      BLOQUES_PRINT.map((b) => b.prelude),
      "el archivo dejo de tener exactamente dos bloques `@media print` (color de la 217 + flujo " +
        "de la 223). Un tercero es un sitio mas donde puede colarse un token de impresion.",
    ).toEqual(["@media print", "@media print"]);

    const oscuro = css.search(/^\.dark[,\s{]/m);
    expect(oscuro, "no se encontro el selector `.dark` a principio de linea").toBeGreaterThan(-1);
    for (const bloque of BLOQUES_PRINT) {
      expect(
        bloque.indice,
        "un bloque `@media print` quedo DESPUES de `.dark`: si algun dia declara un hex, " +
          '`token("oscuro", …)` empezaria a devolverlo y el gate mediria el tema equivocado.',
      ).toBeLessThan(oscuro);
    }
  });

  /**
   * El orden entre los dos, que `design.md §2.1` elige y explica. Ya NO es la defensa —la defensa
   * es que los anclajes dejaron de ser posicionales (R24)— pero sigue siendo la colocacion
   * decidida, y una decision que nadie vigila se deshace sola.
   */
  it("el bloque del flujo va DESPUES del bloque de tokens de la 217", () => {
    expect(bloqueDelFlujo!.indice).toBeGreaterThan(bloqueDeLos217!.indice);
  });

  /**
   * R26 — fuera de toda capa. Dentro de un `@layer`, este bloque COMPILARIA, no romperia nada y
   * dejaria de hacer su trabajo: las utilidades de Tailwind viven en `@layer utilities` y le
   * ganarian. Es el modo de fallo mas silencioso de esta ficha.
   */
  it("las reglas del bloque cuelgan de `@media print` y de NINGUN `@layer`", () => {
    expect(reglasDelFlujo.length, "el censo no encontro ninguna regla del flujo").toBeGreaterThan(3);
    for (const regla of reglasDelFlujo) {
      const ancestros = regla.ancestros.join(" | ");
      expect(
        ancestros,
        `la regla \`${regla.selectores[0]}\` no vive dentro de \`@media print\`: aplicaria EN ` +
          "PANTALLA, y lo primero que haria seria esconder media aplicacion.",
      ).toMatch(/@media\s+print\b/);
      expect(
        ancestros,
        `la regla \`${regla.selectores[0]}\` quedo dentro de un \`@layer\`: ahi la vence ` +
          "cualquier utilidad de Tailwind y el bloque deja de hacer nada, en verde.",
      ).not.toMatch(/@layer/);
    }
  });

  /** R23 — lo de la 217 no se toca, y este bloque NO reusa su selector. */
  it("el bloque del flujo no nombra `.papel-al-imprimir` ni declara ningun token", () => {
    expect(
      bloqueDelFlujo!.cuerpo,
      "el bloque nuevo reusa `.papel-al-imprimir`. Hay una guardia que exige EXACTAMENTE una " +
        "regla con ese selector y que compara sus declaraciones con `.tema-claro`: romperla no " +
        "señalaria ningun defecto real.",
    ).not.toContain("papel-al-imprimir");

    // R25 — cero propiedades personalizadas. `quitarBloquesDeImpresion()` borra toda at-rule que
    // nombre `print` antes de leer los tokens de PANTALLA: un token declarado aqui desapareceria
    // del lector y las medidas pasarian a medir otra cosa, en verde.
    expect(
      bloqueDelFlujo!.cuerpo.match(/--[a-z0-9-]+\s*:/gi) ?? [],
      "hay una propiedad personalizada dentro del bloque del flujo",
    ).toEqual([]);
    for (const regla of reglasDelFlujo) {
      expect(
        Object.keys(regla.declaraciones).filter((k) => k.startsWith("--")),
        `la regla \`${regla.selectores[0]}\` declara un token`,
      ).toEqual([]);
    }
  });
});

describe("feature 223 — `@page`: orientacion y margen, y nada mas (R15, R16)", () => {
  it("hay EXACTAMENTE una `@page` y vive dentro de `@media print`", () => {
    expect(
      reglaPage.length,
      "se esperaba una sola `@page` en todo el archivo. Suelta —fuera del `@media print`— " +
        "sobrevive al lector de tokens, y repetida deja dos formatos compitiendo.",
    ).toBe(1);
    expect(reglaPage[0]!.ancestros.join(" | ")).toMatch(/@media\s+print\b/);
  });

  it("declara `size` con ORIENTACION y sin nombre de papel (D2)", () => {
    expect(
      reglaPage[0]!.declaraciones["size"],
      "forzar un papel que no es el cargado hace que el navegador reescale y encoja el texto. " +
        "El papel lo decide quien imprime; aqui solo se declara la orientacion.",
    ).toBe("portrait");
  });

  it("el margen es 12mm, esta en UN solo sitio y no es cero (D3)", () => {
    expect(
      reglaPage[0]!.declaraciones["margin"],
      "`margin: 0` hace que la hoja pierda texto por el borde fisico en cuanto la impresora no " +
        "sea la de quien lo escribio: las de oficina tienen 3-5 mm no imprimibles.",
    ).toBe("12mm");
    expect(
      bloqueDelFlujo!.cuerpo.match(/\bmargin:\s*12mm\b/g) ?? [],
      "el margen dejo de estar en un solo sitio: cambiarlo manana tiene que ser UNA linea",
    ).toHaveLength(1);
  });

  it("no declara nada mas: `@page` no es el sitio de la maquetacion", () => {
    expect(Object.keys(reglaPage[0]!.declaraciones).sort()).toEqual(["margin", "size"]);
  });
});

describe("feature 223 — la cadena de ancestros deja de recortar (R10, R11, R13, R14)", () => {
  /**
   * R10 — la lista es CERRADA. Quitar cualquiera de las trece pone esto rojo, y cada una tiene
   * escrito a quien le quita que en el comentario del bloque.
   */
  const LISTA_CERRADA = [
    "overflow",
    "max-height",
    "height",
    "position",
    "inset",
    "transform",
    "width",
    "max-width",
    "padding",
    "border",
    "box-shadow",
    "background",
    // R14 — la decimotercera: saca de la ruta de fragmentacion los contenedores flex. Es segura
    // PORQUE R1 la hace segura: tras el ocultamiento cada ancestro tiene un solo hijo visible.
    "display",
  ] as const;

  it("declara las TRECE propiedades de la lista cerrada", () => {
    for (const propiedad of LISTA_CERRADA) {
      expect(
        reglaCadena!.declaraciones[propiedad],
        `la regla de la cadena dejo de declarar \`${propiedad}\`. La lista de R10 es CERRADA: ` +
          "cada una neutraliza un contenedor concreto de la ruta hasta la hoja, y sin ella la " +
          "hoja vuelve a salir recortada sin que nada mas cambie.",
      ).toBeDefined();
    }
  });

  it("y NADA fuera de esa lista, salvo el `margin` declarado", () => {
    expect(Object.keys(reglaCadena!.declaraciones).sort()).toEqual(
      [...LISTA_CERRADA, "margin"].sort(),
    );
  });

  /**
   * R11 — generico, no por contenedor conocido. Las dos rutas que montan la hoja NO tienen los
   * mismos contenedores (la del admin trae uno mas), asi que una regla que nombrara uno arreglaria
   * como mucho una de las dos.
   */
  it("recorre la cadena sin nombrar ningun contenedor, y sin nombrar ninguna pieza del portal (R3)", () => {
    const PIEZAS = /sidebar|header|footer|modal|backdrop|toast|navbar|drawer|popover|tooltip/i;
    for (const regla of reglasDelFlujo) {
      for (const selector of regla.selectores) {
        expect(
          selector,
          `el selector \`${selector}\` nombra una pieza de la aplicacion. Esto es una LISTA ` +
            "BLANCA: se decide por PERTENENCIA a la hoja elegida, no enumerando lo que hay que " +
            "esconder. Una lista negra se queda corta con cada componente nuevo, y en silencio.",
        ).not.toMatch(PIEZAS);
      }
    }
    expect(reglaCadena!.selectores).toEqual([
      "body:has(.hoja-imprimible)",
      "body:has(.hoja-imprimible) *:has(.hoja-imprimible)",
    ]);
  });

  /**
   * R13 — `!important` SOLO donde compite un estilo en linea, y con su nombre.
   *
   * La lista NO se adivino: se MIDIO (2026-08-14, `progress/impl_223.md` T4). `@base-ui/react`
   * bloquea el scroll escribiendo `position/height/width/overflow` EN LINEA sobre el `<body>`, que
   * es el primer eslabon de esta cadena. Sin `!important` la declaracion esta escrita y PIERDE:
   * un fallo que ningun censo de texto veria.
   */
  const CON_IMPORTANTE = ["height", "max-width", "overflow", "position", "width"] as const;

  it("lleva `!important` EXACTAMENTE en las cinco declaraciones que compiten con un estilo en linea", () => {
    const conImportante = Object.entries(reglaCadena!.declaraciones)
      .filter(([, valor]) => /!important/.test(valor))
      .map(([nombre]) => nombre)
      .sort();

    expect(
      conImportante,
      "la lista de `!important` cambio. Cada uno tiene su rival EN LINEA medido: `max-width` " +
        "contra el `style={{maxWidth}}` del popup, y `overflow`/`position`/`height`/`width` " +
        "contra el bloqueo de scroll que el dialogo escribe sobre el `<body>`. Uno de menos y la " +
        "hoja sale recortada con la declaracion escrita; uno de mas es un martillo que rompe " +
        "excepciones legitimas futuras.",
    ).toEqual([...CON_IMPORTANTE]);

    expect(
      bloqueDelFlujo!.cuerpo.match(/!important/g) ?? [],
      "aparecio un `!important` fuera de la regla de la cadena",
    ).toHaveLength(CON_IMPORTANTE.length);
  });

  /**
   * R14 — si un elemento cayera en las dos reglas, manda OCULTAR. Pasa de verdad: el envoltorio de
   * la app contiene candidatas (las compactas de detras) pero no la elegida, asi que casa con la
   * cadena Y con el ocultamiento. Gana por orden y por especificidad; aqui se comprueba el orden,
   * que es la mitad que se puede leer de un archivo.
   */
  it("la regla que OCULTA va DESPUES de la que dispone la cadena", () => {
    const cuerpo = bloqueDelFlujo!.cuerpo;
    const bloque = cuerpo.indexOf("display: block");
    const ninguno = cuerpo.indexOf("display: none");
    expect(bloque, "no se encontro `display: block` en el bloque").toBeGreaterThan(-1);
    expect(ninguno, "no se encontro `display: none` en el bloque").toBeGreaterThan(-1);
    expect(
      bloque,
      "el ocultamiento quedo ANTES de la disposicion de la cadena: un ancestro que contiene " +
        "candidatas pero no la elegida volveria a `display: block` y se imprimiria entero.",
    ).toBeLessThan(ninguno);
  });
});

describe("feature 223 — que llega al papel: la regla de eleccion (R1, R2, R6, R7, R8)", () => {
  /**
   * R2 / R7 — EL caso que evita la pagina en blanco, y es el fallo mas caro de la ficha.
   *
   * Si un solo selector de ocultamiento perdiera su guarda `:has(…)` a nivel de `body`, la regla
   * aplicaria en CUALQUIER pagina del portal y esa pagina se imprimiria VACIA. Ninguna pantalla lo
   * mostraria: el sintoma sale en papel, y en papel no mira el gate.
   */
  it("TODOS los selectores de ocultamiento llevan su guarda `:has(.hoja-imprimible)` en el `body`", () => {
    expect(reglaOculta!.selectores.length, "la regla de ocultamiento se quedo sin selectores")
      .toBeGreaterThanOrEqual(5);

    for (const selector of reglaOculta!.selectores) {
      const cabeza = compuestoInicial(selector);
      expect(
        cabeza,
        `el selector \`${selector}\` no arranca en el \`body\`: sin ese ancla el ocultamiento ` +
          "puede engancharse a cualquier subarbol",
      ).toMatch(/^body/);
      expect(
        cabeza,
        `el selector \`${selector}\` perdio su guarda \`:has(.${CANDIDATA})\` en el \`body\`. ` +
          "Sin ella, CUALQUIER pagina del portal —sin ninguna hoja— se imprimiria EN BLANCO, y " +
          "no hay pantalla que lo muestre.",
      ).toMatch(new RegExp(`:has\\([^)]*${CANDIDATA}`));
    }
  });

  /** R6 nivel 1 — la hoja del dialogo gana, y poda las N de detras por su ancestro. */
  it("existe la rama de NIVEL 1, anclada en `[role=\"dialog\"] .hoja-imprimible`", () => {
    const nivel1 = reglaOculta!.selectores.filter((s) =>
      compuestoInicial(s).includes(`:has([role="dialog"] .${CANDIDATA})`),
    );
    expect(
      nivel1.length,
      "desaparecio la rama de nivel 1. Sin ella, imprimir el detalle arrastra al papel las N " +
        "hojas compactas que estan detras del modal.",
    ).toBeGreaterThanOrEqual(3);
  });

  /** R6 nivel 2 — sin candidata en un dialogo, cada candidata es un documento. */
  it("existe la rama de NIVEL 2, anclada en `:not(:has([role=\"dialog\"] …))`", () => {
    const nivel2 = reglaOculta!.selectores.filter((s) =>
      compuestoInicial(s).includes(`:not(:has([role="dialog"] .${CANDIDATA}))`),
    );
    expect(
      nivel2.length,
      "el nivel 2 perdio su predicado exacto. Con `:not(:has(.hoja-imprimible))` la regla EXISTE, " +
        "esta escrita… y no aplica nunca; sin el `:not` entero, aplica siempre y se llevan al " +
        "papel las N hojas de detras del modal. Las dos formas son verdes para un censo ingenuo.",
    ).toBe(2);
  });

  /**
   * ⚠️ EL DESLIZ DEL DISEÑO, CONGELADO PARA QUE NO VUELVA.
   *
   * `design.md §3.4` escribia la segunda rama de A.1 sin su segundo `:not()`. Con esa forma, el
   * PROPIO POPUP casa con `*:not(:has([role="dialog"] …))` —porque `E:has(A B)` exige que `A` sea
   * descendiente de `E`, y el popup ES el dialogo, no lo contiene— y se oculta el dialogo entero:
   * la pagina sale EN BLANCO. Medido sobre el DOM real en `CierreFacturaPapel.test.tsx`, que es
   * quien de verdad lo caza; esto congela ademas la forma escrita.
   */
  it("la rama que poda la CADENA hasta el dialogo conserva su segundo `:not(:has(…))`", () => {
    const rama = reglaOculta!.selectores.find(
      (s) => s.includes(`*:has([role="dialog"] .${CANDIDATA})`) && s.includes(">"),
    );
    expect(rama, "desaparecio la rama que poda la cadena de ancestros hasta el dialogo").toBeDefined();
    expect(
      rama,
      "esta rama volvio a la forma de `design.md §3.4`, que OCULTA EL PROPIO DIALOGO: el popup no " +
        "CONTIENE un `[role=\"dialog\"]`, lo ES. El resultado impreso no es una hoja recortada, es " +
        "una pagina en blanco.",
    ).toContain(`:not(:has(.${CANDIDATA}))`);
  });

  /** R8 — varias elegidas: cada una a partir de la segunda empieza en pagina nueva. */
  it("una hoja por pagina cuando hay varias: `~` entre candidatas con `break-before: page`", () => {
    const hermanas = reglasDelFlujo.find((r) =>
      r.selectores.some((s) => /\.hoja-imprimible\s*~\s*\.hoja-imprimible/.test(s)),
    );
    expect(
      hermanas,
      "sin la regla `~`, dos comprobantes desplegados salen pegados en la misma pagina",
    ).toBeDefined();
    expect(hermanas!.declaraciones["break-before"]).toBe("page");
  });

  /** R18 — la hoja deja de recortarse a si misma: las dos `<Card>` traen `overflow-hidden`. */
  it("la hoja elegida deja de recortarse a si misma (`overflow: visible`)", () => {
    const hoja = reglasDelFlujo.find((r) => r.selectores.includes(`.${CANDIDATA}`));
    expect(hoja, "no hay ninguna regla que trate a la hoja en si").toBeDefined();
    expect(
      hoja!.declaraciones["overflow"],
      "un contenedor de scroll es INFRAGMENTABLE para la especificacion de fragmentacion: con el " +
        "`overflow-hidden` de la `<Card>` vivo, un cierre largo se corta en seco en vez de " +
        "continuar en la pagina siguiente",
    ).toBe("visible");
  });

  /**
   * §3.4-1 — dentro de todos los `:not()`, SOLO selectores simples. Hay motores que soportan
   * `:has()` y no soportan `:not()` con compuestos o complejos: si uno de estos selectores fuera
   * invalido, el motor descarta LA REGLA ENTERA —los cinco selectores— y con ella el ocultamiento.
   */
  /**
   * Autocomprobacion del predicado. Un `esSimple` que devolviera `true` siempre —o un
   * `argumentosDeNot` que no encontrara ninguno— dejaria el caso de abajo verde sin mirar nada.
   * Es exactamente el fallo que este repo cerro nueve veces.
   */
  it("el predicado de «selector simple» distingue de verdad simples de compuestos y complejos", () => {
    for (const simple of [".x", ":has(.x)", ':has([role="dialog"] .x)', "*", "div", "[hidden]"]) {
      expect(esSimple(simple), `${simple} deberia contar como simple`).toBe(true);
    }
    for (const no of [".a[b]", "div.x", "a b", "a > b", "a, b", ":has(.a) .b", ""]) {
      expect(esSimple(no), `${no} NO deberia contar como simple`).toBe(false);
    }
    // Y que el extractor encuentra los `:not()` que hay: si devolviera [], el caso pasa vacio.
    const todos = reglaOculta!.selectores.flatMap(argumentosDeNot);
    expect(todos.length, "no se extrajo ningun `:not()` de la regla de ocultamiento").toBeGreaterThan(7);
  });

  it("ningun `:not()` del bloque lleva un selector compuesto ni complejo", () => {
    for (const regla of reglasDelFlujo) {
      for (const selector of regla.selectores) {
        for (const argumento of argumentosDeNot(selector)) {
          expect(
            esSimple(argumento),
            `\`:not(${argumento})\` no es un selector simple, y en el motor que no lo soporte se ` +
              "cae la regla ENTERA: se imprimiria todo, como antes de esta ficha",
          ).toBe(true);
        }
      }
    }
  });
});

describe("feature 223 — lo que el bloque declara junto a si mismo (R4, R17, R21, R22)", () => {
  /**
   * El comentario ATADO al bloque, con el mismo patron que la 217 ya exige para su limite: el
   * bloque `/* … *\/` que precede inmediatamente a la regla. Un limite que solo vive en un spec es
   * un limite que el siguiente no va a leer.
   *
   * Se lee del fuente CRUDO a proposito —es lo unico de este archivo que se lee asi— porque lo que
   * se exige ES un comentario. Los censos de CODIGO de arriba usan el fuente ya limpio.
   */
  const comentarioDelBloque = (() => {
    const lineasCrudas = cssCrudo.split("\n");
    const lineasCodigo = css.split("\n");
    expect(lineasCodigo.length).toBe(lineasCrudas.length);
    const linea = css.slice(0, bloqueDelFlujo!.indice).split("\n").length - 1;
    let i = linea - 1;
    while (i >= 0 && lineasCrudas[i]!.trim() === "") i -= 1;
    const fin = i;
    while (i >= 0 && !lineasCrudas[i]!.trimStart().startsWith("/*")) i -= 1;
    return { texto: lineasCrudas.slice(Math.max(0, i), fin + 1).join("\n"), cierra: lineasCrudas[fin]?.trim() };
  })();

  it("el bloque lleva un comentario PEGADO encima", () => {
    expect(
      comentarioDelBloque.cierra,
      "el bloque del flujo no lleva un comentario pegado encima. Todo lo que declara —el limite " +
        "de `@page`, lo que deja de imprimirse, lo que no se promete— tiene que estar AHI, no en " +
        "`specs/`.",
    ).toBe("*/");
    expect(comentarioDelBloque.texto.length).toBeGreaterThan(1000);
  });

  /** R17 — lo que `@page` NO controla. Una regla que promete lo que no puede manda a buscar bugs. */
  it.each([
    ["el encabezado y el pie del navegador", /encabezado/i, /pie/i],
    ["la escala", /escala/i, /escala/i],
    ["los graficos de fondo", /gr[aá]ficos de fondo/i, /gr[aá]ficos de fondo/i],
    ["el papel que elige el usuario", /papel/i, /reescal/i],
  ])("declara que `@page` no controla %s (R17)", (_que, patron, segundo) => {
    expect(comentarioDelBloque.texto).toMatch(patron);
    expect(comentarioDelBloque.texto).toMatch(segundo);
  });

  /** R21 — las cabeceras de columna repetidas NO se prometen: la lista no es una tabla. */
  it("declara que las cabeceras de columna NO se repiten por pagina, y por que (R21)", () => {
    expect(comentarioDelBloque.texto).toMatch(/cabeceras de columna/i);
    expect(
      comentarioDelBloque.texto,
      "falta la RAZON: la lista de ordenes no es una tabla, es una rejilla de `<span>`, asi que " +
        "`table-header-group` no aplica. Sin la razon, el siguiente lo lee como un olvido.",
    ).toMatch(/no es una tabla/i);
  });

  /** R22 / D4 — lo que no esta montado no se imprime. */
  it("declara que lo plegado y las pestañas no visitadas NO se imprimen (R22)", () => {
    expect(comentarioDelBloque.texto).toMatch(/plegad/i);
    expect(comentarioDelBloque.texto).toMatch(/pesta[nñ]as no visitadas/i);
    expect(comentarioDelBloque.texto).toMatch(/DOM/);
  });

  /**
   * R4 — la contramedida al modo de fallo de la lista blanca: lo que DEJA de imprimirse va
   * enumerado con su ancla, en el codigo. Un ocultamiento por pertenencia puede tragarse algo que
   * si debia salir, y esta lista es donde se mira primero.
   */
  it.each([
    ["los botones y el fondo del dialogo", /Modal\.tsx/],
    ["el pago al mensajero y la botonera de decision", /CierresAdminModule\.tsx/],
    ["la nota del portal del mensajero", /CierreDiaModule\.tsx/],
    ["la barra lateral y la cabecera del portal", /layout\.tsx/],
  ])("enumera, con su ancla, que deja de imprimirse: %s (R4)", (_que, ancla) => {
    expect(comentarioDelBloque.texto).toMatch(ancla);
  });

  /** R13 — el motivo de cada `!important`, escrito junto a la regla y no solo en el spec. */
  it("declara por que hay `!important` y contra que compite cada uno (R13)", () => {
    expect(comentarioDelBloque.texto).toMatch(/!important/);
    expect(comentarioDelBloque.texto).toMatch(/en l[ií]nea/i);
    expect(
      comentarioDelBloque.texto,
      "falta el hecho MEDIDO que obliga a cuatro de los cinco: el dialogo bloquea el scroll con " +
        "estilos en linea sobre el `<body>`",
    ).toMatch(/scroll/i);
  });
});
