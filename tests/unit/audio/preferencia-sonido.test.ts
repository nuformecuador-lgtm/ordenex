// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  CLAVE_SONIDO,
  guardarPreferenciaSonido,
  leerPreferenciaSonido,
} from "@/lib/audio/preferencia-sonido";

// Feature 161 — R15-R17. La preferencia vive en el DISPOSITIVO (no hay tabla de
// preferencias de usuario): estos tests fijan ese contrato, incluido el degradado cuando el
// almacenamiento no esta disponible.

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("leerPreferenciaSonido", () => {
  it("R15: sin valor guardado el sonido esta activado", () => {
    expect(leerPreferenciaSonido()).toBe(true);
  });

  it("R15: un valor desconocido no silencia; solo 'off' silencia", () => {
    window.localStorage.setItem(CLAVE_SONIDO, "cualquier-cosa");

    expect(leerPreferenciaSonido()).toBe(true);
  });

  it("R17: si el almacenamiento lanza al leer, degrada a activado", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("acceso denegado");
    });

    expect(leerPreferenciaSonido()).toBe(true);
  });
});

describe("guardarPreferenciaSonido", () => {
  it("R16: lo silenciado se recupera en la siguiente lectura", () => {
    guardarPreferenciaSonido(false);
    expect(leerPreferenciaSonido()).toBe(false);

    guardarPreferenciaSonido(true);
    expect(leerPreferenciaSonido()).toBe(true);
  });

  it("R16: la preferencia se persiste en el dispositivo, bajo su propia clave", () => {
    guardarPreferenciaSonido(false);

    expect(window.localStorage.getItem(CLAVE_SONIDO)).toBe("off");
  });

  it("R17: si el almacenamiento lanza al escribir, no propaga el error", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("cuota excedida");
    });

    expect(() => guardarPreferenciaSonido(false)).not.toThrow();
  });
});
