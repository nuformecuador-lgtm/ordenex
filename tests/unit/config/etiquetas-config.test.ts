import { describe, it, expect } from "vitest";
import { loadEtiquetasConfig } from "@/lib/config/etiquetas";

// Feature 112/R18: el bucket privado y el TTL de la URL firmada se resuelven por
// env con default, sin hardcode (patron de lib/config/gestion.ts).
describe("loadEtiquetasConfig (R18)", () => {
  const KEYS = ["ETIQUETAS_BUCKET", "ETIQUETAS_SIGNED_URL_TTL_SECONDS"];

  function withoutEnv<T>(fn: () => T): T {
    const saved: Record<string, string | undefined> = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      return fn();
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  it("usa defaults cuando las env no estan", () => {
    withoutEnv(() => {
      const cfg = loadEtiquetasConfig();
      expect(cfg.ETIQUETAS_BUCKET).toBe("etiquetas-guia");
      expect(cfg.SIGNED_URL_TTL_SECONDS).toBe(3600);
    });
  });

  it("respeta ETIQUETAS_BUCKET / TTL de env", () => {
    process.env.ETIQUETAS_BUCKET = "otro-bucket-privado";
    process.env.ETIQUETAS_SIGNED_URL_TTL_SECONDS = "900";
    try {
      const cfg = loadEtiquetasConfig();
      expect(cfg.ETIQUETAS_BUCKET).toBe("otro-bucket-privado");
      expect(cfg.SIGNED_URL_TTL_SECONDS).toBe(900);
    } finally {
      delete process.env.ETIQUETAS_BUCKET;
      delete process.env.ETIQUETAS_SIGNED_URL_TTL_SECONDS;
    }
  });
});
