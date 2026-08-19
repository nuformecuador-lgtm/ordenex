// Feature 230 — GUARDIA MONEY-SAFE de la hoja fundida. Cubre R43 y R44.
//
// Los montos de un cierre son un SNAPSHOT: llegan como STRING de escala 2 y tienen que salir a la
// hoja tal cual. La forma en que este repo se ha equivocado antes con esto no es exótica —un
// `Number(x).toFixed(2)` puesto «para que se vea bonito»— y el daño tampoco: `0.1 + 0.2` en
// coma flotante son 0.30000000000000004, y una hoja de cálculo que alguien concilia a mano no
// avisa de la diferencia.
//
// Es una guardia de FUENTE porque lo que se prohíbe es la operación, no su resultado: un test de
// valores solo vería el redondeo cuando el fixture tuviera el decimal que lo delata.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");
const MODULO =
  "app/(app)/cierres-admin/_components/cierres-gestiones-fundida-descarga-columnas.ts";

/** Quita comentarios conservando líneas: aquí la prosa NOMBRA lo prohibido, a propósito. */
function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_todo, previo: string) => previo);
}

describe("la hoja fundida es money-safe (R43/R44)", () => {
  const bruto = readFileSync(path.join(RAIZ, MODULO), "utf8");
  const codigo = sinComentarios(bruto);

  it("el módulo de la fundida no contiene parseFloat, Number ni aritmética sobre montos (R44)", () => {
    // No-vacuidad: si el archivo se moviera, esto lo diría en vez de pasar verde sobre el vacío.
    expect(codigo).toContain("filaDescargaGestionFundida");
    expect(bruto).toContain("MONEY-SAFE");

    expect(codigo).not.toMatch(/\bparseFloat\b/);
    expect(codigo).not.toMatch(/\bparseInt\b/);
    expect(codigo).not.toMatch(/\bNumber\s*\(/);
    expect(codigo).not.toMatch(/\btoFixed\b/);
    expect(codigo).not.toMatch(/\bMath\./);
    // Ni el formateador de PANTALLA: `money()` incrusta el símbolo de la moneda, y una celda de
    // hoja de cálculo con «₡1.000,10» dentro deja de ser un número para quien la suma.
    expect(codigo).not.toMatch(/\bmoney\s*\(/);
    // Ni aritmética: `+` solo aparece en concatenación de texto, y ni eso hace este módulo.
    expect(codigo).not.toMatch(/[a-zA-Z0-9_)\]]\s*[*/%-]\s*[a-zA-Z0-9_(]*monto/i);
    expect(codigo).not.toMatch(/monto[a-zA-Z]*\s*[+*/%-]\s*[a-zA-Z0-9_(]/);
  });

  it("tampoco emite el símbolo de la moneda ni separadores de miles (R43)", () => {
    expect(codigo).not.toMatch(/[₡$€]/);
    expect(codigo).not.toMatch(/toLocaleString/);
    expect(codigo).not.toMatch(/Intl\.NumberFormat/);
  });
});
