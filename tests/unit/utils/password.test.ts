import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/utils/password";

describe("password hashing", () => {
  it("el hash nunca es igual al texto plano (R6)", async () => {
    const plain = "una-contrasena-segura-123";
    const hash = await hashPassword(plain);
    expect(hash).not.toBe(plain);
    expect(hash.length).toBeGreaterThan(0);
  });

  it("verifyPassword devuelve true cuando el texto plano coincide con el hash", async () => {
    const plain = "otra-contrasena-456";
    const hash = await hashPassword(plain);
    await expect(verifyPassword(plain, hash)).resolves.toBe(true);
  });

  it("verifyPassword devuelve false cuando el texto plano no coincide", async () => {
    const hash = await hashPassword("la-correcta");
    await expect(verifyPassword("la-incorrecta", hash)).resolves.toBe(false);
  });
});
