import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { hashApiKey } from "@/lib/utils/api-key-hash";
import { generateApiKey } from "@/lib/utils/api-key-generator";

// Feature 81 [D7] — hasheo de la key con SHA-256 (R16). NO bcrypt: ver design §5.

describe("hashApiKey (feature 81, R16/[D7])", () => {
  it("R16: produce un SHA-256 en hex (64 chars)", () => {
    const hash = hashApiKey("ordx_secreto-de-prueba");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[D7]: es determinista, lo que permite el lookup por indice UNIQUE (a diferencia de bcrypt)", () => {
    const { plain } = generateApiKey();
    expect(hashApiKey(plain)).toBe(hashApiKey(plain));
  });

  it("[D7]: coincide con el SHA-256 canonico del secreto", () => {
    const plain = "ordx_abc123";
    const esperado = createHash("sha256").update(plain, "utf8").digest("hex");
    expect(hashApiKey(plain)).toBe(esperado);
  });

  it("R16: entradas distintas dan hashes distintos", () => {
    expect(hashApiKey("ordx_aaa")).not.toBe(hashApiKey("ordx_aab"));
  });

  it("R16: el hash no contiene el secreto en claro", () => {
    const { plain } = generateApiKey();
    const hash = hashApiKey(plain);
    expect(hash).not.toContain(plain);
    expect(hash).not.toContain(plain.slice(API_KEY_PREFIX_LEN));
  });
});

const API_KEY_PREFIX_LEN = "ordx_".length;
