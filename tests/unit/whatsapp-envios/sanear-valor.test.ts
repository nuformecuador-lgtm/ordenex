import { describe, it, expect } from "vitest";
import { sanearValor, valorPresente } from "@/lib/whatsapp-envios/sanear-valor";

// Ficha 474 (T2.2, R32) — Meta rechaza saltos de linea, tabuladores y mas de 4 espacios seguidos.

describe("474/R32 — sanearValor", () => {
  it("saltos de linea y tabuladores pasan a un espacio", () => {
    expect(sanearValor("a\nb\r\nc\rd\te")).toBe("a b c d e");
  });

  it("rachas de espacios se colapsan a uno y se recorta", () => {
    expect(sanearValor("   hola      mundo  ")).toBe("hola mundo");
  });

  it("nunca deja mas de cuatro espacios seguidos", () => {
    expect(sanearValor("x\n\n\n\n\n\ny")).not.toMatch(/ {5,}/);
    expect(sanearValor("x\n\n\n\n\n\ny")).toBe("x y");
  });

  it("un valor que queda vacio tras sanear es FALTANTE", () => {
    expect(valorPresente(" \n\t ")).toBe(false);
    expect(valorPresente("")).toBe(false);
    expect(valorPresente(undefined)).toBe(false);
    expect(valorPresente("ok")).toBe(true);
  });
});
