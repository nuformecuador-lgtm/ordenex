import { describe, it, expect } from "vitest";

import {
  buildPaqueteUrl,
  extractOrdenIdFromScan,
} from "@/lib/utils/paquete-url";

describe("buildPaqueteUrl", () => {
  it("construye la URL absoluta con el origin inyectado", () => {
    expect(buildPaqueteUrl("ord-1", "https://ordenex.app")).toBe(
      "https://ordenex.app/paquete/ord-1",
    );
  });
});

describe("extractOrdenIdFromScan", () => {
  it("extrae el ordenId del último segmento de una URL de paquete", () => {
    expect(
      extractOrdenIdFromScan("https://ordenex.app/paquete/ord-1"),
    ).toBe("ord-1");
  });

  it("ignora la barra final de la URL", () => {
    expect(
      extractOrdenIdFromScan("https://ordenex.app/paquete/ord-1/"),
    ).toBe("ord-1");
  });

  it("devuelve el UUID pelado tal cual (retrocompatibilidad)", () => {
    expect(extractOrdenIdFromScan("  ord-1  ")).toBe("ord-1");
  });
});
