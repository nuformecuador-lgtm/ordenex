import { describe, it, expect } from "vitest";
import { normalizeName } from "@/lib/utils/normalize";

describe("normalizeName", () => {
  it("pasa a minusculas", () => {
    expect(normalizeName("GUANACASTE")).toBe("guanacaste");
  });

  it("elimina acentos/diacriticos", () => {
    expect(normalizeName("Pérez Zeledón")).toBe("perez zeledon");
    expect(normalizeName("Cañas Dulces")).toBe("canas dulces");
    expect(normalizeName("Curubandé")).toBe("curubande");
  });

  it("hace trim y colapsa espacios internos", () => {
    expect(normalizeName("  San   José ")).toBe("san jose");
    expect(normalizeName("San  Pedro")).toBe("san pedro");
  });

  it("elimina caracteres especiales/puntuacion (los vuelve espacio)", () => {
    expect(normalizeName("San José-Centro")).toBe("san jose centro");
    expect(normalizeName("Aguirre (Quepos)")).toBe("aguirre quepos");
    expect(normalizeName("Sarapiquí, La Virgen.")).toBe("sarapiqui la virgen");
    expect(normalizeName("San   Pedro / Montes de Oca")).toBe("san pedro montes de oca");
  });

  it("es idempotente sobre un valor ya normalizado", () => {
    expect(normalizeName("liberia")).toBe("liberia");
    expect(normalizeName("san jose")).toBe("san jose");
  });

  it("cadena vacia -> vacia", () => {
    expect(normalizeName("   ")).toBe("");
  });
});
