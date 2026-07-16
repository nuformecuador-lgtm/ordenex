import { describe, it, expect } from "vitest";

import {
  buildPaqueteUrl,
  extractNumGuiaFromScan,
} from "@/lib/utils/paquete-url";

describe("buildPaqueteUrl", () => {
  it("construye la URL absoluta con el num_guia y el origin inyectado", () => {
    expect(buildPaqueteUrl(1234, "https://ordenex.app")).toBe(
      "https://ordenex.app/paquete/1234",
    );
  });
});

describe("extractNumGuiaFromScan", () => {
  it("extrae el num_guia del último segmento de una URL de paquete", () => {
    expect(extractNumGuiaFromScan("https://ordenex.app/paquete/1234")).toBe(1234);
  });

  it("ignora la barra final de la URL", () => {
    expect(extractNumGuiaFromScan("https://ordenex.app/paquete/1234/")).toBe(1234);
  });

  it("ignora espacios alrededor del valor escaneado", () => {
    expect(extractNumGuiaFromScan("  https://ordenex.app/paquete/7  ")).toBe(7);
  });

  it("devuelve null si el escaneo es un UUID pelado (sin retrocompatibilidad)", () => {
    expect(
      extractNumGuiaFromScan("3f1c7c2e-9a1a-4f0e-9d4a-2b6a1c9e5d33"),
    ).toBeNull();
  });

  it("devuelve null si el último segmento no es un entero (basura tipo 123abc)", () => {
    expect(extractNumGuiaFromScan("https://ordenex.app/paquete/123abc")).toBeNull();
  });

  it("devuelve null si el num_guia no es positivo", () => {
    expect(extractNumGuiaFromScan("https://ordenex.app/paquete/0")).toBeNull();
    expect(extractNumGuiaFromScan("https://ordenex.app/paquete/-5")).toBeNull();
  });

  it("devuelve null si el valor escaneado no es una URL", () => {
    expect(extractNumGuiaFromScan("1234")).toBeNull();
    expect(extractNumGuiaFromScan("   ")).toBeNull();
  });
});
