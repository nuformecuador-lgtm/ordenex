import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  componer,
  contraste,
  paleta,
  partirPorTema,
  quitarBloquesDeImpresion,
  token,
} from "../../fixtures/contraste";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * Feature 217 — GUARDIA de la hoja de la factura del cierre.
 *
 * ── QUÉ VIGILA, EN TRES PARTES
 *  1. **El instrumento** (esta tanda): que la aritmética de contraste viva en UN solo sitio y que
 *     ninguna medición de esta ficha se apoye en una herramienta sin autocontroles.
 *  2. **El censo de fuente** de `cierre-factura.tsx`: cero tinta de valor fijo, cero pin de tema,
 *     la clase de impresión estampada en las dos hojas.
 *  3. **El inventario CERRADO de pares (tinta, fondo)** de las dos hojas, medido en los dos temas.
 *
 * ── LO QUE NO AFIRMA
 * Nada de aquí dice «se ve bien». No hay navegador, no se compone un estilo ni se resuelve una
 * cascada: se leen literales de `app/globals.css` y cadenas de clases de un `.tsx`. Su verde
 * significa «los pares DECLARADOS cumplen» y «no hay ninguna utilidad de color sin declarar»,
 * que es justamente lo que se puede sostener sin mentir.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const TESTS = path.join(RAIZ, "tests");

/**
 * EL sitio donde vive la aritmética. Es el único archivo de `tests/` al que se le permite tener
 * la fórmula: los demás la importan de aquí.
 */
const FIXTURE_CANONICO = path.join("tests", "fixtures", "contraste.ts");

/**
 * La firma de una copia de la fórmula de contraste de WCAG: los dos coeficientes de luminancia y
 * el `+ 0.05` de la razón.
 *
 * Se barre el CÓDIGO, con los comentarios ya fuera (quitador compartido, feature 209). No es un
 * detalle: la prosa de este árbol NOMBRA a propósito lo que el código tiene prohibido —esta misma
 * guardia explica arriba qué firma busca—, así que un barrido sobre el texto crudo denuncia la
 * EXPLICACIÓN y obliga a borrarla para pasar. Medido aquí: sin el quitador, este archivo se
 * denunciaba a sí mismo por su propio comentario.
 */
const FIRMA_DE_LA_FORMULA = [/0\.2126/, /0\.7152/, /\+\s*0\.05/] as const;

/**
 * El detector de `.claude/skills/impeccable/scripts/detector/`, expresamente DESCARTADO por la
 * puerta humana de la 217 (D9): no tiene autocontroles y no corre en el gate. La jornada del
 * 2026-08-13 acumuló tres mediciones falsas de herramientas que rellenan lo que no saben, una de
 * ellas sobre una cifra de dinero.
 */
const MEDIDOR_PROHIBIDO = /\.claude[\\/]+skills[\\/]+impeccable/;

/** Todos los `.ts`/`.tsx` de `tests/`, con su ruta relativa a la raíz del repo. */
function fuentesDeTests(dir = TESTS): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      salida.push(...fuentesDeTests(completo));
    } else if (/\.tsx?$/.test(entrada.name)) {
      salida.push(path.relative(RAIZ, completo));
    }
  }
  return salida;
}

const FUENTES = fuentesDeTests();

/** El código de un archivo de `tests/`, sin su prosa. */
function codigoDe(relativa: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, relativa), "utf8"));
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// La hoja: el archivo que se censa
// ─────────────────────────────────────────────────────────────────────────────────────────

const HOJA = path.join("app", "(app)", "cierres-admin", "_components", "cierre-factura.tsx");

/** El fuente TAL CUAL, prosa incluida. Sólo para lo que R19 prohíbe también en los comentarios. */
const hojaCruda = readFileSync(path.join(RAIZ, HOJA), "utf8");

/**
 * El CÓDIGO de la hoja, con la prosa fuera (quitador compartido, feature 209). Un censo de
 * prohibiciones sobre el texto crudo denuncia la EXPLICACIÓN y obliga a borrarla para pasar: la
 * cabecera de este archivo explica a propósito, y con su nombre, lo que el código no puede hacer.
 */
const hoja = quitarComentarios(hojaCruda);

/** Cuántas veces aparece `patron` en `texto`. */
function cuantas(texto: string, patron: RegExp): number {
  return (texto.match(new RegExp(patron.source, patron.flags.includes("g") ? patron.flags : patron.flags + "g")) ?? []).length;
}

/**
 * Las utilidades de color de VALOR FIJO: las que no giran con el tema. Son las que la 217 vino a
 * sacar de esta hoja, y la lista está abierta hacia arriba a propósito —cualquier hex arbitrario
 * (`text-[#0b2545]`) es una forma de escribirlas a mano—.
 *
 * EXCEPCIÓN DECLARADA: `brand`. `--color-brand` es fijo y no tiene variante por tema, pero sus
 * tres usos en las hojas no son texto que haya que leer sobre un fondo:
 *   · el wordmark «Ordenex» — texto de una MARCA, exento por WCAG 1.4.3;
 *   · la franja de marca del detalle — `aria-hidden`, decorativa, sin texto;
 *   · el borde superior de la hoja compacta — decorativo, sin texto.
 * Va escrita aquí, con su motivo, y no como un agujero silencioso en la expresión regular: los
 * tres figuran además en el inventario de pares MARCADOS COMO EXENTOS, no ausentes.
 */
const PREFIJOS = "(?:text|bg|border|border-[trbl]|ring|fill|stroke|divide|from|via|to)";
const UTILIDADES_FIJAS = new RegExp(
  `\\b${PREFIJOS}-(?:navy(?:-deep)?|asfalto-\\d|kraft-[a-z]+|hivis|white)\\b|\\b${PREFIJOS}-\\[#`,
  "g",
);

