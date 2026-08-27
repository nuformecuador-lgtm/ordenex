// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  CLAVE_APP_NAVEGACION,
  guardarAppPreferida,
  leerAppPreferida,
} from "@/lib/utils/preferencia-navegacion";

// Feature 289 — la preferencia vive en el dispositivo. Lo que se prueba aquí es sobre todo
// que NUNCA rompe: el almacenamiento es editable por quien tenga el teléfono y puede no
// existir (modo privado, cookies bloqueadas).

describe("preferencia de app de navegacion", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("sin nada guardado no hay preferencia", () => {
    expect(leerAppPreferida()).toBeNull();
  });

  it("guarda y devuelve la app elegida", () => {
    guardarAppPreferida("waze");
    expect(window.localStorage.getItem(CLAVE_APP_NAVEGACION)).toBe("waze");
    expect(leerAppPreferida()).toBe("waze");
  });

  it("la ultima eleccion pisa a la anterior", () => {
    guardarAppPreferida("waze");
    guardarAppPreferida("apple");
    expect(leerAppPreferida()).toBe("apple");
  });

  it("un valor que no es una app conocida se ignora", () => {
    window.localStorage.setItem(CLAVE_APP_NAVEGACION, "tomtom");
    expect(leerAppPreferida()).toBeNull();
  });

  it("un valor vacio se ignora", () => {
    window.localStorage.setItem(CLAVE_APP_NAVEGACION, "");
    expect(leerAppPreferida()).toBeNull();
  });

  it("si leer el almacenamiento lanza, se comporta como si no hubiera preferencia", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("acceso denegado");
    });
    expect(() => leerAppPreferida()).not.toThrow();
    expect(leerAppPreferida()).toBeNull();
  });

  it("si escribir lanza, no propaga: el enlace del usuario ya esta navegando", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("cuota superada");
    });
    expect(() => guardarAppPreferida("google")).not.toThrow();
  });
});
