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
