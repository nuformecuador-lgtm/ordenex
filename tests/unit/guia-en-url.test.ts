import { describe, it, expect } from "vitest";

import { numGuiaDeQuery, PARAM_GUIA } from "@/app/_landing/guia-en-url";

// La normalización del `?guia=` de la landing. Es el único punto donde una cadena de la URL
// —dato de fuera, sin sesión— decide algo, así que se mide lo que ACEPTA y lo que DESCARTA.

describe("numGuiaDeQuery — acepta la guía y descarta lo demás", () => {
  it("el parámetro se llama `guia`", () => {
    expect(PARAM_GUIA).toBe("guia");
  });

  it("devuelve la CADENA tal cual cuando es un entero positivo", () => {
    // Cadena y no número: su destino es el `value` de un `<input>`.
    expect(numGuiaDeQuery("4321")).toBe("4321");
    expect(numGuiaDeQuery("1")).toBe("1");
  });

  it("descarta lo que no es una guía", () => {
    for (const entrada of ["", "abc", "-3", "0", "007", "4321a", "43 21", "4.321", "1e3"]) {
      expect(numGuiaDeQuery(entrada), `aceptó ${JSON.stringify(entrada)}`).toBeNull();
    }
  });

  it("descarta la ausencia y el parámetro REPETIDO", () => {
    // `?guia=1&guia=2` llega como array: elegir uno sería adivinar.
    expect(numGuiaDeQuery(undefined)).toBeNull();
    expect(numGuiaDeQuery(["1", "2"])).toBeNull();
    expect(numGuiaDeQuery(["4321"])).toBeNull();
  });

  it("descarta una cadena arbitrariamente larga aunque sean todo dígitos", () => {
    expect(numGuiaDeQuery("9".repeat(12))).toBe("9".repeat(12));
    expect(numGuiaDeQuery("9".repeat(13))).toBeNull();
    expect(numGuiaDeQuery("9".repeat(5000))).toBeNull();
  });
});
