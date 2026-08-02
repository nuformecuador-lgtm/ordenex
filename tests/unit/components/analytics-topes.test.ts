// Techos de series y de puntos del paquete de analitica (feature 130): R30-R33.
// Sin DOM: este archivo NO importa @testing-library/react a proposito.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_PUNTOS_SERIE,
  MAX_SERIES,
  PuntosExcedidosError,
  SeriesExcedidasError,
  aplicarTopePuntos,
  aplicarTopeSeries,
} from "@/components/private/analytics/topes";

/** `NODE_ENV` es de solo lectura en los tipos de Node; se sustituye para el caso. */
function conEntorno(valor: string, caso: () => void): void {
  vi.stubEnv("NODE_ENV", valor);
  try {
    caso();
  } finally {
    vi.unstubAllEnvs();
  }
}

const serie = (n: number) => Array.from({ length: n }, (_, i) => `serie-${i}`);
const punto = (n: number) => Array.from({ length: n }, (_, i) => i);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("techo de series (R30, R31)", () => {
  it("con 5 series o menos no recorta ni lanza en ningun entorno", () => {
    for (const entorno of ["development", "test", "production"]) {
      conEntorno(entorno, () => {
        const resultado = aplicarTopeSeries(serie(MAX_SERIES));
        expect(resultado.recortado).toBe(false);
        expect(resultado.items).toHaveLength(MAX_SERIES);
        expect(resultado.mostrados).toBe(MAX_SERIES);
      });
    }
  });

  it("con 6 series lanza SeriesExcedidasError fuera de produccion", () => {
    for (const entorno of ["development", "test"]) {
      conEntorno(entorno, () => {
        expect(() => aplicarTopeSeries(serie(6))).toThrow(SeriesExcedidasError);
        expect(() => aplicarTopeSeries(serie(6))).toThrow(/6/);
        expect(() => aplicarTopeSeries(serie(6))).toThrow(/5/);
      });
    }
  });

  it("en produccion conserva las 5 primeras en orden y no lanza", () => {
    conEntorno("production", () => {
      const resultado = aplicarTopeSeries(serie(8));
      expect(resultado.items).toEqual(["serie-0", "serie-1", "serie-2", "serie-3", "serie-4"]);
      expect(resultado.recortado).toBe(true);
      expect(resultado.mostrados).toBe(5);
      expect(resultado.recibidos).toBe(8);
    });
  });
});

describe("techo de puntos por serie (R32, R33)", () => {
  it("MAX_PUNTOS_SERIE vale 62 y es mayor que 53 semanas y menor que 366 dias", () => {
    expect(MAX_PUNTOS_SERIE).toBe(62);
    expect(MAX_PUNTOS_SERIE).toBeGreaterThan(53);
    expect(MAX_PUNTOS_SERIE).toBeLessThan(366);
  });

  it("con 63 puntos lanza PuntosExcedidosError fuera de produccion", () => {
    for (const entorno of ["development", "test"]) {
      conEntorno(entorno, () => {
        expect(() => aplicarTopePuntos(punto(63))).toThrow(PuntosExcedidosError);
        expect(() => aplicarTopePuntos(punto(63))).toThrow(/63/);
        expect(() => aplicarTopePuntos(punto(63))).toThrow(/62/);
      });
    }
  });

  it("en produccion conserva los 62 ultimos: lo reciente, no lo de enero", () => {
    conEntorno("production", () => {
      const resultado = aplicarTopePuntos(punto(366));
      expect(resultado.items).toHaveLength(MAX_PUNTOS_SERIE);
      expect(resultado.items[0]).toBe(366 - MAX_PUNTOS_SERIE);
      expect(resultado.items[MAX_PUNTOS_SERIE - 1]).toBe(365);
      expect(resultado.recortado).toBe(true);
      expect(resultado.recibidos).toBe(366);
    });
  });

  it("con 62 puntos exactos no recorta ni lanza", () => {
    conEntorno("development", () => {
      expect(aplicarTopePuntos(punto(MAX_PUNTOS_SERIE)).recortado).toBe(false);
    });
  });
});
