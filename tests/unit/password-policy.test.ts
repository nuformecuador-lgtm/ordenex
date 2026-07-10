import { describe, it, expect } from "vitest";
import { strongPasswordSchema } from "@/lib/types/password-policy";

// Feature 20 / R8: politica de contrasena fuerte reutilizable.

describe("strongPasswordSchema (R8)", () => {
  it("acepta una contrasena valida", () => {
    expect(strongPasswordSchema.safeParse("Abcdef1!").success).toBe(true);
  });

  it("rechaza menos de 8 caracteres", () => {
    expect(strongPasswordSchema.safeParse("Ab1!").success).toBe(false);
  });

  it("rechaza mas de 72 caracteres", () => {
    const larga = "Ab1!" + "a".repeat(70); // 74 chars
    expect(strongPasswordSchema.safeParse(larga).success).toBe(false);
  });

  it("rechaza sin mayuscula", () => {
    expect(strongPasswordSchema.safeParse("abcdef1!").success).toBe(false);
  });

  it("rechaza sin minuscula", () => {
    expect(strongPasswordSchema.safeParse("ABCDEF1!").success).toBe(false);
  });

  it("rechaza sin digito", () => {
    expect(strongPasswordSchema.safeParse("Abcdefg!").success).toBe(false);
  });

  it("rechaza sin simbolo", () => {
    expect(strongPasswordSchema.safeParse("Abcdefg1").success).toBe(false);
  });
});
