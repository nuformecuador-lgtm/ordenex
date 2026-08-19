// Paleta de series del paquete de analitica (feature 130): R16-R19, R30.
// Sin DOM y sin React: es una funcion pura de indice a token.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  COLORES_DISPONIBLES,
  IndiceSerieInvalidoError,
  TOKENS_SERIE,
  tokenDeSerie,
  varDeSerie,
} from "@/components/private/analytics/paleta";
// Feature 223 (R32): EL parser de reglas CSS del repo. Antes vivía copiado aquí abajo.
import { reglasDeArchivo } from "../../fixtures/css-reglas";

const RAIZ = process.cwd();
const PAQUETE = path.join(RAIZ, "components", "private", "analytics");

function archivosDelPaquete(dir: string = PAQUETE): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const completo = path.join(dir, entrada);
    return statSync(completo).isDirectory() ? archivosDelPaquete(completo) : [completo];
  });
}

/**
 * Cuerpos de TODAS las reglas cuya lista de selectores incluya `selector` como elemento
 * propio, sin importar el orden, los vecinos ni el espaciado: `:root {`, `:root,\n
 * .tema-claro {` y `.x, :root {` valen igual.
 *
 * Buscar la cadena literal `":root {"` no servía: el bloque de tokens se declara como
 * `:root,\n.tema-claro { … }`, así que la búsqueda se saltaba el bloque real y se
 * enganchaba al siguiente `:root {` del archivo (el de las variables de animación), donde
 * ningún `--chart-*` existe. Rojo por trocear mal, no por token ausente.
 *
 * ⚠️ Feature 223 (R32) — ESTE ARCHIVO TENÍA SU PROPIA COPIA del troceador (`selectoresDe` +
 * un recorrido de llaves + un quitador de comentarios escrito a mano). Eran la segunda copia
 * del parser de reglas del repo y el quitador propio que la feature 209 vino a cerrar. Hoy las
 * dos piezas salen del fixture compartido `tests/fixtures/css-reglas.ts`, que lee con el
 * quitador único. Lo que este archivo AFIRMA no cambia: sigue exigiendo que cada `--chart-N`
 * esté declarado en `:root` y en `.dark`.
 */
function cuerposDeRegla(selector: string): string[] {
  return reglasDeArchivo(path.join("app", "globals.css"))
    .filter((regla) => regla.selectores.includes(selector))
    .map((regla) =>
      Object.entries(regla.declaraciones)
        .map(([nombre, valor]) => `${nombre}: ${valor};`)
        .join("\n"),
    );
}

