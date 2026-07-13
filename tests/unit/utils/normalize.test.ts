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
  });

  it("es idempotente sobre un valor ya normalizado", () => {
    expect(normalizeName("liberia")).toBe("liberia");
  });

  it("cadena vacia -> vacia", () => {
    expect(normalizeName("   ")).toBe("");
  });
});
