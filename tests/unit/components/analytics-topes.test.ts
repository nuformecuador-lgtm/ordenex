// Techos de series y de puntos del paquete de analitica (feature 130): R30-R33.
// Sin DOM: este archivo NO importa @testing-library/react a proposito.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CATEGORIAS_LEGIBLES,
  MAX_PUNTOS_SERIE,
  PuntosExcedidosError,
  aplicarTopePuntos,
  prepararSeries,
} from "@/components/private/analytics/topes";
import type { SerieDato } from "@/components/private/analytics/tipos";

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

// ⚠ AQUI VIVIA EL TECHO DE SERIES (`MAX_SERIES` = 5), y se RETIRO el 2026-08-18 por decision
// humana. Existia por una sola razon: la paleta tenia cinco tokens y no ciclaba, asi que la
// sexta categoria se habria pintado del color de otra. Ahora `paleta.ts` declara VEINTE y
// cicla, y el precio del techo lo pagaba el dato — un desglose de ordenes por estado perdia
// quince buckets de veinte.
//
// Estos casos son los que impiden que el recorte vuelva por la puerta de atras.
describe("ya NO hay techo de categorias (2026-08-18)", () => {
  const serieDe = (n: number): SerieDato => ({
    id: "s",
    etiqueta: "s",
    puntos: Array.from({ length: n }, (_, i) => ({ categoria: `c${i}`, valor: i })),
  });

  it("con veinte categorias no recorta en NINGUN entorno", () => {
    for (const entorno of ["development", "test", "production"]) {
      conEntorno(entorno, () => {
        const preparadas = prepararSeries([serieDe(20)]);
        expect(preparadas.series[0]?.puntos).toHaveLength(20);
        expect(preparadas.recorteSeries.recortado).toBe(false);
      });
    }
  });

  // La mutacion que este caso mata: reintroducir un `slice` en `prepararSeries`. Con seis
  // series pasaban cinco y la sexta desaparecia.
  it("con seis series llegan las SEIS, y sin lanzar", () => {
    conEntorno("development", () => {
      const seis = Array.from({ length: 6 }, () => serieDe(1));
      expect(() => prepararSeries(seis)).not.toThrow();
      expect(prepararSeries(seis).series).toHaveLength(6);
    });
  });

  it("el aviso de recorte de series queda en falso, con los numeros reales", () => {
    const preparadas = prepararSeries([serieDe(3), serieDe(3)]);
    expect(preparadas.recorteSeries).toEqual({ recortado: false, mostrados: 2, recibidos: 2 });
  });
});

// El techo de LEGIBILIDAD sobrevive, y es otra cosa: no lo aplica el paquete sino cada
// tablero sobre sus propios datos, para no pintar un donut de quince porciones aunque ahora
// todas tuvieran color propio.
describe("techo de legibilidad de los tableros", () => {
  it("MAX_CATEGORIAS_LEGIBLES vale 5 y el paquete NO lo aplica por su cuenta", () => {
    expect(MAX_CATEGORIAS_LEGIBLES).toBe(5);
    // Anti-vacio: si el paquete lo aplicara, esta serie de ocho saldria recortada.
    const ocho: SerieDato = {
      id: "s",
      etiqueta: "s",
      puntos: Array.from({ length: 8 }, (_, i) => ({ categoria: `c${i}`, valor: i })),
    };
    expect(prepararSeries([ocho]).series[0]?.puntos).toHaveLength(8);
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
