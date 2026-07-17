import { describe, it, expect } from "vitest";
import {
  API_KEY_PREFIX,
  PREFIX_VISIBLE_CHARS,
  generateApiKey,
} from "@/lib/utils/api-key-generator";

// Feature 81 [D3] — generacion del secreto (R14/R15/R17/R22).

describe("generateApiKey (feature 81, R14/R15/R17/R22)", () => {
  it("R15: genera un secreto en claro con el prefijo identificable `ordx_`", () => {
    const { plain } = generateApiKey();
    expect(plain.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(API_KEY_PREFIX).toBe("ordx_");
  });

  it("R14: el secreto lleva 256 bits de entropia (32 bytes en base64url = 43 chars)", () => {
    const { plain } = generateApiKey();
    const secreto = plain.slice(API_KEY_PREFIX.length);
    // 32 bytes en base64url, sin padding: ceil(32*8/6) = 43 chars.
    expect(secreto).toHaveLength(43);
    // base64url: solo [A-Za-z0-9_-], nunca '+', '/' ni '=' (seguro en headers/URLs).
    expect(secreto).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(plain).toHaveLength(API_KEY_PREFIX.length + 43);
  });

  it("R17: el `prefix` son los primeros 12 chars del secreto completo y no lo revela", () => {
    const { plain, prefix } = generateApiKey();
    expect(prefix).toHaveLength(PREFIX_VISIBLE_CHARS);
    expect(prefix).toBe(plain.slice(0, PREFIX_VISIBLE_CHARS));
    expect(prefix.startsWith(API_KEY_PREFIX)).toBe(true);
    // El prefijo expone 7 chars del secreto: el resto (36 chars ~ 216 bits) sigue oculto.
    expect(plain.length).toBeGreaterThan(prefix.length);
    expect(plain).not.toBe(prefix);
  });

  it("R14/R22: 1000 generaciones no colisionan (aleatoriedad criptografica)", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) keys.add(generateApiKey().plain);
    expect(keys.size).toBe(1000);
  });

  it("R22: dos generaciones consecutivas dan secretos distintos (el id no entra en el calculo)", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.plain).not.toBe(b.plain);
  });
});
