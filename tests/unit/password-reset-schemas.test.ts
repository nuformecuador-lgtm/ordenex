import { describe, it, expect } from "vitest";
import {
  requestResetSchema,
  verifyResetCodeSchema,
  resetPasswordSchema,
} from "@/lib/types/password-reset";

// Feature 20 / R7 (mas R8 via composicion).

describe("resetPasswordSchema (R7/R8)", () => {
  const base = { email: "ana@example.com", code: "123456" };

  it("acepta una entrada valida", () => {
    const result = resetPasswordSchema.safeParse({
      ...base,
      password: "Abcdef1!",
      confirmPassword: "Abcdef1!",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza cuando password y confirmacion difieren (R7)", () => {
    const result = resetPasswordSchema.safeParse({
      ...base,
      password: "Abcdef1!",
      confirmPassword: "Otra1234!",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.confirmPassword).toBeDefined();
    }
  });

  it("rechaza password que no cumple la politica (R8)", () => {
    const result = resetPasswordSchema.safeParse({
      ...base,
      password: "debil",
      confirmPassword: "debil",
    });
    expect(result.success).toBe(false);
  });
});

describe("requestResetSchema / verifyResetCodeSchema", () => {
  it("requestResetSchema rechaza email invalido", () => {
    expect(requestResetSchema.safeParse({ email: "no-email" }).success).toBe(false);
  });

  it("verifyResetCodeSchema exige 6 digitos", () => {
    expect(
      verifyResetCodeSchema.safeParse({ email: "ana@example.com", code: "12345" }).success,
    ).toBe(false);
    expect(
      verifyResetCodeSchema.safeParse({ email: "ana@example.com", code: "123456" }).success,
    ).toBe(true);
  });
});
