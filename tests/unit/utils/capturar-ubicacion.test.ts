// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";

import {
  capturarUbicacion,
  CAPTURA_UBICACION_TIMEOUT_MS,
} from "@/lib/utils/capturar-ubicacion";

// Feature 193 (T D.2, R18/R20) — los desenlaces de la captura.
//
// El caso que de verdad importa aqui es el 1 (PERMISSION_DENIED): es el UNICO que bloquea la
// gestion (R19), y si se confundiera con los demas el bloqueo se caeria en silencio —la
// gestion pasaria sin ubicacion y nadie se enteraria—. Por eso hay un caso por codigo y no
// una comprobacion generica de "falla".

const original = {
  geolocation: Object.getOwnPropertyDescriptor(navigator, "geolocation"),
  isSecureContext: Object.getOwnPropertyDescriptor(window, "isSecureContext"),
};

function definir(objeto: object, prop: string, value: unknown): void {
  Object.defineProperty(objeto, prop, { value, configurable: true, writable: true });
}

/**
 * Doble de `navigator.geolocation` que resuelve por el callback de exito.
 *
 * Declara los TRES parametros de la API aunque solo use el primero: el caso de R20 inspecciona
 * `calls[0][2]` (las opciones) y con una firma de un solo parametro el acceso no existe en el
 * tipo de la tupla. Vitest no typechequea, asi que esto solo salta en `tsc`.
 */
function geoQueResuelve(lat: number, lng: number) {
  return {
    getCurrentPosition: vi.fn(
      (
        ok: (p: { coords: { latitude: number; longitude: number } }) => void,
        _err?: (e: { code: number }) => void,
        _opciones?: PositionOptions,
      ) => ok({ coords: { latitude: lat, longitude: lng } }),
    ),
  };
}

/** Doble que falla con el `code` numerico de `GeolocationPositionError`. */
function geoQueFalla(code: number) {
  return {
    getCurrentPosition: vi.fn(
      (_ok: unknown, err: (e: { code: number }) => void) => err({ code }),
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (original.geolocation) {
    Object.defineProperty(navigator, "geolocation", original.geolocation);
  }
  if (original.isSecureContext) {
    Object.defineProperty(window, "isSecureContext", original.isSecureContext);
  }
});

describe("capturarUbicacion", () => {
  it("exito: devuelve las coordenadas", async () => {
    definir(window, "isSecureContext", true);
    definir(navigator, "geolocation", geoQueResuelve(9.9281, -84.0907));

    await expect(capturarUbicacion()).resolves.toEqual({
      estado: "ok",
      lat: 9.9281,
      lng: -84.0907,
    });
  });

  it("R19: PERMISSION_DENIED (codigo 1) es `denegado`, el unico desenlace que bloquea", async () => {
    definir(window, "isSecureContext", true);
    definir(navigator, "geolocation", geoQueFalla(1));

    await expect(capturarUbicacion()).resolves.toEqual({ estado: "denegado" });
  });

  it("R18/R20: TIMEOUT (codigo 3) es ausencia por `timeout`", async () => {
    definir(window, "isSecureContext", true);
    definir(navigator, "geolocation", geoQueFalla(3));

    await expect(capturarUbicacion()).resolves.toEqual({
      estado: "ausente",
      motivo: "timeout",
    });
  });

  it("R18: POSITION_UNAVAILABLE (codigo 2) es ausencia por `no_disponible`", async () => {
    definir(window, "isSecureContext", true);
    definir(navigator, "geolocation", geoQueFalla(2));

    await expect(capturarUbicacion()).resolves.toEqual({
      estado: "ausente",
      motivo: "no_disponible",
    });
  });

  it("un codigo desconocido cae a `no_disponible`, nunca a `denegado`", async () => {
    // Degradar hacia el lado que NO bloquea es deliberado: ante un error que no sabemos leer,
    // trabar al mensajero seria el peor desenlace posible.
    definir(window, "isSecureContext", true);
    definir(navigator, "geolocation", geoQueFalla(99));

    await expect(capturarUbicacion()).resolves.toEqual({
      estado: "ausente",
      motivo: "no_disponible",
    });
  });

  it("sin contexto seguro NO se llega a llamar a la API", async () => {
    definir(window, "isSecureContext", false);
    const geo = geoQueResuelve(1, 1);
    definir(navigator, "geolocation", geo);

    await expect(capturarUbicacion()).resolves.toEqual({
      estado: "ausente",
      motivo: "contexto_inseguro",
    });
    // La guarda previa existe para no gastar la espera de R20 en algo ya decidido.
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("sin `navigator.geolocation` es `no_soportado`, y no lanza", async () => {
    definir(window, "isSecureContext", true);
    definir(navigator, "geolocation", undefined);

    await expect(capturarUbicacion()).resolves.toEqual({
      estado: "ausente",
      motivo: "no_soportado",
    });
  });

  it("R20: traslada el timeout a las opciones de la API", async () => {
    definir(window, "isSecureContext", true);
    const geo = geoQueResuelve(1, 1);
    definir(navigator, "geolocation", geo);

    await capturarUbicacion();

    expect(geo.getCurrentPosition.mock.calls[0][2]).toMatchObject({
      timeout: CAPTURA_UBICACION_TIMEOUT_MS,
    });
  });
});
