import { describe, it, expect } from "vitest";

import { normalizarTelefonoCR } from "@/lib/utils/telefono-cr";

// Feature 87 (T5) — normalizacion de telefono CR para el enlace wa.me. Funcion pura,
// probada aislada. Cubre R13 (8 digitos -> 506...), R14 (506.../+... respetado) y las
// longitudes atipicas (sin prefijo).
describe("normalizarTelefonoCR", () => {
  describe("R13 — numero local CR de 8 digitos", () => {
    it("antepone 506 a un numero de 8 digitos", () => {
      expect(normalizarTelefonoCR("88887777")).toBe("50688887777");
    });

    it("limpia separadores y luego antepone 506 (8 digitos)", () => {
      expect(normalizarTelefonoCR("8888-7777")).toBe("50688887777");
      expect(normalizarTelefonoCR("8888 7777")).toBe("50688887777");
    });
  });

  describe("R14 — prefijo existente respetado", () => {
    it("no re-prefija un numero que ya empieza por 506", () => {
      expect(normalizarTelefonoCR("50688887777")).toBe("50688887777");
    });

    it("respeta un + inicial (internacional) sin anteponer 506", () => {
      expect(normalizarTelefonoCR("+50688887777")).toBe("50688887777");
    });

    it("respeta un + de otro pais (no CR), solo quita separadores", () => {
      expect(normalizarTelefonoCR("+1 202 555 0143")).toBe("12025550143");
    });
  });

  describe("longitudes atipicas — sin prefijo", () => {
    it("devuelve los digitos sin prefijar cuando no son 8 ni empiezan por 506", () => {
      expect(normalizarTelefonoCR("12345")).toBe("12345");
      expect(normalizarTelefonoCR("123456789")).toBe("123456789");
    });

    it("cadena sin digitos -> cadena vacia", () => {
      expect(normalizarTelefonoCR("sin numero")).toBe("");
    });
  });
});
