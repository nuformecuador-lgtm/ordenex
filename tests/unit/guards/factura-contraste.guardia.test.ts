import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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

  it("el indicador de la pestaña activa usa un token que gira, no el de marca (R3)", () => {
    // `border-foreground` y no `border-primary`: en ese mismo condicional se pinta el borde Y la
    // etiqueta, y `--primary` (3.18 sobre blanco) cumple el 3:1 de componente pero no el 4.5:1 de
    // texto — es la deuda que la ficha 216 tiene abierta.
    expect(cuantas(hoja, /\bborder-foreground\b/)).toBeGreaterThanOrEqual(1);
    expect(hoja).not.toMatch(/\bborder-primary\b/);
  });
});