describe("paleta de series (R16-R19, R30)", () => {
  it("el color de una serie es determinista para el mismo indice", () => {
    for (let i = 0; i < COLORES_DISPONIBLES; i += 1) {
      expect(tokenDeSerie(i)).toBe(tokenDeSerie(i));
      expect(varDeSerie(i)).toBe(varDeSerie(i));
    }
    expect(tokenDeSerie(0)).toBe("--chart-1");
    expect(varDeSerie(4)).toBe("var(--chart-5, var(--chart-1))");
  });

  // Dentro de UNA vuelta ningun color se repite: es lo que necesita una leyenda para no
  // decir que dos categorias son la misma.
  it("los veinte indices de una vuelta dan veinte tokens distintos", () => {
    const asignados = Array.from({ length: COLORES_DISPONIBLES }, (_, i) => tokenDeSerie(i));
    expect(new Set(asignados).size).toBe(COLORES_DISPONIBLES);
  });

  // VEINTE y no cinco (decision humana del 2026-08-18). El numero no es arbitrario:
  // `ORDER_STATUS_SEED` tiene exactamente veinte valores, asi que el desglose mas ancho del
  // repo cabe entero sin que dos estados compartan color.
  it("hay veinte tokens declarados", () => {
    expect(COLORES_DISPONIBLES).toBe(20);
    expect(TOKENS_SERIE).toHaveLength(20);
  });

  // Los cinco primeros NO cambiaron de color al ampliar la paleta: cualquier grafica ya
  // publicada se sigue pintando igual. La mutacion que este caso mata es reordenar la lista.
  it("los cinco primeros tokens siguen siendo los de siempre", () => {
    expect(TOKENS_SERIE.slice(0, 5)).toEqual([
      "--chart-1",
      "--chart-2",
      "--chart-3",
      "--chart-4",
      "--chart-5",
    ]);
  });

  // ⚠ ESTE CASO SE DIO LA VUELTA EL 2026-08-18. Antes afirmaba que la paleta NO ciclaba y que
  // el indice 5 lanzaba. El motivo era bueno —dos categorias del mismo color se leen como la
  // misma— pero lo pagaba el dato: con cinco colores, el paquete RECORTABA a cinco categorias
  // y un desglose por estado perdia quince de veinte. Ahora cicla.
  it("CICLA: el indice 20 vuelve al primer token", () => {
    expect(tokenDeSerie(COLORES_DISPONIBLES)).toBe(tokenDeSerie(0));
    expect(tokenDeSerie(COLORES_DISPONIBLES + 3)).toBe(tokenDeSerie(3));
    expect(varDeSerie(COLORES_DISPONIBLES)).toBe("var(--chart-1)");
  });

  // ⚠ EL RESPALDO DEL `var()`, y por que existe. Al ampliar la paleta a veinte, el CSS que
  // servia el dev server siguio teniendo cinco tokens (cache de Turbopack) y las quince
  // porciones restantes salieron NEGRAS: es lo que pinta un `fill` cuya variable no resuelve.
  // Negro es indistinguible de una porcion real y no se parece a un error, asi que nadie lo
  // relaciona con un token que falta. Con respaldo, el peor caso es un color REPETIDO.
  it("todo token que no sea el primero lleva respaldo, para no pintar negro si falta", () => {
    // El primero no lo necesita: si faltara EL, no habria respaldo que valiera.
    expect(varDeSerie(0)).toBe("var(--chart-1)");

    for (let i = 1; i < COLORES_DISPONIBLES; i += 1) {
      expect(varDeSerie(i), `el token ${i} no lleva respaldo`).toBe(
        `var(--chart-${i + 1}, var(--chart-1))`,
      );
    }
  });

  // Y el respaldo NO enmascara el bug: el caso de abajo comprueba contra el CSS que los
  // veinte existen de verdad, asi que un token ausente sale rojo en el gate igual.
  it("el respaldo no sustituye a la comprobacion contra el CSS", () => {
    expect(TOKENS_SERIE).toHaveLength(20);
  });

  // Lo que SIGUE lanzando es la entrada imposible. Un indice negativo o fraccionario solo
  // puede venir de un bug del llamador, y devolverle un color enmascararia el fallo.
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "un indice invalido (%s) sigue siendo un error, no un color",
    (indice) => {
      expect(() => tokenDeSerie(indice)).toThrow(IndiceSerieInvalidoError);
    },
  );

  it("los tokens declarados existen en app/globals.css, en :root y en .dark", () => {
    const bloque = (selector: string): string => {
      const cuerpos = cuerposDeRegla(selector);
      expect(cuerpos.length, `no existe ninguna regla para ${selector} en globals.css`)
        .toBeGreaterThan(0);
      return cuerpos.join("\n");
    };
    const root = bloque(":root");
    const oscuro = bloque(".dark");
    for (const token of TOKENS_SERIE) {
      expect(root, `${token} falta en :root`).toContain(`${token}:`);
      expect(oscuro, `${token} falta en .dark`).toContain(`${token}:`);
    }
  });

  it("ningun archivo del paquete contiene un hex ni un color crudo de tailwind", () => {
    const hex = /#[0-9a-fA-F]{3,8}\b/;
    const escalaCruda =
      /\b(?:bg|text|border|fill|stroke|ring|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
    const arbitrario = /-\[#[0-9a-fA-F]{3,8}\]/;
    for (const archivo of archivosDelPaquete()) {
      const contenido = readFileSync(archivo, "utf8");
      expect(hex.test(contenido), `${archivo} contiene un hexadecimal`).toBe(false);
      expect(escalaCruda.test(contenido), `${archivo} usa la escala cruda de tailwind`).toBe(false);
      expect(arbitrario.test(contenido), `${archivo} usa un color arbitrario`).toBe(false);
    }
  });
});
