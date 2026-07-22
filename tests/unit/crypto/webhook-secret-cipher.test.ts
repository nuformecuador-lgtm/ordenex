import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  cifrarSecreto,
  descifrarSecreto,
  WebhookSecretKeyError,
} from "@/lib/crypto/webhook-secret-cipher";

// Feature 99 (R32) — cifrar y descifrar es round-trip fiel; sin clave configurada el
// descifrado lanza error recuperable sin filtrar el secreto; authTag corrupto lanza.

const CLAVE_B64 = randomBytes(32).toString("base64");
const CLAVE_HEX = randomBytes(32).toString("hex");
const SECRETO = "ordx_whsec_super-secreto-de-firma-123";

describe("R32 — round-trip de cifrado del secreto", () => {
  it("descifrar(cifrar(s)) === s con clave en base64", () => {
    const empaquetado = cifrarSecreto(CLAVE_B64, SECRETO);
    expect(empaquetado).not.toContain(SECRETO); // ciphertext, no texto plano
    expect(empaquetado.startsWith("v1:")).toBe(true);
    expect(descifrarSecreto(CLAVE_B64, empaquetado)).toBe(SECRETO);
  });

  it("descifrar(cifrar(s)) === s con clave en hex", () => {
    const empaquetado = cifrarSecreto(CLAVE_HEX, SECRETO);
    expect(descifrarSecreto(CLAVE_HEX, empaquetado)).toBe(SECRETO);
  });

  it("dos cifrados del mismo secreto difieren (IV aleatorio) pero descifran igual", () => {
    const a = cifrarSecreto(CLAVE_B64, SECRETO);
    const b = cifrarSecreto(CLAVE_B64, SECRETO);
    expect(a).not.toBe(b);
    expect(descifrarSecreto(CLAVE_B64, a)).toBe(SECRETO);
    expect(descifrarSecreto(CLAVE_B64, b)).toBe(SECRETO);
  });
});

describe("R32 — clave ausente = error recuperable sin filtrar el secreto", () => {
  it("descifrarSecreto(null, ...) lanza WebhookSecretKeyError y el error NO contiene el secreto", () => {
    const empaquetado = cifrarSecreto(CLAVE_B64, SECRETO);
    let capturado: unknown;
    try {
      descifrarSecreto(null, empaquetado);
    } catch (e) {
      capturado = e;
    }
    expect(capturado).toBeInstanceOf(WebhookSecretKeyError);
    expect((capturado as Error).message).not.toContain(SECRETO);
  });

  it("cifrar sin clave configurada lanza WebhookSecretKeyError", () => {
    expect(() => cifrarSecreto(null, SECRETO)).toThrow(WebhookSecretKeyError);
    expect(() => cifrarSecreto("", SECRETO)).toThrow(WebhookSecretKeyError);
  });
});

describe("R32 — integridad", () => {
  it("un authTag corrupto lanza WebhookSecretKeyError (verificacion de integridad)", () => {
    const empaquetado = cifrarSecreto(CLAVE_B64, SECRETO);
    const partes = empaquetado.split(":");
    // Corromper el authTag (3.er campo) manteniendo su longitud en bytes.
    partes[2] = randomBytes(16).toString("base64");
    expect(() => descifrarSecreto(CLAVE_B64, partes.join(":"))).toThrow(WebhookSecretKeyError);
  });

  it("un formato no reconocido lanza WebhookSecretKeyError", () => {
    expect(() => descifrarSecreto(CLAVE_B64, "texto-plano")).toThrow(WebhookSecretKeyError);
    expect(() => descifrarSecreto(CLAVE_B64, "v2:a:b:c")).toThrow(WebhookSecretKeyError);
  });
});
