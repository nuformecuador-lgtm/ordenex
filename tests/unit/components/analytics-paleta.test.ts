// Paleta de series del paquete de analitica (feature 130): R16-R19, R30.
// Sin DOM y sin React: es una funcion pura de indice a token.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  IndiceSerieFueraDeRangoError,
  TOKENS_SERIE,
  tokenDeSerie,
  varDeSerie,
} from "@/components/private/analytics/paleta";
import { MAX_SERIES } from "@/components/private/analytics/topes";
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
    for (let i = 0; i < MAX_SERIES; i += 1) {
      expect(tokenDeSerie(i)).toBe(tokenDeSerie(i));
      expect(varDeSerie(i)).toBe(varDeSerie(i));
    }
    expect(tokenDeSerie(0)).toBe("--chart-1");
    expect(varDeSerie(4)).toBe("var(--chart-5)");
  });

  it("los cinco indices del techo dan cinco tokens distintos: ninguna leyenda repite color", () => {
    const asignados = Array.from({ length: MAX_SERIES }, (_, i) => tokenDeSerie(i));
    expect(new Set(asignados).size).toBe(MAX_SERIES);
  });

  it("MAX_SERIES vale 5 y coincide con el numero de tokens declarados", () => {
    expect(MAX_SERIES).toBe(5);
    expect(TOKENS_SERIE).toHaveLength(MAX_SERIES);
  });

  it("no cicla: un indice fuera del techo es un error, no el color de otra serie", () => {
    expect(() => tokenDeSerie(MAX_SERIES)).toThrow(IndiceSerieFueraDeRangoError);
    expect(() => tokenDeSerie(-1)).toThrow(IndiceSerieFueraDeRangoError);
  });

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
