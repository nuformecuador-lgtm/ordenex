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

const RAIZ = process.cwd();
const PAQUETE = path.join(RAIZ, "components", "private", "analytics");

function archivosDelPaquete(dir: string = PAQUETE): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const completo = path.join(dir, entrada);
    return statSync(completo).isDirectory() ? archivosDelPaquete(completo) : [completo];
  });
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
    const css = readFileSync(path.join(RAIZ, "app", "globals.css"), "utf8");
    const bloque = (selector: string): string => {
      const inicio = css.indexOf(selector);
      expect(inicio, `no existe el bloque ${selector} en globals.css`).toBeGreaterThan(-1);
      const abre = css.indexOf("{", inicio);
      const cierra = css.indexOf("\n}", abre);
      return css.slice(abre, cierra);
    };
    const root = bloque(":root {");
    const oscuro = bloque(".dark {");
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
