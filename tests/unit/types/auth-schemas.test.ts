import { describe, it, expect } from "vitest";
import {
  loginInputSchema,
  verifyChallengeInputSchema,
  numericIdentifierSchema,
} from "@/lib/types/auth";

describe("loginInputSchema", () => {
  it("rechaza un email con formato invalido (R8)", () => {
    const result = loginInputSchema.safeParse({ email: "no-es-un-email", password: "abc12345" });
    expect(result.success).toBe(false);
  });

  it("rechaza una contrasena vacia (R9)", () => {
    const result = loginInputSchema.safeParse({ email: "ana@example.com", password: "" });
    expect(result.success).toBe(false);
  });

  it("rechaza una contrasena que excede la longitud maxima (R9)", () => {
    const result = loginInputSchema.safeParse({
      email: "ana@example.com",
      password: "a".repeat(200),
    });
    expect(result.success).toBe(false);
  });

  it("acepta un email y contrasena validos", () => {
    const result = loginInputSchema.safeParse({ email: "ana@example.com", password: "abc12345" });
    expect(result.success).toBe(true);
  });
});

describe("verifyChallengeInputSchema", () => {
  it("rechaza un codigo que no es numerico", () => {
    const result = verifyChallengeInputSchema.safeParse({ challengeId: "otp-1", code: "abcdef" });
    expect(result.success).toBe(false);
  });

  it("rechaza un codigo con longitud distinta a 6", () => {
    const result = verifyChallengeInputSchema.safeParse({ challengeId: "otp-1", code: "12345" });
    expect(result.success).toBe(false);
  });

  it("acepta un challengeId y codigo validos", () => {
    const result = verifyChallengeInputSchema.safeParse({ challengeId: "otp-1", code: "123456" });
    expect(result.success).toBe(true);
  });
});

describe("numericIdentifierSchema (R10a)", () => {
  const schema = numericIdentifierSchema(7, 15);

  it("rechaza caracteres no numericos", () => {
    expect(schema.safeParse("17A0034065").success).toBe(false);
  });

  it("rechaza longitud menor al minimo configurado", () => {
    expect(schema.safeParse("123").success).toBe(false);
  });

  it("rechaza longitud mayor al maximo configurado", () => {
    expect(schema.safeParse("1".repeat(20)).success).toBe(false);
  });

  it("acepta una cadena numerica dentro del rango configurado", () => {
    expect(schema.safeParse("1710034065").success).toBe(true);
  });
});
