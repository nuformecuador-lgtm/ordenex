// Formato por unidad y total por columna (feature 130): R20, R21, R23.
// Sin DOM: este archivo NO importa @testing-library/react a proposito (R21).

import { describe, expect, it } from "vitest";

import { formatearValor, totalizar } from "@/components/private/analytics/formato";
import { SIN_MONTO, monedaConfig } from "@/lib/config/moneda";

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
      moneda: new Intl.NumberFormat(monedaConfig.locale, {
        style: "currency",
        currency: monedaConfig.currency,
      }).format(3500),
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