describe("feature 217 — el instrumento de medida: una sola aritmética (R25, R26)", () => {
  /**
   * Autocomprobación del propio censo. Sin esto, un barrido que no lea ningún archivo —una ruta
   * mal resuelta, un `readdirSync` sobre una carpeta vacía— reporta CERO infractores y pasa en
   * verde sin haber mirado nada. Ya pasó en este repo con un censo que se desescapaba.
   */
  it("el censo lee de verdad el árbol de `tests/` y encuentra la copia canónica", () => {
    expect(FUENTES.length).toBeGreaterThan(300);
    expect(FUENTES).toContain(FIXTURE_CANONICO);

    const canonico = codigoDe(FIXTURE_CANONICO);
    for (const firma of FIRMA_DE_LA_FORMULA) {
      expect(
        firma.test(canonico),
        `la firma ${firma.source} ya no aparece en ${FIXTURE_CANONICO}: o la fórmula se movió, ` +
          "o este censo dejó de saber qué busca y estaba dando verde sin mirar",
      ).toBe(true);
    }
  });

  it("ningún otro archivo de `tests/` tiene una segunda copia de la fórmula de contraste", () => {
    const copias = FUENTES.filter((relativa) => {
      if (relativa === FIXTURE_CANONICO) return false;
      const codigo = codigoDe(relativa);
      return FIRMA_DE_LA_FORMULA.some((firma) => firma.test(codigo));
    });

    expect(
      copias,
      "la aritmética de contraste vive en `tests/fixtures/contraste.ts` y se IMPORTA. Una segunda " +
        "copia se desincroniza en silencio: es la feature 209 (74 quitadores de comentarios a " +
        "mano, cinco semánticas distintas) repetida con números.",
    ).toEqual([]);
  });

  /**
   * La PRIMERA de las dos defensas contra la trampa del lector, probada por su cuenta.
   *
   * Hoy, con el bloque de impresión colocado antes de `.dark`, `quitarBloquesDeImpresion` es un
   * **no-op sobre el archivo real**: borrarlo entero no pondría nada rojo. Las dos defensas sólo
   * se podían ver fallar JUNTAS, así que cada una se podía retirar sola en silencio. La segunda
   * —que el bloque siga antes de `.dark`— tiene su caso en `tema-encendido.guardia.test.ts`;
   * ésta tiene el suyo aquí, sobre un CSS de laboratorio que reproduce el escenario que se teme:
   * el bloque de impresión AL FINAL del archivo, que es donde uno añade cosas.
   */
  it("`quitarBloquesDeImpresion` desactiva la trampa del lector aunque el bloque quede al final", () => {
    const cssDeLaboratorio = [
      ":root, .tema-claro {",
      "  --foreground: #12233f;",
      "  --card: #ffffff;",
      "}",
      ".dark, body:has(> .dark) {",
      "  --foreground: #e6ecf8;",
      "  --card: #10203a;",
      "}",
      "@media print {",
      "  .papel-al-imprimir {",
      "    --foreground: #12233f;",
      "    --card: #ffffff;",
      "  }",
      "}",
      "",
    ].join("\n");

    // Sin la pasada: los hexes CLAROS del bloque de impresión caen en la mitad «oscuro» y ganan
    // por ser los últimos. Esto es la trampa, reproducida.
    const envenenado = partirPorTema(cssDeLaboratorio).oscuro;
    expect(
      [...envenenado.matchAll(/--card:\s*(#[0-9a-f]{6})/gi)].at(-1)?.[1],
      "el CSS de laboratorio ya no reproduce la trampa: este caso dejó de probar nada",
    ).toBe("#ffffff");

    // Con la pasada: el bloque de impresión desaparece antes de partir, y el último `--card` de
    // la mitad «oscuro» vuelve a ser el oscuro de verdad.
    const limpio = partirPorTema(quitarBloquesDeImpresion(cssDeLaboratorio)).oscuro;
    expect(
      [...limpio.matchAll(/--card:\s*(#[0-9a-f]{6})/gi)].at(-1)?.[1],
      "`quitarBloquesDeImpresion` dejó pasar el bloque de impresión: el lector de tokens mediría " +
        "los pares CLAROS creyendo que son los oscuros, y en verde",
    ).toBe("#10203a");
    expect(limpio).not.toMatch(/papel-al-imprimir/);
  });

  it("ninguna verificación de `tests/` se apoya en el detector de `.claude/skills`", () => {
    const apoyadas = FUENTES.filter((relativa) => MEDIDOR_PROHIBIDO.test(codigoDe(relativa)));

    expect(
      apoyadas,
      "D9 de la feature 217 lo descarta por nombre: no tiene autocontroles y no corre en el gate. " +
        "Lo que sí está validado es `tests/fixtures/contraste.ts` (tres razones publicadas por " +
        "WCAG y los dos extremos de la composición alfa, en `contraste-tokens.guardia.test.ts`).",
    ).toEqual([]);
  });
});

describe("feature 217 — censo de fuente de la hoja de la factura", () => {
  /**
   * Autocomprobación: si la hoja se renombra o se mueve, todo lo de abajo censaría una cadena
   * vacía y saldría verde sin haber mirado nada. Se ancla a algo que la hoja SIEMPRE tiene.
   */
  it("el censo está leyendo la hoja de verdad", () => {
    expect(hoja.length).toBeGreaterThan(20000);
    expect(hoja).toContain("function HojaFactura(");
    expect(hoja).toContain("function HojaResumen(");
  });

  it("cero tinta de valor fijo: ni un `text-navy`, ni un `border-navy` (R2)", () => {
    expect(cuantas(hoja, /\btext-navy\b/)).toBe(0);
    expect(cuantas(hoja, /\bborder-navy\b/)).toBe(0);
  });

  it("la hoja ya no se fija a tema claro, y ninguna prosa dice que lo haga (R1, R19)", () => {
    // Sobre el fuente CRUDO, comentarios incluidos: R19 prohíbe que el código de producción siga
    // AFIRMANDO el pin, no sólo que lo aplique. Una prosa que describe un mecanismo retirado es
    // peor que ninguna: manda a quien la lee a buscar algo que ya no está.
    expect(cuantas(hojaCruda, /tema-claro/)).toBe(0);
  });

  it("ninguna utilidad de color de valor fijo: el color de la hoja gira con el tema (R2, R3)", () => {
    expect(hoja.match(UTILIDADES_FIJAS) ?? []).toEqual([]);
  });

  it("ninguna opacidad sobre un token `-strong`: eso anula su garantía de 4.5:1 (R8)", () => {
    // `text-success-strong/80` medía 3.36 en los dos temas. Un `-strong` existe precisamente para
    // garantizar el umbral; ponerle alfa lo convierte en un color cualquiera con nombre de token.
    expect(hoja.match(/-strong\/\d+/g) ?? []).toEqual([]);
  });

  it("las DOS hojas llevan `papel-al-imprimir`, una por `<Card>` (R9)", () => {
    expect(cuantas(hoja, /papel-al-imprimir/)).toBe(2);

    const aperturas = hoja.split("<Card").slice(1).map((trozo) => trozo.slice(0, trozo.indexOf(">")));
    expect(aperturas.length, "la hoja ya no monta exactamente dos `<Card>`").toBe(2);
    for (const apertura of aperturas) {
      expect(
        apertura,
        "una de las dos hojas no lleva la clase de impresión: ese comprobante saldría oscuro en " +
          "papel, o —peor— casi en blanco, porque el navegador no imprime los fondos",
      ).toContain("papel-al-imprimir");
    }
  });

  it("no fuerza la impresión de fondos ni añade un flujo de impresión (R11, R14)", () => {
    expect(hoja).not.toMatch(/print-color-adjust/);
    // R14: esta feature garantiza el COLOR del papel, no el flujo. Ni botón, ni llamada a la API
    // de impresión del navegador. La única vía sigue siendo el diálogo del navegador.
    expect(hoja).not.toMatch(/window\s*\.\s*print/);
    expect(hoja, "apareció un rótulo «Imprimir»: el flujo de impresión es otra ficha").not.toMatch(
      /\bImprimir\b/,
    );
  });

  /**
   * R5 — «el resto de la hoja no se rediseña». Esta feature cambia **de qué depende el color**,
   * no cómo se ve la factura: ni un tamaño, ni un peso, ni un espaciado, ni un borde, ni la
   * jerarquía visual. Hasta aquí eso se sostenía leyendo el diff, y un diff no falla solo.
   *
   * Se congela el CONJUNTO de utilidades NO cromáticas de la hoja: tipografía, pesos, espaciados,
   * anchos y estilos de borde, radios, interlineado. El color no aparece en esta lista, así que
   * la 217 entera es invisible para ella — que es justo lo que la hace un dueño honesto de R5.
   *
   * ⚠️ CONJUNTO, no reparto: caza que aparezca una utilidad nueva (`p-6`, `text-xl`,
   * `font-bold`) o que desaparezca una que estaba, pero **NO caza reubicar una que ya está** —
   * mover un `py-3` de un bloque a otro deja el conjunto idéntico—. Para eso haría falta anclar
   * cada utilidad a su nodo del JSX, que es la misma clase de análisis frágil que el CIERRE
   * descarta más abajo y por el mismo motivo. El título dice «conjunto» a propósito: un caso que
   * prometa «la hoja no se rediseña» estaría afirmando más de lo que mira.
   *
   * Es una FOTO, igual que los suelos del inventario, y se mantiene igual: si un día hay que
   * cambiar el layout de verdad, esta lista se actualiza a mano y ese rojo es el momento de
   * revisión que R5 quiere provocar. Lo que no puede pasar es que se mueva sin que nadie lo vea.
   */
  it("el CONJUNTO de utilidades no cromáticas de la hoja es el mismo: ni una nueva, ni una menos (R5)", () => {
    const FAMILIAS =
      /^(?:text-(?:xs|sm|base|lg|xl|2xl|left|right|center|\[)|font-(?:medium|semibold|bold|normal|mono|sans)|(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-|border(?:-[trblxy])?(?:-\d|-\[|$)|border-(?:dashed|dotted|solid)$|rounded|tracking-|leading-|uppercase$|tabular-nums$|divide-y$)/;

    const palabras = hoja.match(/[A-Za-z0-9_:./#[\]%()_-]+/g) ?? [];
    const halladas = [
      ...new Set(palabras.filter((p) => FAMILIAS.test(p.replace(/^(?:[a-z]+:)*/, "")))),
    ].sort();

    // Foto tomada el 2026-08-13, con la 217 ya aplicada.
    expect(halladas).toEqual([
      "border", "border-b", "border-b-2", "border-dashed", "border-dotted", "border-t",
      "border-t-[3px]", "divide-y",
      "font-medium", "font-mono", "font-semibold",
      "gap-0", "gap-0.5", "gap-1", "gap-1.5", "gap-2", "gap-2.5", "gap-3", "gap-3.5", "gap-4",
      "gap-5", "gap-x-1", "gap-x-3", "gap-x-3.5", "gap-x-5", "gap-y-0.5", "gap-y-1", "gap-y-1.5",
      "gap-y-2",
      "mb-1", "mb-1.5", "mb-2",
      "md:gap-2", "md:gap-2.5", "md:gap-4", "md:gap-5", "md:px-5", "md:text-[11px]",
      "md:text-[22px]",
      "mt-3", "mt-auto",
      "p-5", "pb-3", "pb-4", "pl-12", "pt-2", "pt-2.5",
      "px-1.5", "px-2", "px-3", "px-4", "px-5",
      "py-0", "py-0.5", "py-1", "py-1.5", "py-2", "py-2.5", "py-3", "py-3.5", "py-4",
      "rounded-[10px]", "rounded-full", "rounded-md", "rounded-xl",
      "tabular-nums",
      "text-2xl", "text-[0.6875rem]", "text-[10px]", "text-[11px]", "text-[12.5px]",
      "text-[13px]", "text-[20px]", "text-base", "text-left", "text-lg", "text-right", "text-sm",
      "text-xs",
      "tracking-[0.12em]", "tracking-wide", "tracking-wider",
      "uppercase",
    ]);
  });

  it("la hoja sigue siendo presentación pura: ni servidor, ni datos, ni contratos nuevos (R22)", () => {
    // La frontera de la feature, hecha ejecutable. El cambio es de color: si algún día esta hoja
    // empieza a traerse sus propios datos, deja de ser el sitio donde se decide sólo cómo se ve.
    expect(hoja).not.toMatch(/["']use server["']/);
    expect(hoja).not.toMatch(/\bfetch\s*\(/);
    expect(hoja).not.toMatch(/@\/lib\/(?:services|repositories)/);
    expect(hoja).not.toMatch(/prisma/i);

    // Y los tres contratos de entrada siguen siendo los mismos, con el mismo nombre: los llamadores
    // (`CierresAdminModule`, `CierreDiaModule`) y sus tests dependen de ellos.
    for (const contrato of [
      "export interface CierreFacturaResumenProps",
      "export interface CierreFacturaCabecera",
      "export interface CierreFacturaDetalleProps",
    ]) {
      expect(hoja, `desapareció el contrato \`${contrato}\``).toContain(contrato);
    }
  });

  /**
   * R20 — la guardia que afirmaba lo contrario se REEXPRESA, no se relaja. Su título decía «la
   * landing y **la factura** dependen de ello», y desde esta feature eso es falso. Esto vigila las
   * dos mitades: que ningún título vuelva a atar la factura a `.tema-claro`, y que el caso **siga
   * existiendo** — relajar por borrado es la salida fácil y aquí cuesta rojo.
   */
  it("ninguna guardia sigue afirmando que la factura depende de `.tema-claro` (R19, R20)", () => {
    const guardiaTema = readFileSync(
      path.join(RAIZ, "tests", "unit", "guards", "tema-encendido.guardia.test.ts"),
      "utf8",
    );
    const titulos = [...guardiaTema.matchAll(/\bit\(\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(titulos.length, "no se encontró ningún caso: el censo dejó de saber leer").toBeGreaterThan(
      5,
    );

    const elCaso = titulos.find((t) => /`\.tema-claro` sigue fijando los valores claros/.test(t));
    expect(
      elCaso,
      "el caso que defiende `.tema-claro` no puede desaparecer: la landing y la elección «claro» " +
        "del portal siguen dependiendo de esa clase. Reexpresar no es borrar.",
    ).toBeDefined();
    expect(
      elCaso,
      "ese título vuelve a atar la factura a `.tema-claro`, y desde la 217 es falso: la hoja gira " +
        "con el tema y sólo vuelve a claro al imprimir, con su propia clase",
    ).not.toMatch(/factura/i);
    expect(
      elCaso,
      "el título tiene que seguir nombrando a los consumidores que SÍ quedan, o deja de decir a " +
        "quién protege",
    ).toMatch(/landing/i);
  });

  it("el indicador de la pestaña activa usa un token que gira, no el de marca (R3)", () => {
    // `border-foreground` y no `border-primary`: en ese mismo condicional se pinta el borde Y la
    // etiqueta, y `--primary` (3.18 sobre blanco) cumple el 3:1 de componente pero no el 4.5:1 de
    // texto — es la deuda que la ficha 216 tiene abierta.
    expect(cuantas(hoja, /\bborder-foreground\b/)).toBeGreaterThanOrEqual(1);
    expect(hoja).not.toMatch(/\bborder-primary\b/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// EL INVENTARIO CERRADO DE PARES (tinta, fondo)  ·  R6, R7, R16
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Este inventario SUSTITUYE al barrido de navegador, que la puerta humana descartó (D9): no
 * existe en el repo un script que barra la app, el único candidato disponible no tiene
 * autocontroles, y esa jornada ya acumuló tres mediciones falsas de herramientas que rellenan
 * lo que no saben.
 *
 * A cambio, se enumeran **los pares (tinta, fondo) que las dos hojas usan de verdad** y se miden
 * con la aritmética validada, en los DOS temas. Tres reglas que no se pueden saltar:
 *
 *  1. **El hover cuenta como par propio.** La fila de gestión cambia de fondo bajo el cursor
 *     (`hover:bg-muted/50`) y eso mueve tres pares. La 210 encontró un defecto que SÓLO existía
 *     con el cursor encima; medir sólo lo estático es exactamente cómo se le escapó a la 208.
 *  2. **Los exentos FIGURAN, marcados.** Un exento que desaparece de la lista es indistinguible
 *     de un par que nadie miró.
 *  3. **Suelo por par**, no sólo umbral: se anota lo medido al cerrar el inventario y ningún
 *     cambio de token puede bajarlo. Es la lección de la 210 — `--warning-strong` pasaba AA por
 *     una centésima, y una guardia de sólo umbral habría dejado revertirla sin ponerse roja.
 *
 * Y el CIERRE es parte del requisito, no un adorno — con su alcance exacto, que es el mismo que
 * declaran R7 y `design.md §6.3`: atrapa **toda tinta nueva y toda superficie nueva**, que es de
 * donde salen los pares sin medir. NO atrapa la **recombinación** de una tinta y un fondo ya
 * declarados. Lo caza el cierre, no la aritmética; y lo que el cierre no ve, no lo ve nadie: al
 * mover una pieza de sitio dentro de la hoja hay que releer el inventario. El porqué de no ir
 * más allá está donde la decisión: en el caso del CIERRE, aquí abajo.
 */

/** El fondo real sobre el que se lee una tinta. */
type Fondo =
  | { clase: "opaco"; token: string }
  /** Un token de PALETA (`--color-danger-soft`): un hex fijo, sin variante por tema. */
  | { clase: "paleta"; nombre: string }
  | {
      clase: "capa";
      color: { de: "token" | "paleta"; nombre: string };
      alpha: number;
      sobre: string;
    };

interface Par {
  id: string;
  /** Qué pinta este par, en una línea. */
  papel: string;
  /** Token de tinta, tal como se declara en `app/globals.css`. */
  tinta: string;
  fondo: Fondo;
  /**
   * Cuando el fondo NO es el mismo en los dos temas porque una utilidad `dark:` lo cambia
   * (`dark:bg-destructive/20` frente a `bg-destructive/10`). Sin esto, medir el tema oscuro con
   * el fondo del claro daría un número plausible y falso.
   */
  fondoOscuro?: Fondo;
  /**
   * `4.5` para texto · `3` para un indicador de interfaz · `"exento"` para lo que WCAG no obliga
   * a medir · `"ajeno"` para el color que la hoja NO pinta pero SÍ muestra, porque entra desde una
   * primitiva o un componente compartido.
   *
   * Un par `"ajeno"` se MIDE y se le pone SUELO —no puede empeorar— pero no se le exige el
   * umbral aquí: arreglarlo con una clase local de la factura dejaría la misma variante rota en
   * las otras rutas que la montan y, encima, escondería la deuda. Es R17 y R18: se declara con su
   * ancla y su medición fechada, y se remite a las fichas 210/216, que lo tratan para TODA la app.
   */
  umbral: number | "exento" | "ajeno";
  /** Motivo, obligatorio cuando el par es exento o ajeno. */
  motivo?: string;
  /** Las utilidades de la hoja que caen en este par. El CIERRE se calcula con esta unión. */
  utilidades: string[];
  /** Dónde ocurre, para que el número se pueda volver a mirar a mano. */
  anclas: string;
}

const CARD = "card";

const INVENTARIO: Par[] = [
  {
    id: "P1",
    papel: "el texto principal de la hoja sobre el papel: titulares, importes, datos realzados",
    tinta: "foreground",
    fondo: { clase: "opaco", token: CARD },
    umbral: 4.5,
    utilidades: ["text-foreground", "hover:text-foreground"],
    anclas:
      "renglones :193/:208, caja de pago :271/:279, títulos :508/:1101, total :563, " +
      "motivo :572/:1327, pestaña activa :857, dato de fila desplegada :885, fila :927/:931/:936",
  },
  {
    id: "P2",
    papel: "la cifra de la tarjeta de totales en su rama NEUTRA, sobre el panel apagado opaco",
    tinta: "foreground",
    fondo: { clase: "opaco", token: "muted" },
    umbral: 4.5,
    utilidades: ["bg-muted"],
    anclas: ":805 dentro de :790",
  },
  {
    id: "P3",
    papel: "la cifra del KPI, dentro de su caja apagada al 40 %",
    tinta: "foreground",
    fondo: { clase: "capa", color: { de: "token", nombre: "muted" }, alpha: 0.4, sobre: CARD },
    umbral: 4.5,
    utilidades: ["bg-muted/40"],
    anclas: ":249 dentro de :245",
  },
  {
    id: "P4",
    papel: "los datos realzados de los paneles apagados al 50 %: desplegable, pie, fila en hover",
    tinta: "foreground",
    fondo: { clase: "capa", color: { de: "token", nombre: "muted" }, alpha: 0.5, sobre: CARD },
    umbral: 4.5,
    utilidades: ["bg-muted/50", "hover:bg-muted/50"],
    anclas:
      ":348/:380 (panel :581), :667 (extra del panel), :1320/:1327 (pie :1317), " +
      ":927/:931/:936 con el cursor encima (:925)",
  },
  {
    id: "P5",
    papel: "los rótulos y las notas apagadas sobre el papel",
    tinta: "muted-foreground",
    fondo: { clase: "opaco", token: CARD },
    umbral: 4.5,
    utilidades: ["text-muted-foreground"],
    anclas:
      ":197, :230, :268, :276, :509, :540, :557, :571, :858, :932, :946, :953, :1106, :1114, " +
      ":1288, :1300",
  },
  {
    id: "P6",
    papel: "el rótulo y la nota de la tarjeta neutra, y la píldora de conteo neutra",
    tinta: "muted-foreground",
    fondo: { clase: "opaco", token: "muted" },
    umbral: 4.5,
    utilidades: [],
    anclas: ":796 y :817 (rama no-éxito de :790), :842 (píldora neutral)",
  },
  {
    id: "P7",
    papel: "el rótulo del KPI dentro de su caja apagada al 40 %",
    tinta: "muted-foreground",
    fondo: { clase: "capa", color: { de: "token", nombre: "muted" }, alpha: 0.4, sobre: CARD },
    umbral: 4.5,
    utilidades: [],
    anclas: ":246 dentro de :245",
  },
  {
    id: "P8",
    papel: "los rótulos apagados de los paneles al 50 %: desplegable, pie, fila en hover",
    tinta: "muted-foreground",
    fondo: { clase: "capa", color: { de: "token", nombre: "muted" }, alpha: 0.5, sobre: CARD },
    umbral: 4.5,
    utilidades: [],
    anclas: ":342, :347, :360, :379 (panel :581), :665, :1318, :1326 (pie :1317), :932 en hover",
  },
  {
    id: "P9",
    papel: "la tarjeta de PAGO A LA TIENDA y la píldora de entregadas: verde sobre verde al 15 %",
    tinta: "success-strong",
    fondo: { clase: "capa", color: { de: "paleta", nombre: "success" }, alpha: 0.15, sobre: CARD },
    umbral: 4.5,
    utilidades: ["bg-success/15"],
    anclas: ":796, :805, :817 (la nota, ya sin el `/80` — R8), :840",
  },
  {
    id: "P10",
    papel: "las píldoras de conteo de reprogramadas e incidentes: ámbar sobre ámbar al 15 %",
    tinta: "warning-strong",
    fondo: { clase: "capa", color: { de: "paleta", nombre: "warning" }, alpha: 0.15, sobre: CARD },
    umbral: 4.5,
    utilidades: ["bg-warning/15", "text-warning-strong"],
    anclas: ":841",
  },
  {
    id: "P11",
    papel: "el renglón de DEUDA de la liquidación, en rojo sobre el papel",
    tinta: "danger-strong",
    fondo: { clase: "opaco", token: CARD },
    umbral: 4.5,
    utilidades: ["text-danger-strong"],
    anclas: ":209 (`Renglon` con tone `danger`)",
  },
  {
    id: "P12",
    papel: "el INDICADOR de la pestaña seleccionada: un borde, no un texto",
    tinta: "foreground",
    fondo: { clase: "opaco", token: CARD },
    // 3:1 y no 4.5: WCAG 1.4.11 (contraste de elementos NO textuales). La etiqueta de esa misma
    // pestaña es texto y va por P1, que sí exige 4.5.
    umbral: 3,
    utilidades: ["border-foreground"],
    anclas: ":857",
  },
  {
    id: "P13",
    papel: "el total de cada fila de gestión, en verde sobre el papel",
    tinta: "success-strong",
    fondo: { clase: "opaco", token: CARD },
    umbral: 4.5,
    utilidades: ["text-success-strong"],
    anclas: ":939",
  },
  {
    id: "P14",
    papel: "ese mismo total, con el cursor encima de la fila (el fondo cambia)",
    tinta: "success-strong",
    fondo: { clase: "capa", color: { de: "token", nombre: "muted" }, alpha: 0.5, sobre: CARD },
    umbral: 4.5,
    utilidades: [],
    anclas: ":939 bajo el `hover:bg-muted/50` de :925",
  },
  {
    id: "P19",
    papel:
      "la tinta POR DEFECTO de la hoja: todo texto sin clase de color, que hereda de la `Card`",
    tinta: "card-foreground",
    fondo: { clase: "opaco", token: CARD },
    umbral: 4.5,
    // No hay ninguna utilidad `text-card-foreground` escrita en la hoja, y por eso este par es
    // el que más fácil se olvida: lo pone `components/ui/card.tsx` (`bg-card
    // text-card-foreground`) y lo hereda TODO lo que no declara color — los importes no
    // enfatizados de los renglones, los títulos del desglose de tarifa, los valores de
    // `DesgloseFila`. `design.md §6.3` no lo listaba.
    utilidades: [],
    anclas:
      "valor de `Renglon` sin `emphasis` :215, `DesgloseFila` y los `h4` del desglose de " +
      "tarifa (`cierre-detalle-shared.tsx`, montado en :1048)",
  },
  {
    id: "P20",
    papel: "el aviso «sin tarifa congelada» del desglose auditable de una orden",
    tinta: "destructive",
    fondo: { clase: "opaco", token: CARD },
    umbral: "ajeno",
    motivo:
      "PREEXISTENTE Y AJENO A ESTA FICHA (R17). Lo pinta `DesgloseIngresoOrdenex` en " +
      "`cierre-detalle-shared.tsx:651`, un componente COMPARTIDO con las tablas del detalle: " +
      "`--destructive` no tiene variante `-strong` y mide 3.76 sobre el papel claro. Arreglarlo " +
      "con una clase local de la factura dejaría el mismo aviso roto en las otras vistas que " +
      "montan ese componente y escondería la deuda, que es de la paleta (fichas 210/216). " +
      "Medido el 2026-08-13: claro 3.76 · oscuro 5.89. Esta feature NO lo empeora — al contrario, " +
      "antes se leía a 3.76 en los DOS temas porque la hoja estaba fijada a claro; ahora en " +
      "oscuro pasa a 5.89. El suelo lo deja atornillado.",
    utilidades: [],
    anclas: "`cierre-detalle-shared.tsx:651`, montado desde `cierre-factura.tsx:1048`",
  },
  // ── Lo que entra a la hoja SIN estar escrito en `cierre-factura.tsx` (T13) ──────────────
  // Las hojas montan primitivas (`Badge`, `Button`) y reciben subárboles ajenos por props
  // (`acciones` desde `CierresAdminModule.tsx:749`). Un censo del archivo NO los ve, y sin
  // embargo se leen sobre el papel. Se miden aquí y se declaran; NO se parchean (R18).
  {
    id: "P21",
    papel: "`Button` variant `default` — «Ver / decidir» en la botonera `acciones`",
    tinta: "primary-foreground",
    fondo: { clase: "opaco", token: "primary" },
    umbral: "ajeno",
    motivo:
      "DEUDA DE PALETA, ficha 216. `--primary` es el naranja de marca y su par con " +
      "`--primary-foreground` no llega a 4.5:1 para texto normal en ninguno de los dos temas. " +
      "Afecta a TODOS los botones primarios del portal, no a la factura: por eso esta ficha no " +
      "lo toca —un parche local dejaría las otras quince rutas igual y taparía la deuda— y por " +
      "eso tampoco se eligió `primary` para el indicador de la pestaña (§2b del design).",
    utilidades: [],
    anclas: "`CierresAdminModule.tsx:781` (variant `default` si el cierre está `solicitado`)",
  },
  {
    id: "P22",
    papel: "`Button` variant `destructive` — «Destrabar cierre vencido» en `acciones`",
    // Feature 222 — ESTA DEUDA SE PAGÓ, y la ficha entera de la 217 lo dejaba escrito así: «un
    // registro de deuda que no se entera de que la deuda se pagó es un registro falso». La
    // variante ya no se cuelga de `--destructive` —que no tiene `-strong`— sino del par de
    // `danger`, igual que el `Badge` desde la 210. Por eso este par pasa a ser, hex a hex, el
    // mismo que P26: es literalmente el mismo par.
    tinta: "danger-strong",
    fondo: { clase: "paleta", nombre: "danger-soft" },
    // En oscuro no hay `-soft` (es un hex claro fijo, sin variante): el fondo se compone en
    // ejecución con `dark:bg-danger/15`. Medir el oscuro con el fondo del claro daría un número
    // plausible y falso, que es la única forma de fallar aquí.
    fondoOscuro: {
      clase: "capa",
      color: { de: "paleta", nombre: "danger" },
      alpha: 0.15,
      sobre: CARD,
    },
    umbral: "ajeno",
    motivo:
      "primitiva compartida, y desde la feature 222 este par SÍ tiene dueño: su umbral y su " +
      "suelo —los CUATRO estados, reposo y hover, en los dos temas y sobre seis superficies— " +
      "viven en `contraste-tokens.guardia.test.ts`, junto al del `Badge` que arregló la 210. " +
      "Sigue como «ajeno» porque la hoja no lo pinta: entra por `acciones` desde " +
      "`CierresAdminModule`, y exigirle aquí el umbral duplicaría el criterio en dos sitios. " +
      "Medido el 2026-08-13, DESPUÉS de la 222: claro 5.30 · oscuro 5.20 (antes 3.29 y 4.43, " +
      "bajo AA en los dos temas). El HOVER —que en esta hoja no se mide, igual que no se miden " +
      "los de P21/P23/P24— pasó de 2.90/3.68 a 6.47/5.89 y es opaco: ya no depende del fondo.",
    utilidades: [],
    anclas: "`CierresAdminModule.tsx:770`, dentro de `acciones` de la hoja compacta",
  },
  {
    id: "P23",
    papel: "`Button` variant `outline` — «Ver detalles» y «Ver», sobre el fondo de la app",
    tinta: "card-foreground",
    fondo: { clase: "opaco", token: "background" },
    // En oscuro la variante cambia el fondo con `dark:bg-input/30`, no con `bg-background`.
    fondoOscuro: { clase: "capa", color: { de: "token", nombre: "input" }, alpha: 0.3, sobre: CARD },
    umbral: "ajeno",
    motivo:
      "primitiva compartida: el `Button` `outline` no declara color de texto, así que HEREDA el " +
      "de la hoja. Se mide y se le pone suelo para que no empeore, pero su umbral es de las " +
      "fichas de paleta, no de ésta.",
    utilidades: [],
    anclas: "toggle de la hoja compacta :522, y «Ver evidencia» :1031",
  },
  {
    id: "P24",
    papel: "ese mismo `Button` `outline` cuando cuelga del panel apagado de una fila",
    tinta: "muted-foreground",
    fondo: { clase: "opaco", token: "background" },
    fondoOscuro: { clase: "capa", color: { de: "token", nombre: "input" }, alpha: 0.3, sobre: CARD },
    umbral: "ajeno",
    motivo:
      "el MISMO botón con OTRA tinta: «Ver evidencia» vive dentro de un contenedor que declara " +
      "`text-muted-foreground` (:950), y el `outline` no pone color propio. Dos contextos de " +
      "herencia distintos son dos pares distintos; medir sólo uno sería suponer el otro.",
    utilidades: [],
    anclas: ":1031 dentro de :950",
  },
  {
    id: "P26",
    papel: "`Badge` variant `destructive` — el estado «Rechazado» y «Vencido» del comprobante",
    tinta: "danger-strong",
    // La 210 movió esta variante al par de `danger`: `-soft` opaco en claro, `danger/15` compuesto
    // sobre la tarjeta en oscuro (en oscuro no hay `-soft`: es un hex claro fijo sin variante).
    fondo: { clase: "paleta", nombre: "danger-soft" },
    fondoOscuro: {
      clase: "capa",
      color: { de: "paleta", nombre: "danger" },
      alpha: 0.15,
      sobre: CARD,
    },
    umbral: "ajeno",
    motivo:
      "primitiva compartida, y este par SÍ tiene dueño: es el que la feature 210 arregló y dejó " +
      "con umbral y suelo en `contraste-tokens.guardia.test.ts`. Figura aquí porque el " +
      "inventario de la 217 es CERRADO y R16 no admite ausencias: un par que no está en la " +
      "lista y un par que nadie miró se leen igual. Entra medido y con suelo, remitiendo a su " +
      "guardia; el umbral lo exige allí, no aquí, para no duplicar el criterio en dos sitios.",
    utilidades: [],
    anclas: "`EstadoCierreBadge` en las DOS hojas (:516 y :1104), estados `rechazado` y `vencido`",
  },
  {
    id: "P25",
    papel: "`Badge` variant `secondary` — el estado «Solicitado» y el rótulo de rechazo por plazo",
    tinta: "secondary-foreground",
    fondo: { clase: "opaco", token: "secondary" },
    umbral: "ajeno",
    motivo:
      "primitiva compartida (`badge.tsx`). Se mide y se le pone suelo; su umbral lo gobiernan " +
      "las fichas 210/216 para toda la app.",
    utilidades: [],
    anclas: "`EstadoCierreBadge` (:516, :1101) y el badge de rechazo por plazo :1011",
  },
  {
    id: "P15",
    papel: "los separadores `|` entre las partes del comprobante compacto",
    tinta: "border",
    fondo: { clase: "opaco", token: CARD },
    umbral: "exento",
    motivo:
      "decorativos y `aria-hidden`: no son texto expuesto. WCAG no les pide contraste, y " +
      "subírselo los convertiría en ruido visual entre datos que sí hay que leer.",
    utilidades: ["text-border"],
    anclas: ":544",
  },
  {
    id: "P16",
    papel: "el wordmark «Ordenex» de la hoja compacta",
    tinta: "brand",
    fondo: { clase: "opaco", token: CARD },
    umbral: "exento",
    motivo:
      "texto de una MARCA: WCAG 1.4.3 lo exime expresamente. Mide 3.18 sobre blanco y no se " +
      "toca; el color de marca en texto normal es deuda abierta de la ficha 216, para toda la app.",
    utilidades: ["text-brand"],
    anclas: ":505",
  },
  {
    id: "P17",
    papel: "la franja de marca del detalle y el filete superior de la hoja compacta",
    tinta: "brand",
    fondo: { clase: "opaco", token: CARD },
    umbral: "exento",
    motivo:
      "superficies decorativas SIN texto encima: la franja es `aria-hidden` y el filete es el " +
      "borde de la tarjeta. No hay nada que leer sobre ellas, así que no hay par que medir. " +
      "(`design.md §6.4` sólo nombraba dos usos de `brand`; el filete de la hoja compacta es el " +
      "tercero y se añade aquí en vez de heredar la omisión.)",
    utilidades: ["bg-brand", "border-t-brand"],
    anclas: ":311 (franja), :499 (filete)",
  },
  {
    id: "P18",
    papel: "los filetes y separadores estructurales de las dos hojas",
    tinta: "border",
    fondo: { clase: "opaco", token: CARD },
    umbral: "exento",
    motivo:
      "separadores decorativos: guía punteada `aria-hidden`, divisores de bloque, bordes de " +
      "caja y del panel apagado. Ninguno es el ÚNICO indicador del estado de un control —el de " +
      "la pestaña seleccionada sí lo es, y por eso ese va aparte y MEDIDO, en P12—. " +
      "(`design.md §6.3` no los listaba ni como medidos ni como exentos, y R16 dice que un " +
      "exento ausente es indistinguible de un par que nadie miró.)",
    utilidades: ["border-border", "border-border/60", "divide-border/60"],
    anclas:
      ":203, :233, :245, :267, :275, :339, :376, :581, :665, :913, :954, :1050, :1098, " +
      ":1273, :1317",
  },
];

/** El hex final del fondo de un par en un tema, componiendo la capa si la hay. */
function hexDeFondo(tema: "claro" | "oscuro", par: Par): string {
  const fondo = tema === "oscuro" && par.fondoOscuro ? par.fondoOscuro : par.fondo;
  if (fondo.clase === "opaco") return token(tema, fondo.token);
  if (fondo.clase === "paleta") return paleta(fondo.nombre);
  const color =
    fondo.color.de === "token" ? token(tema, fondo.color.nombre) : paleta(fondo.color.nombre);
  return componer(color, token(tema, fondo.sobre), fondo.alpha);
}

/**
 * Lo MEDIDO al cerrar el inventario (2026-08-13), con la aritmética del fixture. Ningún cambio de
 * token puede bajar de aquí, aunque siga cumpliendo el umbral.
 *
 * ⚠️ Los hexes de cada comentario —tinta/fondo en los dos temas— **se vuelcan desde la propia
 * aritmética, no se escriben a mano**: son el `hexDeFondo()` ya compuesto. Se dice porque el
 * único de esta tabla que se tecleó de memoria (`P26` oscuro) salió **mal** y lo cazó el
 * reviewer: la aserción y el suelo eran correctos, pero el comentario anunciaba un fondo que no
 * era, y el siguiente que lo lea lo va a usar. Para regenerarlos, medir con `contraste()` y
 * `hexDeFondo()` sobre `INVENTARIO`; no reconstruirlos mentalmente.
 */
const SUELO: Record<string, { claro: number; oscuro: number }> = {
  P1: { claro: 15.7, oscuro: 13.74 }, //  #12233f/#ffffff   · #e6ecf8/#10203a
  P2: { claro: 14.26, oscuro: 12.22 }, // #12233f/#f1f4fb   · #e6ecf8/#16294a
  P3: { claro: 15.13, oscuro: 13.1 }, //  #12233f/#f9fbfd   · #e6ecf8/#122440
  P4: { claro: 15.01, oscuro: 12.92 }, // #12233f/#f8fafd   · #e6ecf8/#132542
  P5: { claro: 7.7, oscuro: 7.21 }, //    #4a5368/#ffffff   · #9fadc9/#10203a
  P6: { claro: 6.99, oscuro: 6.41 }, //   #4a5368/#f1f4fb   · #9fadc9/#16294a
  P7: { claro: 7.42, oscuro: 6.87 }, //   #4a5368/#f9fbfd   · #9fadc9/#122440
  P8: { claro: 7.36, oscuro: 6.78 }, //   #4a5368/#f8fafd   · #9fadc9/#132542
  P9: { claro: 4.77, oscuro: 6.6 }, //    #047857/#dbf5ec   · #34d399/#103745   ← el más justo
  P10: { claro: 6.31, oscuro: 7.59 }, //  #92400e/#fef0da   · #fbbf24/#323333
  P11: { claro: 6.47, oscuro: 5.89 }, //  #b91c1c/#ffffff   · #f87171/#10203a
  P12: { claro: 15.7, oscuro: 13.74 }, // #12233f/#ffffff   · #e6ecf8/#10203a
  P13: { claro: 5.48, oscuro: 8.47 }, //  #047857/#ffffff   · #34d399/#10203a
  P14: { claro: 5.24, oscuro: 7.97 }, //  #047857/#f8fafd   · #34d399/#132542
  P19: { claro: 15.7, oscuro: 13.74 }, // #12233f/#ffffff  · #e6ecf8/#10203a
  P20: { claro: 3.76, oscuro: 5.89 }, //  #ef4444/#ffffff  · #f87171/#10203a  ← deuda ajena, R17
  P21: { claro: 3.18, oscuro: 7.06 }, //  #ffffff/#f26419  · #0a1524/#ff7a33  ← bajo AA en claro
  P22: { claro: 5.3, oscuro: 5.2 }, //   #b91c1c/#fee2e2  · #f87171/#31253c  ← la 222 lo arregló
  P23: { claro: 14.79, oscuro: 12.08 }, // #12233f/#f7f8fc · #e6ecf8/#172a4a
  P24: { claro: 7.25, oscuro: 6.34 }, //  #4a5368/#f7f8fc  · #9fadc9/#172a4a
  P25: { claro: 13.86, oscuro: 12.22 }, // #17233b/#eef1f8 · #e6ecf8/#16294a
  P26: { claro: 5.3, oscuro: 5.2 }, //   #b91c1c/#fee2e2  · #f87171/#31253c  ← coincide con la 210
};

/**
 * SEIS de estos catorce números se pueden contrastar contra anotaciones que dejó OTRA feature en
 * `app/globals.css`, escritas por una medición distinta y anteriores a esta guardia. Coinciden a
 * la centésima, y por eso valen como comprobación cruzada del instrumento y no como adorno:
 *
 *   P13 claro 5.48  ↔ `--success-strong: #047857;  /* vs card 5.48 *\/`
 *   P13 oscuro 8.47 ↔ `--success-strong: #34d399;  /* vs card 8.47 *\/`
 *   P9  oscuro 6.60 ↔ `                            /* vs success/15 6.60 *\/`
 *   P11 claro 6.47  ↔ `--danger-strong:  #b91c1c;  /* vs card 6.47 *\/`
 *   P11 oscuro 5.89 ↔ `--danger-strong:  #f87171;  /* vs card 5.89 *\/`
 *   P10 claro 6.31  ↔ `--warning-strong: #92400e;  /* vs warning/15 6.31 *\/`
 */

/** Tolerancia del suelo: absorbe el redondeo a dos decimales, nada más. */
const EPSILON = 0.01;

const MEDIBLES = INVENTARIO.filter((p) => typeof p.umbral === "number");
const AJENOS = INVENTARIO.filter((p) => p.umbral === "ajeno");
const EXENTOS = INVENTARIO.filter((p) => p.umbral === "exento");

describe("feature 217 — el inventario CERRADO de pares de la hoja (R6, R7, R16)", () => {
  it.each(MEDIBLES.map((p) => [p.id, p] as const))(
    "%s cumple su umbral y su suelo en los DOS temas",
    (_id, par) => {
      const umbral = par.umbral as number;
      for (const tema of ["claro", "oscuro"] as const) {
        const medido = contraste(token(tema, par.tinta), hexDeFondo(tema, par));
        expect(
          medido,
          `${par.id} en tema ${tema} — ${par.papel} (${par.anclas}) baja del umbral ${umbral}`,
        ).toBeGreaterThanOrEqual(umbral);
        expect(
          medido,
          `${par.id} en tema ${tema} EMPEORÓ: medía ${SUELO[par.id][tema]} al cerrar el ` +
            "inventario. Aprobar por una centésima no es aprobar (lección de la 210): si el " +
            "cambio es a mejor, sube el suelo A MANO y mira el número nuevo.",
        ).toBeGreaterThanOrEqual(SUELO[par.id][tema] - EPSILON);
      }
    },
  );

  it.each(AJENOS.map((p) => [p.id, p] as const))(
    "%s es deuda declarada (R17): no se exige el umbral, pero NO puede empeorar",
    (_id, par) => {
      expect(par.motivo, `${par.id} se declara preexistente sin decir por qué`).toBeTruthy();
      for (const tema of ["claro", "oscuro"] as const) {
        const medido = contraste(token(tema, par.tinta), hexDeFondo(tema, par));
        expect(
          medido,
          `${par.id} en tema ${tema} EMPEORÓ respecto de lo declarado. Que un par esté declarado ` +
            "como deuda ajena no lo deja libre: lo que no se puede es que caiga más.",
        ).toBeGreaterThanOrEqual(SUELO[par.id][tema] - EPSILON);
      }
    },
  );

  /**
   * R18 pide DEJAR CONSTANCIA de qué variantes quedan bajo el umbral dentro de la hoja, con su
   * medición fechada. Esto lo hace ejecutable en vez de dejarlo en prosa: la lista está escrita y
   * si alguna de las fichas 210/216 arregla una, este caso se pone rojo y obliga a actualizar la
   * declaración. Un registro de deuda que no se entera de que la deuda se pagó es un registro
   * falso, igual que uno que no se entera de que creció.
   */
  it("la deuda AJENA que hoy queda bajo AA dentro de la hoja está NOMBRADA (R17, R18)", () => {
    const bajoUmbral = AJENOS.filter((par) =>
      (["claro", "oscuro"] as const).some(
        (tema) => contraste(token(tema, par.tinta), hexDeFondo(tema, par)) < 4.5,
      ),
    ).map((p) => p.id);

    // Medido el 2026-08-13 con la aritmética del fixture:
    //   P20 · aviso «sin tarifa congelada»  ·  claro 3.76 · oscuro 5.89
    //   P21 · `Button` variant `default`    ·  claro 3.18 · oscuro 7.06
    // Ninguna se corrige aquí: son de las fichas 210/216, que las tratan para TODA la app.
    //
    // P22 —`Button` variant `destructive`, 3.29 y 4.43— SALIÓ de esta lista el mismo día: lo
    // pagó la feature 222 y hoy mide 5.30 y 5.20. Este caso se puso rojo al hacerlo, que es
    // exactamente para lo que se escribió: un registro de deuda que no se entera de que la deuda
    // se pagó es tan falso como uno que no se entera de que creció.
    expect(bajoUmbral).toEqual(["P20", "P21"]);
  });

  /**
   * R4 — el cambio de tono en tema CLARO, declarado y medido en vez de descubierto.
   *
   * Los 16 sitios pasan de `--color-navy` (`#0b2545`) a `--foreground` (`#12233f`): NO son el
   * mismo azul, la hoja en claro queda ligerísimamente más fría, y eso es visible. Lo que R4
   * exige es que ninguno quede con MENOS contraste del que tenía. Se comprueba, no se supone.
   */
  it("R4: en tema claro el tono nuevo no tiene menos contraste que el navy que sustituye", () => {
    /**
     * Se comprueba sobre LOS CUATRO fondos en los que viven los dieciséis sitios migrados, no
     * sólo sobre el papel. El argumento de que bastaría uno es correcto y monotónico —`#12233f`
     * tiene MENOS luminancia que `#0b2545`, así que gana contraste contra cualquier fondo más
     * claro que los dos, y los cuatro lo son— pero un argumento que hay que reconstruir de
     * memoria no es una verificación, y quien lea esto mañana no sabría si el fondo único fue
     * decisión o descuido. Medirlos los cuatro cuesta cuatro líneas.
     */
    const fondos: { nombre: string; hex: string }[] = [
      { nombre: "card", hex: token("claro", CARD) },
      { nombre: "muted (opaco)", hex: token("claro", "muted") },
      { nombre: "muted/40 sobre card", hex: componer(token("claro", "muted"), token("claro", CARD), 0.4) },
      { nombre: "muted/50 sobre card", hex: componer(token("claro", "muted"), token("claro", CARD), 0.5) },
    ];

    for (const fondo of fondos) {
      const antes = contraste(paleta("navy"), fondo.hex);
      const ahora = contraste(token("claro", "foreground"), fondo.hex);
      expect(
        ahora,
        `sobre ${fondo.nombre} (${fondo.hex}) el navy fijo daba ${antes.toFixed(2)} y ` +
          `\`--foreground\` da ${ahora.toFixed(2)}: el cambio de tono de la 217 no puede costar ` +
          "contraste en ninguno de los sitios migrados",
      ).toBeGreaterThanOrEqual(antes);
    }
  });

  it("los exentos están en la lista, MARCADOS, y con su motivo escrito", () => {
    // R16: no se miden contra un umbral, pero no pueden desaparecer. Un exento ausente y un par
    // que nadie miró se leen igual: como una lista más corta.
    expect(EXENTOS.map((p) => p.id)).toEqual(["P15", "P16", "P17", "P18"]);
    for (const par of EXENTOS) {
      expect(par.motivo, `${par.id} está exento sin decir por qué`).toBeTruthy();
      expect((par.motivo ?? "").length).toBeGreaterThan(40);
    }
  });

  /**
   * EL CIERRE (R7). Sin esto el inventario sería una lista de buenas intenciones: mediría lo que
   * alguien se acordó de listar y no se enteraría de lo que llegue mañana. Aquí se recorren TODAS
   * las utilidades con prefijo de color de la hoja y se exige que cada una caiga en un par
   * declarado — medido o exento, pero declarado.
   *
   * El sentido de la exigencia es el seguro: lo que este censo no sabe clasificar, lo denuncia.
   * Lo NO-color se declara por lista y por forma (`text-[13px]` es un tamaño, no un color), y
   * cualquier cosa que no esté en ninguna de las dos listas se considera color y tiene que tener
   * su par. Un `text-emerald-500` nuevo cae en rojo aunque nadie lo haya previsto.
   *
   * ⚠️ HASTA DÓNDE LLEGA ESTE CIERRE, dicho al tamaño real y no al que gustaría.
   * Cierra por **UTILIDAD**, no por **PAR**. Caza toda tinta nueva y todo fondo nuevo, que es de
   * donde salen los pares que nadie midió. Lo que **NO** caza es una RECOMBINACIÓN de dos
   * utilidades que ya están en la lista: mover un `text-muted-foreground` —declarado— dentro de
   * un `bg-success/15` —declarado— produce un par que nadie midió y este caso lo deja pasar.
   *
   * No se cierra por par **a propósito, y está escrito como decisión en el spec** (R7 y
   * `design.md §6.3`, precisados el 2026-08-13): resolver el fondo efectivo de cada texto exige
   * recorrer el árbol JSX y decidir de qué ancestro hereda cada nodo, a través de condicionales,
   * `cn()`, props y `children` de otros archivos. Eso es precisamente la clase de análisis que
   * produce respuestas plausibles y falsas —el fallo que esta jornada ya pagó tres veces—, y un
   * cierre por par que se equivoque al resolver el fondo es PEOR que éste, porque **aprueba con
   * un número**.
   *
   * La cobertura que queda descubierta es la recombinación, y su red es humana: al mover una
   * pieza de sitio dentro de la hoja hay que releer el inventario.
   */
  it("CIERRE: toda utilidad de color de la hoja mapea a un par del inventario (R7)", () => {
    const NO_SON_COLOR = new Set([
      // tipografía y trazo: comparten prefijo con las de color, pero no pintan ninguno
      "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl",
      "text-left", "text-right", "text-center",
      "border", "border-b", "border-t", "border-l", "border-r", "border-b-2",
      "border-dashed", "border-dotted", "border-solid",
      "divide-y", "divide-x",
      // `transparent` no es un color que leer: es la ausencia de borde en la pestaña inactiva
      "border-transparent",
    ]);
    /** `text-[13px]`, `text-[0.6875rem]`, `border-t-[3px]`: tamaños entre corchetes, no colores. */
    const ES_TAMANO = /^(?:text|border(?:-[trblxy])?)-\[[\d.]+(?:px|rem|em)\]$/;

    // El guion final es obligatorio: sin él, la palabra `from` de un `import … from "…"` entra al
    // censo como si fuera el `from-` de un degradado. Una utilidad de color siempre lleva valor.
    const CANDIDATO = /^(?:[a-z]+:)*(?:text|bg|border|ring|fill|stroke|divide|from|via|to)-/;
    const palabras = hoja.match(/[A-Za-z0-9_:./#[\]%-]+/g) ?? [];
    const halladas = [...new Set(palabras.filter((p) => CANDIDATO.test(p)))].sort();

    const declaradas = new Set(INVENTARIO.flatMap((p) => p.utilidades));
    const sinPar = halladas.filter((u) => {
      const sinVariante = u.replace(/^(?:[a-z]+:)*/, "");
      if (NO_SON_COLOR.has(sinVariante) || ES_TAMANO.test(sinVariante)) return false;
      return !declaradas.has(u);
    });

    // Autocomprobación: si el extractor dejara de encontrar utilidades, `sinPar` saldría vacío y
    // este caso pasaría sin haber cerrado nada.
    expect(
      halladas.length,
      "el extractor de utilidades no encontró casi nada: está midiendo una cadena vacía",
    ).toBeGreaterThan(20);

    expect(
      sinPar,
      "estas utilidades de color de la hoja no caen en ningún par del inventario. O se añade el " +
        "par con su medición (y su suelo), o se marca exento CON SU MOTIVO. Lo que no se puede es " +
        "pintarlas y no medirlas: eso es exactamente lo que el inventario cerrado existe para " +
        "impedir. (Ojo: esto cierra por UTILIDAD; recombinar dos ya declaradas sobre un fondo " +
        "nuevo no lo caza — hay que releer el inventario a mano al mover piezas de sitio.)",
    ).toEqual([]);
  });

  /**
   * La mitad del cierre que sí se puede automatizar del todo: los FONDOS. Son pocos, se escriben
   * como utilidad, y **son ellos los que crean pares** — una tinta nueva sobre un fondo conocido
   * la caza el caso de arriba, y un fondo nuevo bajo una tinta conocida, éste. Lo único que se
   * escapa a los dos es recombinar tinta y fondo ya declarados, que es lo que el comentario de
   * arriba dice sin adornos.
   */
  it("CIERRE: la hoja no estrena superficies — los fondos son exactamente los medidos (R7)", () => {
    const fondos = [...new Set((hoja.match(/(?:[a-z]+:)?bg-[a-z][a-z0-9-]*(?:\/\d+)?/g) ?? []))].sort();
    expect(fondos, "el extractor de fondos no encontró nada: está midiendo una cadena vacía")
      .not.toEqual([]);

    // Los cinco fondos de las dos hojas, más la franja de marca (exenta, sin texto encima).
    expect(fondos).toEqual([
      "bg-brand",
      "bg-muted",
      "bg-muted/40",
      "bg-muted/50",
      "bg-success/15",
      "bg-warning/15",
      "hover:bg-muted/50",
    ]);
  });

  it("ningún par del inventario quedó obsoleto: sus utilidades siguen en la hoja (R7)", () => {
    // La otra mitad del cierre. Un par que ya no ocurre es ruido que da falsa sensación de
    // cobertura: se mide algo que la hoja no pinta y el número tranquiliza sin cubrir nada.
    const huerfanas = INVENTARIO.flatMap((p) => p.utilidades).filter(
      (u) => !hoja.includes(u),
    );
    expect(huerfanas).toEqual([]);
  });

  it("cada par medible tiene su suelo anotado, y ninguno quedó en cero", () => {
    // Un suelo en 0 pasa siempre: sería un par declarado que en realidad no vigila nada.
    for (const par of [...MEDIBLES, ...AJENOS]) {
      expect(SUELO[par.id], `${par.id} no tiene suelo anotado`).toBeDefined();
      expect(SUELO[par.id].claro).toBeGreaterThan(1);
      expect(SUELO[par.id].oscuro).toBeGreaterThan(1);
    }
  });
});
