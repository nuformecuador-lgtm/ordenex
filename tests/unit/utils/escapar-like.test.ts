import { describe, it, expect } from "vitest";
import { escaparComodinesLike } from "@/lib/utils/escapar-like";

/**
 * Feature 285 (T1.3 / T2.3) — el escapador de comodines de `LIKE`/`ILIKE`.
 *
 * Estos casos afirman la TRANSFORMACION de texto. Que el escapado sirva de verdad —que buscar
 * `"a%"` no devuelva a `Ana`— solo lo puede demostrar Postgres, y eso vive en
 * `tests/integration/db/usuarios-filtro-busqueda.test.ts` (T-I4).
 */
describe("285 — escaparComodinesLike", () => {
  it("escapa el porcentaje: sin esto, `%` devuelve el listado entero (R5)", () => {
    expect(escaparComodinesLike("100%")).toBe("100\\%");
    expect(escaparComodinesLike("%")).toBe("\\%");
    expect(escaparComodinesLike("a%b")).toBe("a\\%b");
  });

  it("escapa el guion bajo, que casa con cualquier caracter (R5)", () => {
    expect(escaparComodinesLike("_")).toBe("\\_");
    expect(escaparComodinesLike("ana_rojas")).toBe("ana\\_rojas");
  });

  it("escapa el propio backslash, y lo hace en UNA sola pasada", () => {
    // El `\` va PRIMERO en la clase de caracteres justamente para esto: si se procesara al
    // final, re-escaparia las barras que el mismo acaba de introducir.
    expect(escaparComodinesLike("\\")).toBe("\\\\");
    expect(escaparComodinesLike("\\%")).toBe("\\\\\\%");
  });

  it("no toca el texto que no lleva comodines", () => {
    expect(escaparComodinesLike("Ana Rojas")).toBe("Ana Rojas");
    expect(escaparComodinesLike("ana@ejemplo.cr")).toBe("ana@ejemplo.cr");
    expect(escaparComodinesLike("")).toBe("");
  });

  it("escapa TODAS las apariciones, no solo la primera", () => {
    expect(escaparComodinesLike("%a%b%")).toBe("\\%a\\%b\\%");
    expect(escaparComodinesLike("_a_b_")).toBe("\\_a\\_b\\_");
  });
});
