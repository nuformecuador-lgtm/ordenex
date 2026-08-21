import { describe, it, expect, afterEach } from "vitest";
import { loadPostulacionRecursoConfig } from "@/lib/config/postulacion-recurso";

// Feature 253 (T2.2) — la config de la postulacion de recurso: defaults FIRMADOS y override por
// entorno. Molde: `tests/unit/config/purga-pdf-config.test.ts`.

const VARIABLES = [
  "POSTULACION_RECURSO_NOMBRE_MAX_CHARS",
  "POSTULACION_RECURSO_TELEFONO_MAX_CHARS",
  "POSTULACION_RECURSO_CORREO_MAX_CHARS",
  "POSTULACION_RECURSO_MENSAJE_MAX_CHARS",
  "POSTULACION_RECURSO_RATE_MAX",
  "POSTULACION_RECURSO_RATE_WINDOW_MINUTES",
  "POSTULACION_RECURSO_PAGE_SIZE_DEFAULT",
  "POSTULACION_RECURSO_PAGE_SIZE_MAX",
  "POSTULACION_RECURSO_PURGA_RETENCION_MESES",
  "POSTULACION_RECURSO_PURGA_MAX_POR_CORRIDA",
] as const;

afterEach(() => {
  for (const v of VARIABLES) delete process.env[v];
});

describe("253 — defaults FIRMADOS (D3, D4, P2)", () => {
  it("son exactamente estos, escritos como literales", () => {
    // Literales a proposito: son las cifras que el humano firmo. Derivarlas de la propia constante
    // que las produce dejaria el test siempre verde y no diria nada.
    expect(loadPostulacionRecursoConfig()).toEqual({
      NOMBRE_MAX_CHARS: 120,
      TELEFONO_MAX_CHARS: 30,
      CORREO_MAX_CHARS: 254,
      MENSAJE_MAX_CHARS: 1000, // D3
      RATE_MAX: 3, // D4: los defaults de la feature 21
      RATE_WINDOW_MINUTES: 60, // D4
      PAGE_SIZE_DEFAULT: 20,
      PAGE_SIZE_MAX: 50,
      PURGA_RETENCION_MESES: 6, // P2: «borrar las atendidas a los 6 meses»
      PURGA_MAX_POR_CORRIDA: 500,
    });
  });
});

describe("253 — el entorno manda, y lo invalido cae al default", () => {
  it("un valor valido en el entorno sobreescribe el default", () => {
    process.env.POSTULACION_RECURSO_MENSAJE_MAX_CHARS = "2500";
    process.env.POSTULACION_RECURSO_RATE_MAX = "9";
    process.env.POSTULACION_RECURSO_PURGA_RETENCION_MESES = "12";
    const cfg = loadPostulacionRecursoConfig();
    expect(cfg.MENSAJE_MAX_CHARS).toBe(2500);
    expect(cfg.RATE_MAX).toBe(9);
    expect(cfg.PURGA_RETENCION_MESES).toBe(12);
  });

  it.each(["", "abc", "-4", "0", "  "])(
    "un valor invalido (%p) NO desactiva la cota: cae al default",
    (raw) => {
      process.env.POSTULACION_RECURSO_MENSAJE_MAX_CHARS = raw;
      process.env.POSTULACION_RECURSO_PURGA_RETENCION_MESES = raw;
      const cfg = loadPostulacionRecursoConfig();
      expect(cfg.MENSAJE_MAX_CHARS).toBe(1000);
      expect(cfg.PURGA_RETENCION_MESES).toBe(6);
    },
  );

  it("un valor MEDIO numerico se trunca, no cae al default — y queda escrito porque sorprende", () => {
    // `readPositiveInt` usa `Number.parseInt`, que lee `"3.7.1"` como `3`. No es un defecto de
    // esta feature: es el helper que este repo tiene copiado en ~8 modulos de `lib/config/`. Se
    // fija aqui para que nadie descubra a mano que `POSTULACION_RECURSO_PURGA_RETENCION_MESES=6.5`
    // da SEIS meses y no seis y medio — en una purga irreversible, saber esto importa.
    process.env.POSTULACION_RECURSO_PURGA_RETENCION_MESES = "6.5";
    expect(loadPostulacionRecursoConfig().PURGA_RETENCION_MESES).toBe(6);
    process.env.POSTULACION_RECURSO_PURGA_RETENCION_MESES = "3.7.1";
    expect(loadPostulacionRecursoConfig().PURGA_RETENCION_MESES).toBe(3);
  });

  it("`0` NO es un valor valido para la retencion de la purga, y esto es deliberado", () => {
    // Con `0` el corte seria el instante de la corrida y se borraria lo atendido HOY MISMO. En una
    // purga irreversible el fallo seguro es NO borrar, asi que `0` cae al default en vez de
    // aceptarse (al reves que `PURGA_PDF_RETENCION_DIAS`, donde `0` si es un valor legitimo).
    process.env.POSTULACION_RECURSO_PURGA_RETENCION_MESES = "0";
    expect(loadPostulacionRecursoConfig().PURGA_RETENCION_MESES).toBe(6);
  });

  it("la config se relee en cada llamada (una corrida nueva ve el valor nuevo)", () => {
    expect(loadPostulacionRecursoConfig().RATE_MAX).toBe(3);
    process.env.POSTULACION_RECURSO_RATE_MAX = "11";
    expect(loadPostulacionRecursoConfig().RATE_MAX).toBe(11);
  });
});
