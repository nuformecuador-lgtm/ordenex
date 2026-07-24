import { describe, it, expect } from "vitest";
import { normalizarTelefonoWa } from "@/lib/utils/whatsapp-telefono";

// Integracion WhatsApp — helper puro que reduce un telefono a solo digitos para usarlo como
// clave estable del hilo de chat (raiz del bug de hilos duplicados `+573…` vs `573…`).

describe("normalizarTelefonoWa", () => {
  it("quita el `+` inicial", () => {
    expect(normalizarTelefonoWa("+573112195060")).toBe("573112195060");
  });

  it("quita espacios, guiones y parentesis", () => {
    expect(normalizarTelefonoWa("+506 8888-7777")).toBe("50688887777");
    expect(normalizarTelefonoWa("(506) 8888 7777")).toBe("50688887777");
  });

  it("deja intacto un numero que ya es solo digitos", () => {
    expect(normalizarTelefonoWa("573112195060")).toBe("573112195060");
  });

  it("`+573…` y `573…` colapsan al MISMO valor (clave estable del hilo)", () => {
    expect(normalizarTelefonoWa("+573112195060")).toBe(normalizarTelefonoWa("573112195060"));
  });

  it("cadena sin digitos -> vacia", () => {
    expect(normalizarTelefonoWa("+- ()")).toBe("");
  });
});
