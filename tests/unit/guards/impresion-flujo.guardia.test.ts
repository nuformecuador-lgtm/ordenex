import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

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
