import { describe, it, expect } from "vitest";
import {
  loadEtiquetasConfig,
  MAX_SIGNED_URL_TTL_SECONDS,
  MAX_ETIQUETAS_POR_PDF_HARD_CAP,
} from "@/lib/config/etiquetas";

// Feature 136/R18: el bucket privado y el TTL de la URL firmada se resuelven por
// env con default, sin hardcode (patron de lib/config/gestion.ts).
describe("loadEtiquetasConfig (R18)", () => {
  const KEYS = [
    "ETIQUETAS_BUCKET",
    "ETIQUETAS_SIGNED_URL_TTL_SECONDS",
    "ETIQUETAS_MAX_POR_PDF",
    "ETIQUETAS_API_SIGNED_URL_TTL_SECONDS",
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

  // Feature 177 (T5): el TTL de las URL firmadas de los endpoints /generate de la API
  // de consulta es una clave APARTE, configurable por env y acotada.
  describe("API_SIGNED_URL_TTL_SECONDS (R24, R43)", () => {
    const ENV = "ETIQUETAS_API_SIGNED_URL_TTL_SECONDS";

    it("vale 300 segundos por defecto cuando la env no esta definida", () => {
      withoutEnv(() => {
        expect(loadEtiquetasConfig().API_SIGNED_URL_TTL_SECONDS).toBe(300);
      });
    });

    it("respeta el valor de ETIQUETAS_API_SIGNED_URL_TTL_SECONDS cuando es un entero positivo valido", () => {
      withoutEnv(() => {
        process.env[ENV] = "120";
        expect(loadEtiquetasConfig().API_SIGNED_URL_TTL_SECONDS).toBe(120);
      });
    });

    it("cae al default de 300 cuando la env es cero, negativa o no numerica", () => {
      withoutEnv(() => {
        for (const raw of ["0", "-30", "no-es-numero"]) {
          process.env[ENV] = raw;
          expect(loadEtiquetasConfig().API_SIGNED_URL_TTL_SECONDS).toBe(300);
        }
      });
    });

    it("acota la env al maximo cuando pide un TTL mayor que MAX_SIGNED_URL_TTL_SECONDS", () => {
      withoutEnv(() => {
        process.env[ENV] = String(MAX_SIGNED_URL_TTL_SECONDS + 1);
        expect(loadEtiquetasConfig().API_SIGNED_URL_TTL_SECONDS).toBe(MAX_SIGNED_URL_TTL_SECONDS);
        process.env[ENV] = String(365 * 24 * 3600);
        expect(loadEtiquetasConfig().API_SIGNED_URL_TTL_SECONDS).toBe(MAX_SIGNED_URL_TTL_SECONDS);
      });
    });

    it("no altera SIGNED_URL_TTL_SECONDS, que sigue valiendo 3600 aunque se configure el TTL de la API", () => {
      withoutEnv(() => {
        process.env[ENV] = "60";
        const cfg = loadEtiquetasConfig();
        expect(cfg.SIGNED_URL_TTL_SECONDS).toBe(3600);
        expect(cfg.API_SIGNED_URL_TTL_SECONDS).toBe(60);
      });
    });
  });
});
