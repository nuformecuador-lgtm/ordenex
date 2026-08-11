// Formato por unidad y total por columna (feature 130): R20, R21, R23.
// Sin DOM: este archivo NO importa @testing-library/react a proposito (R21).

import { afterEach, describe, expect, it, vi } from "vitest";

import { formatearValor, totalizar } from "@/components/private/analytics/formato";
import { formatMonto, SIN_MONTO, monedaConfig } from "@/lib/config/moneda";

/**
 * Recarga `formato.ts` (y con el `lib/config/moneda.ts`, que resuelve su
 * configuracion al importarse) con OTRA moneda y OTRO locale.
 *
 * Existe porque con la configuracion por defecto `formatMonto(3500)` y un
 * `` `₡${…}` `` escrito a mano producen el MISMO string byte a byte: cualquier
 * asercion sobre la salida por defecto es incapaz de distinguirlos. Cambiando la
 * configuracion los dos dejan de coincidir y la asercion vuelve a medir el
 * requisito (R13, R20) en vez de la moneda de hoy.
 */
async function conMoneda(locale: string, currency: string, simbolo?: string) {
  vi.resetModules();
  vi.stubEnv("MONEDA_LOCALE", locale);
  vi.stubEnv("MONEDA_CURRENCY", currency);
  // Feature 201: el simbolo dejo de salir del codigo ISO via `Intl` y es una
  // pieza propia de `lib/config/moneda.ts` (`MONEDA_SIMBOLO`).
  if (simbolo !== undefined) vi.stubEnv("MONEDA_SIMBOLO", simbolo);
  return import("@/components/private/analytics/formato");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("formato por unidad (R20, R21)", () => {
  it("formatea sin renderizar ningun componente", () => {
    // La asercion es el propio hecho de invocarlo: no hay `render`, no hay DOM.
    expect(typeof formatearValor(1, "conteo")).toBe("string");
    expect(typeof document).toBe("undefined");
  });

  it("formatea conteo, porcentaje, moneda y segundos segun la unidad", () => {
    const esperado = {
      conteo: new Intl.NumberFormat(monedaConfig.locale, { maximumFractionDigits: 0 }).format(3500),
      porcentaje: new Intl.NumberFormat(monedaConfig.locale, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(0.842),
      // Feature 201: la moneda ya NO la formatea `Intl` (agrupaba con espacio
      // fino); el aspecto lo define `formatMonto`, y el literal del formato se
      // mide en `tests/unit/config/moneda-formato.test.ts`. Lo que se afirma
      // aqui es que el paquete de analitica delega en el, sin formato propio.
      moneda: formatMonto(3500),
      segundos: new Intl.NumberFormat(monedaConfig.locale, {
        style: "unit",
        unit: "second",
        unitDisplay: "short",
        maximumFractionDigits: 0,
      }).format(45),
    };

    expect(formatearValor(3500, "conteo")).toBe(esperado.conteo);
    expect(formatearValor(0.842, "porcentaje")).toBe(esperado.porcentaje);
    expect(formatearValor(3500, "moneda")).toBe(esperado.moneda);
    expect(formatearValor(45, "segundos")).toBe(esperado.segundos);
  });

  it("el conteo y el porcentaje no llevan simbolo de moneda", () => {
    expect(formatearValor(3500, "conteo")).not.toMatch(/[^\d.,\s-]/);
    expect(formatearValor(0.5, "porcentaje")).toContain("%");
  });

  it("elige la unidad de tiempo por magnitud: segundos, minutos y horas", () => {
    expect(formatearValor(45, "segundos")).toBe(
      new Intl.NumberFormat(monedaConfig.locale, {
        style: "unit",
        unit: "second",
        unitDisplay: "short",
        maximumFractionDigits: 0,
      }).format(45),
    );
    expect(formatearValor(600, "segundos")).toBe(
      new Intl.NumberFormat(monedaConfig.locale, {
        style: "unit",
        unit: "minute",
        unitDisplay: "short",
        maximumFractionDigits: 1,
      }).format(10),
    );
    expect(formatearValor(5400, "segundos")).toBe(
      new Intl.NumberFormat(monedaConfig.locale, {
        style: "unit",
        unit: "hour",
        unitDisplay: "short",
        maximumFractionDigits: 1,
      }).format(1.5),
    );
  });

  it("un valor nulo o no finito es dato ausente en toda unidad, nunca cero", () => {
    for (const unidad of ["conteo", "porcentaje", "moneda", "segundos"] as const) {
      expect(formatearValor(null, unidad)).toBe(SIN_MONTO);
      expect(formatearValor(Number.NaN, unidad)).toBe(SIN_MONTO);
      expect(formatearValor(null, unidad)).not.toContain("0");
    }
  });

  it("el cero SI se muestra como cero: es un dato, no una ausencia", () => {
    expect(formatearValor(0, "conteo")).not.toBe(SIN_MONTO);
  });
});

describe("la moneda y el idioma salen de configuracion, no del codigo (R13, R20)", () => {
  it("con otra moneda configurada el valor NO lleva el simbolo del colon", async () => {
    const { formatearValor: formatear } = await conMoneda("es-CR", "USD", "$");

    const salida = formatear(3500, "moneda");
    expect(salida).toBe("$3.500,00");
    // Lo que de verdad se afirma: el simbolo NO esta escrito en el paquete.
    expect(salida).not.toContain("₡");
  });

  it("con otro locale configurado cambian los separadores del conteo", async () => {
    const { formatearValor: formatear } = await conMoneda("en-US", "USD");

    expect(formatear(3500, "conteo")).toBe(
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(3500),
    );
    // "3,500" en en-US contra "3 500" en es-CR: si el locale estuviera incrustado,
    // esta asercion no se movería.
    expect(formatear(3500, "conteo")).toContain(",");
  });

  it("con otro locale cambia tambien el nombre de la unidad de tiempo", async () => {
    const { formatearValor: formatear } = await conMoneda("en-US", "USD");

    expect(formatear(600, "segundos")).toBe(
      new Intl.NumberFormat("en-US", {
        style: "unit",
        unit: "minute",
        unitDisplay: "short",
        maximumFractionDigits: 1,
      }).format(10),
    );
  });
});

describe("total de columna (R23)", () => {
  it("totaliza en una funcion pura, ignorando los ausentes", () => {
    expect(totalizar([1, 2, 3])).toBe(6);
    expect(totalizar([1, null, 3])).toBe(4);
  });

  it("si todos los valores son ausentes el total tambien lo es, no cero", () => {
    expect(totalizar([null, null])).toBeNull();
    expect(totalizar([])).toBeNull();
  });
});
