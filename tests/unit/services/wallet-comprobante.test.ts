import { afterEach, describe, expect, it } from "vitest";

import {
  WALLET_COMPROBANTE_MIME,
  loadWalletComprobanteConfig,
  walletComprobanteConfig,
} from "@/lib/config/wallet-comprobante";
import { BUCKETS } from "@/lib/storage/buckets";
import { problemaDeComprobante, rutaDeComprobante } from "@/lib/utils/comprobante";

/**
 * FICHA 459 / T B.7 — el comprobante: que archivo se admite (R54) y como se llama el objeto (R55).
 *
 * Solo las piezas PURAS: la subida, la compensacion y la URL firmada (R56–R58) se prueban con el
 * servicio del pago por cuenta (T B.10), que todavia no existe.
 */

const CUATRO_MB = 4 * 1024 * 1024;

describe("459/B.7 — configuracion del comprobante", () => {
  const ENV = ["WALLET_COMPROBANTE_BUCKET", "WALLET_COMPROBANTE_MAX_BYTES", "WALLET_COMPROBANTE_SIGNED_URL_TTL_SECONDS"];
  const previo = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of ENV) {
      if (previo[k] === undefined) delete process.env[k];
      else process.env[k] = previo[k];
    }
  });

  it("defaults: bucket privado `wallet-comprobantes`, 4 MB y URL de 5 minutos", () => {
    for (const k of ENV) delete process.env[k];
    expect(loadWalletComprobanteConfig()).toEqual({
      BUCKET: "wallet-comprobantes",
      MAX_BYTES: CUATRO_MB,
      SIGNED_URL_TTL_SECONDS: 300,
    });
  });

  it("se sobreescribe por entorno, y un valor invalido cae al default", () => {
    process.env.WALLET_COMPROBANTE_BUCKET = "otro-bucket";
    process.env.WALLET_COMPROBANTE_MAX_BYTES = "1048576";
    process.env.WALLET_COMPROBANTE_SIGNED_URL_TTL_SECONDS = "no-es-numero";
    expect(loadWalletComprobanteConfig()).toEqual({
      BUCKET: "otro-bucket",
      MAX_BYTES: 1024 * 1024,
      SIGNED_URL_TTL_SECONDS: 300,
    });
  });

  it("el catalogo de buckets lo nombra, con el mismo nombre que el default", () => {
    expect(BUCKETS.WALLET_COMPROBANTES).toBe("wallet-comprobantes");
  });

  it("R54: el tope por defecto cabe bajo el limite de 5 MB de las Server Actions", () => {
    expect(walletComprobanteConfig.MAX_BYTES).toBeLessThan(5 * 1024 * 1024);
  });
});

describe("459/B.7 — R54: que archivo se admite", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "application/pdf"])("admite %s", (type) => {
    expect(problemaDeComprobante({ type, size: 1000 })).toBeNull();
  });

  it("la lista de tipos es EXACTAMENTE la de R54", () => {
    expect([...WALLET_COMPROBANTE_MIME]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]);
  });

  it.each(["image/gif", "text/plain", "application/zip", "image/svg+xml", ""])(
    "rechaza %j con el mensaje del campo",
    (type) => {
      expect(problemaDeComprobante({ type, size: 1000 })).toBe(
        "El comprobante debe ser una imagen JPEG, PNG o WebP, o un PDF.",
      );
    },
  );

  it("4 MB exactos entran; un byte mas, no", () => {
    expect(problemaDeComprobante({ type: "application/pdf", size: CUATRO_MB })).toBeNull();
    expect(problemaDeComprobante({ type: "application/pdf", size: CUATRO_MB + 1 })).toBe(
      "El comprobante no puede pesar mas de 4 MB.",
    );
  });

  it("un archivo vacio se rechaza", () => {
    expect(problemaDeComprobante({ type: "image/png", size: 0 })).toBe("El comprobante esta vacio.");
  });

  it("el tope sale de la config, no de un literal", () => {
    const unoYMedio = 1_572_864; // 1,5 MB
    expect(problemaDeComprobante({ type: "image/png", size: 2_000_000 }, { MAX_BYTES: unoYMedio })).toBe(
      "El comprobante no puede pesar mas de 1.5 MB.",
    );
    expect(problemaDeComprobante({ type: "image/png", size: unoYMedio }, { MAX_BYTES: unoYMedio })).toBeNull();
  });
});

describe("459/B.7 — R55: el nombre del objeto no lleva ningun identificador", () => {
  const TIENDA = "7f1c2d3e-0000-4000-8000-000000000001";
  const DOCUMENTO = "7f1c2d3e-0000-4000-8000-000000000002";
  const USUARIO = "7f1c2d3e-0000-4000-8000-000000000003";

  it("carpeta por documento + uuid aleatorio + extension del tipo", () => {
    expect(rutaDeComprobante("pago_por_cuenta_tienda", "application/pdf", () => "ALEATORIO")).toBe(
      "pagos-por-cuenta/ALEATORIO.pdf",
    );
    expect(rutaDeComprobante("aporte_capital", "image/jpeg", () => "ALEATORIO")).toBe(
      "aportes-capital/ALEATORIO.jpg",
    );
  });

  it("dos rutas del mismo documento no se repiten y no contienen ids de tienda, documento ni usuario", () => {
    const a = rutaDeComprobante("pago_por_cuenta_tienda", "image/png");
    const b = rutaDeComprobante("pago_por_cuenta_tienda", "image/png");
    expect(a).not.toBe(b);
    for (const ruta of [a, b]) {
      expect(ruta).toMatch(/^pagos-por-cuenta\/[0-9a-f-]{36}\.png$/);
      for (const id of [TIENDA, DOCUMENTO, USUARIO]) expect(ruta).not.toContain(id);
    }
  });

  it("nombrar un tipo no admitido es un error de programacion (se valida antes)", () => {
    expect(() => rutaDeComprobante("aporte_capital", "image/gif")).toThrow(/no admitido/);
  });
});
