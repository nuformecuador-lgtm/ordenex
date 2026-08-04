import { describe, it, expect, afterEach } from "vitest";
import * as purgaPdfModule from "@/lib/config/purga-pdf";
import { loadPurgaPdfConfig } from "@/lib/config/purga-pdf";

// Feature 178 (T4) — `loadPurgaPdfConfig()` resuelve la ventana de retencion y el tope
// por corrida desde env, EN CADA LLAMADA (R4). El `0` de la retencion es VALIDO (R3) y
// no hay tope superior; por eso este modulo no puede reutilizar el `readPositiveInt`
// de `lib/config/jobs.ts` / `lib/config/etiquetas.ts`.

const ENVS = ["PURGA_PDF_RETENCION_DIAS", "PURGA_PDF_MAX_CARGAS_POR_CORRIDA"] as const;

afterEach(() => {
  for (const name of ENVS) delete process.env[name];
});

describe("loadPurgaPdfConfig — retencion (R1, R2, R3)", () => {
  it("R1: lee la retencion de la variable de entorno PURGA_PDF_RETENCION_DIAS", () => {
    process.env.PURGA_PDF_RETENCION_DIAS = "1";
    expect(loadPurgaPdfConfig().PURGA_PDF_RETENCION_DIAS).toBe(1);
  });

  it("R2: sin la env definida, la retencion vale 7 dias", () => {
    expect(process.env.PURGA_PDF_RETENCION_DIAS).toBeUndefined();
    expect(loadPurgaPdfConfig().PURGA_PDF_RETENCION_DIAS).toBe(7);
  });

  it("R2: una retencion vacia, no numerica o negativa cae al default de 7 dias", () => {
    for (const raw of ["", "abc", "-1"]) {
      process.env.PURGA_PDF_RETENCION_DIAS = raw;
      expect(loadPurgaPdfConfig().PURGA_PDF_RETENCION_DIAS).toBe(7);
    }
  });

  it('R3: acepta el "0" tal cual y NO lo manda al default (purga tambien lo creado el mismo dia)', () => {
    process.env.PURGA_PDF_RETENCION_DIAS = "0";
    const retencion = loadPurgaPdfConfig().PURGA_PDF_RETENCION_DIAS;
    expect(retencion).toBe(0);
    expect(retencion).not.toBe(7);
  });

  it("R3: no aplica ningun tope superior a la retencion (36500 dias se usan tal cual)", () => {
    process.env.PURGA_PDF_RETENCION_DIAS = "36500";
    expect(loadPurgaPdfConfig().PURGA_PDF_RETENCION_DIAS).toBe(36500);
  });
});

describe("loadPurgaPdfConfig — tope por corrida (R21)", () => {
  it("R21: sin la env definida, el tope de cargas por corrida vale 200", () => {
    expect(loadPurgaPdfConfig().PURGA_PDF_MAX_CARGAS_POR_CORRIDA).toBe(200);
  });

  it("R21: respeta PURGA_PDF_MAX_CARGAS_POR_CORRIDA cuando es un entero positivo", () => {
    process.env.PURGA_PDF_MAX_CARGAS_POR_CORRIDA = "50";
    expect(loadPurgaPdfConfig().PURGA_PDF_MAX_CARGAS_POR_CORRIDA).toBe(50);
  });

  it("R21: un tope vacio, no numerico, cero o negativo cae al default de 200 (un tope de 0 no purgaria nunca)", () => {
    for (const raw of ["", "abc", "0", "-10"]) {
      process.env.PURGA_PDF_MAX_CARGAS_POR_CORRIDA = raw;
      expect(loadPurgaPdfConfig().PURGA_PDF_MAX_CARGAS_POR_CORRIDA).toBe(200);
    }
  });

  it("las dos claves son independientes: una retencion de 0 no altera el tope por corrida", () => {
    process.env.PURGA_PDF_RETENCION_DIAS = "0";
    const cfg = loadPurgaPdfConfig();
    expect(cfg.PURGA_PDF_RETENCION_DIAS).toBe(0);
    expect(cfg.PURGA_PDF_MAX_CARGAS_POR_CORRIDA).toBe(200);
  });
});

describe("loadPurgaPdfConfig — resolucion por corrida (R4)", () => {
  it("R4: el modulo no exporta ninguna configuracion ya resuelta al importarlo, solo la funcion", () => {
    // Discriminante: si alguien anadiera `export const purgaPdfConfig = loadPurgaPdfConfig()`
    // (el patron de `lib/config/etiquetas.ts:102`), aparecerian exportaciones que NO son
    // funciones y la ventana quedaria congelada al importar, rompiendo R4.
    const exportados = Object.entries(purgaPdfModule as Record<string, unknown>);
    const noFunciones = exportados.filter(([, valor]) => typeof valor !== "function");
    expect(noFunciones).toEqual([]);
    expect(Object.keys(purgaPdfModule)).toEqual(["loadPurgaPdfConfig"]);
    // Ninguna exportacion tiene la forma de una PurgaPdfConfig ya materializada.
    const congeladas = exportados.filter(
      ([, valor]) =>
        typeof valor === "object" && valor !== null && "PURGA_PDF_RETENCION_DIAS" in valor,
    );
    expect(congeladas).toEqual([]);
  });

  it("R4: dos llamadas consecutivas con env distinta devuelven ventanas distintas, sin recargar el modulo", () => {
    const original = process.env.PURGA_PDF_RETENCION_DIAS;
    try {
      process.env.PURGA_PDF_RETENCION_DIAS = "3";
      const primera = loadPurgaPdfConfig();
      process.env.PURGA_PDF_RETENCION_DIAS = "30";
      const segunda = loadPurgaPdfConfig();

      expect(primera.PURGA_PDF_RETENCION_DIAS).toBe(3);
      expect(segunda.PURGA_PDF_RETENCION_DIAS).toBe(30);
      expect(segunda.PURGA_PDF_RETENCION_DIAS).not.toBe(primera.PURGA_PDF_RETENCION_DIAS);
    } finally {
      if (original === undefined) delete process.env.PURGA_PDF_RETENCION_DIAS;
      else process.env.PURGA_PDF_RETENCION_DIAS = original;
    }
  });
});
