// Feature 365 — LA GARANTIA QUE MAS IMPORTA: la red NO amordaza el error.
//
// Estos tests miran la pieza sola. La misma garantia se verifica ADEMAS a traves de las
// fronteras reales en `tests/components/RedDeErrores.test.tsx`, y a mano contra el registro
// del servidor (`progress/impl_365.md`): un test de unidad prueba que la funcion emite, no que
// alguien la llame.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { reemitirEnCliente } from "@/lib/errors/reemitir-en-cliente";

type ConReportError = { reportError?: (error: unknown) => void };

const original = (globalThis as ConReportError).reportError;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  if (original === undefined) {
    delete (globalThis as ConReportError).reportError;
  } else {
    (globalThis as ConReportError).reportError = original;
  }
});

describe("reemitirEnCliente", () => {
  it("emite el error por reportError, que es el canal que ve un monitor del navegador", () => {
    const reportError = vi.fn();
    (globalThis as ConReportError).reportError = reportError;
    const error = new Error("fallo de render");

    expect(reemitirEnCliente(error)).toBe(true);

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(error);
  });

  it("cae a console.error donde reportError no existe, para no quedarse mudo", () => {
    delete (globalThis as ConReportError).reportError;
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("sin reportError");

    expect(reemitirEnCliente(error)).toBe(true);

    expect(consola).toHaveBeenCalledTimes(1);
    expect(consola).toHaveBeenCalledWith(error);
  });

  it("emite el error ENTERO, no un resumen: el stack tiene que seguir viajando", () => {
    const reportError = vi.fn();
    (globalThis as ConReportError).reportError = reportError;
    const error = new Error("con stack");

    reemitirEnCliente(error);

    const emitido = reportError.mock.calls[0]?.[0];
    expect(emitido).toBe(error);
    expect((emitido as Error).stack).toBe(error.stack);
  });

  it("no repite la MISMA ocurrencia: un re-render no multiplica la linea del registro", () => {
    const reportError = vi.fn();
    (globalThis as ConReportError).reportError = reportError;
    const error = new Error("una sola vez");

    expect(reemitirEnCliente(error)).toBe(true);
    expect(reemitirEnCliente(error)).toBe(false);
    expect(reemitirEnCliente(error)).toBe(false);

    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("SI emite una ocurrencia nueva aunque el mensaje sea identico", () => {
    // El de-duplicado es por identidad del objeto, no por texto: dos fallos distintos con el
    // mismo mensaje son dos incidencias, y silenciar la segunda seria la mordaza otra vez.
    const reportError = vi.fn();
    (globalThis as ConReportError).reportError = reportError;

    reemitirEnCliente(new Error("mismo texto"));
    reemitirEnCliente(new Error("mismo texto"));

    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it("tambien emite lo que no es un Error (un string lanzado sigue siendo una senal)", () => {
    const reportError = vi.fn();
    (globalThis as ConReportError).reportError = reportError;

    expect(reemitirEnCliente("cadena lanzada")).toBe(true);
    expect(reportError).toHaveBeenCalledWith("cadena lanzada");
  });
});
