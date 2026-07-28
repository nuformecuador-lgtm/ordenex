import { describe, it, expect } from "vitest";
import {
  loadEtiquetasConfig,
  MAX_SIGNED_URL_TTL_SECONDS,
  MAX_ETIQUETAS_POR_PDF_HARD_CAP,
} from "@/lib/config/etiquetas";

// Feature 136/R18: el bucket privado y el TTL de la URL firmada se resuelven por
// env con default, sin hardcode (patron de lib/config/gestion.ts).
describe("loadEtiquetasConfig (R18)", () => {
  const KEYS = ["ETIQUETAS_BUCKET", "ETIQUETAS_SIGNED_URL_TTL_SECONDS", "ETIQUETAS_MAX_POR_PDF"];

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
      expect(cfg.MAX_ETIQUETAS_POR_PDF).toBe(300);
    });
  });

  // BLOQ-1: el tope existe para que la carga por API no pueda romperse generando
  // el PDF. Una env mal puesta no debe poder anularlo.
  it("respeta ETIQUETAS_MAX_POR_PDF de env", () => {
    process.env.ETIQUETAS_MAX_POR_PDF = "25";
    try {
      expect(loadEtiquetasConfig().MAX_ETIQUETAS_POR_PDF).toBe(25);
    } finally {
      delete process.env.ETIQUETAS_MAX_POR_PDF;
    }
  });

  it("acota ETIQUETAS_MAX_POR_PDF al techo duro", () => {
    process.env.ETIQUETAS_MAX_POR_PDF = String(MAX_ETIQUETAS_POR_PDF_HARD_CAP * 10);
    try {
      expect(loadEtiquetasConfig().MAX_ETIQUETAS_POR_PDF).toBe(MAX_ETIQUETAS_POR_PDF_HARD_CAP);
    } finally {
      delete process.env.ETIQUETAS_MAX_POR_PDF;
    }
  });

  it("cae al default con un ETIQUETAS_MAX_POR_PDF invalido o no positivo", () => {
    for (const raw of ["0", "-5", "no-es-numero"]) {
      process.env.ETIQUETAS_MAX_POR_PDF = raw;
      try {
        expect(loadEtiquetasConfig().MAX_ETIQUETAS_POR_PDF).toBe(300);
      } finally {
        delete process.env.ETIQUETAS_MAX_POR_PDF;
      }
    }
  });

  it("acota el TTL de la URL firmada a un maximo (no acepta cualquier positivo)", () => {
    process.env.ETIQUETAS_SIGNED_URL_TTL_SECONDS = String(365 * 24 * 3600);
    try {
      expect(loadEtiquetasConfig().SIGNED_URL_TTL_SECONDS).toBe(MAX_SIGNED_URL_TTL_SECONDS);
    } finally {
      delete process.env.ETIQUETAS_SIGNED_URL_TTL_SECONDS;
    }
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
