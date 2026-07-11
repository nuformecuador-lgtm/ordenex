import { describe, it, expect } from "vitest";
import {
  GESTION_ALLOWED_MIME,
  GESTION_MIME_EXTENSION,
  loadGestionConfig,
} from "@/lib/config/gestion";

// Feature 36/R8/R24 (decision F1.4-f): config del bucket privado NUEVO de
// evidencias + cotas de foto, todo por env, sin hardcode.
describe("loadGestionConfig (R8/R24)", () => {
  const KEYS = [
    "GESTION_MAX_FILE_BYTES",
    "GESTION_EVIDENCIA_BUCKET",
    "GESTION_SIGNED_URL_TTL_SECONDS",
  ];

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

  it("R8: bucket privado NUEVO por defecto 'gestion-evidencias' (F1.4-f, no reusa mensajero-docs)", () => {
    withoutEnv(() => {
      const cfg = loadGestionConfig();
      expect(cfg.EVIDENCIA_BUCKET).toBe("gestion-evidencias");
      expect(cfg.EVIDENCIA_BUCKET).not.toBe("mensajero-docs");
    });
  });

  it("R24: valores por defecto (5 MB, TTL 300s) overridables por env", () => {
    withoutEnv(() => {
      const cfg = loadGestionConfig();
      expect(cfg.MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
      expect(cfg.SIGNED_URL_TTL_SECONDS).toBe(300);
    });

    process.env.GESTION_MAX_FILE_BYTES = "1024";
    process.env.GESTION_EVIDENCIA_BUCKET = "otro-bucket";
    process.env.GESTION_SIGNED_URL_TTL_SECONDS = "60";
    try {
      const cfg = loadGestionConfig();
      expect(cfg.MAX_FILE_BYTES).toBe(1024);
      expect(cfg.EVIDENCIA_BUCKET).toBe("otro-bucket");
      expect(cfg.SIGNED_URL_TTL_SECONDS).toBe(60);
    } finally {
      delete process.env.GESTION_MAX_FILE_BYTES;
      delete process.env.GESTION_EVIDENCIA_BUCKET;
      delete process.env.GESTION_SIGNED_URL_TTL_SECONDS;
    }
  });

  it("R24: solo acepta imagenes jpeg/png/webp", () => {
    expect([...GESTION_ALLOWED_MIME]).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(GESTION_MIME_EXTENSION["image/jpeg"]).toBe("jpg");
    expect(GESTION_MIME_EXTENSION["image/png"]).toBe("png");
    expect(GESTION_MIME_EXTENSION["image/webp"]).toBe("webp");
  });
});
