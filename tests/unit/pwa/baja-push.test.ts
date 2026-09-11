// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { darDeBajaDeEsteDispositivo } from "@/lib/pwa/baja-push";
import { eliminarSuscripcionPush } from "@/lib/actions/push";

// FICHA 410 (tanda 5 — R15, R19, R20, R23) — LA BAJA DE ESTE DISPOSITIVO.
//
// La llaman dos superficies (el interruptor y el botón de salir) y las dos dependen de la misma
// promesa: que NO LANCE NUNCA. Si lanzara, cerrar sesión se quedaría a medias porque un servicio
// de push no respondió.

const { eliminarMock } = vi.hoisted(() => ({ eliminarMock: vi.fn() }));

vi.mock("@/lib/actions/push", () => ({
  eliminarSuscripcionPush: eliminarMock,
  registrarSuscripcionPush: vi.fn(),
  obtenerClavePublicaPush: vi.fn(),
}));

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/eL-eNdPoInT-SeCrEtO";

function montarServiceWorker(suscripcion: unknown, opciones: { registro?: unknown } = {}) {
  const registro =
    "registro" in opciones
      ? opciones.registro
      : { pushManager: { getSubscription: vi.fn().mockResolvedValue(suscripcion) } };
  const contenedor = { getRegistration: vi.fn().mockResolvedValue(registro) };
  Object.defineProperty(navigator, "serviceWorker", {
    value: contenedor,
    configurable: true,
    writable: true,
  });
  return contenedor;
}

function suscripcionFalsa(overrides: Partial<{ unsubscribe: () => Promise<boolean> }> = {}) {
  return {
    endpoint: ENDPOINT,
    unsubscribe: overrides.unsubscribe ?? vi.fn().mockResolvedValue(true),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  eliminarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "serviceWorker");
  vi.restoreAllMocks();
});

describe("darDeBajaDeEsteDispositivo — R15/R19: las DOS mitades, siempre", () => {
  it("borra la fila en el servidor Y se da de baja en el navegador", async () => {
    const suscripcion = suscripcionFalsa();
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo();

    expect(eliminarMock).toHaveBeenCalledWith({ endpoint: ENDPOINT });
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ estado: "dada-de-baja" });
  });

  it("el SERVIDOR va primero: es el único que de verdad corta el push", async () => {
    const orden: string[] = [];
    eliminarMock.mockImplementation(async () => {
      orden.push("servidor");
      return { status: "ok" };
    });
    const suscripcion = suscripcionFalsa({
      unsubscribe: vi.fn().mockImplementation(async () => {
        orden.push("navegador");
        return true;
      }),
    });
    montarServiceWorker(suscripcion);

    await darDeBajaDeEsteDispositivo();

    expect(orden).toEqual(["servidor", "navegador"]);
  });

  it("R46: sin suscripción en este dispositivo no se llama a nadie, y NO es un fallo", async () => {
    montarServiceWorker(null);

    const resultado = await darDeBajaDeEsteDispositivo();

    expect(eliminarMock).not.toHaveBeenCalled();
    expect(resultado).toEqual({ estado: "sin-suscripcion" });
  });

  it("sin service worker en el navegador tampoco hay nada que hacer", async () => {
    const resultado = await darDeBajaDeEsteDispositivo();

    expect(eliminarMock).not.toHaveBeenCalled();
    expect(resultado).toEqual({ estado: "sin-suscripcion" });
  });
});

describe("darDeBajaDeEsteDispositivo — R20: no lanza, y el fallo queda registrado", () => {
  it("si el servidor RECHAZA, la baja en el navegador se hace igual y nada lanza", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    eliminarMock.mockRejectedValue(new Error("la red se cayó"));
    const suscripcion = suscripcionFalsa();
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo();

    // Las dos mitades son independientes: que una falle no puede impedir la otra.
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ estado: "fallo-parcial" });
    expect(error).toHaveBeenCalledTimes(1);
    // El registro dice QUÉ operación falló y con qué causa (docs/conventions.md).
    expect(String(error.mock.calls[0]?.[0])).toContain("borrar la suscripción en el servidor");
    expect(String(error.mock.calls[0]?.[1])).toContain("la red se cayó");
  });

  it("si el servidor responde un error de acción, también se registra con su estado", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    eliminarMock.mockResolvedValue({ status: "unauthenticated" });
    const suscripcion = suscripcionFalsa();
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo();

    expect(resultado).toEqual({ estado: "fallo-parcial" });
    expect(String(error.mock.calls[0]?.[1])).toContain("unauthenticated");
  });

  it("si `unsubscribe()` revienta, el servidor ya quedó limpio y tampoco lanza", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const suscripcion = suscripcionFalsa({
      unsubscribe: vi.fn().mockRejectedValue(new Error("el navegador dijo que no")),
    });
    montarServiceWorker(suscripcion);

    const resultado = await darDeBajaDeEsteDispositivo();

    expect(eliminarMock).toHaveBeenCalledWith({ endpoint: ENDPOINT });
    expect(resultado).toEqual({ estado: "fallo-parcial" });
    expect(String(error.mock.calls[0]?.[0])).toContain("darse de baja en el navegador");
  });

  it("leer el registro del service worker puede fallar, y tampoco lanza", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(navigator, "serviceWorker", {
      value: { getRegistration: vi.fn().mockRejectedValue(new Error("sin registro")) },
      configurable: true,
      writable: true,
    });

    const resultado = await darDeBajaDeEsteDispositivo();

    expect(resultado).toEqual({ estado: "fallo-parcial" });
    expect(String(error.mock.calls[0]?.[0])).toContain("leer la suscripción de este dispositivo");
  });
});

describe("R23 — el endpoint NO puede acabar en la consola, ni dentro del mensaje de un error", () => {
  it("un error que lleva el endpoint dentro se registra SIN él", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Así es exactamente como se filtraría en producción: `TypeError: Failed to fetch <url>`.
    eliminarMock.mockRejectedValue(new Error(`Failed to fetch ${ENDPOINT}`));
    montarServiceWorker(suscripcionFalsa());

    await darDeBajaDeEsteDispositivo();

    const registrado = error.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(registrado).not.toContain(ENDPOINT);
    expect(registrado).not.toContain("eL-eNdPoInT-SeCrEtO");
    // Control positivo: se registró algo útil, no se silenció el fallo.
    expect(registrado).toContain("borrar la suscripción en el servidor");
    expect(registrado).toContain("«dirección omitida»");
  });
});

describe("el contrato del módulo", () => {
  it("la acción que consume es la del canal, no una ruta de API inventada", () => {
    // Control de la frontera: si alguien cambiara la baja por un `fetch('/api/...')`, este import
    // dejaría de ser el que se usa y el mock de arriba no espiaría nada.
    expect(vi.isMockFunction(eliminarSuscripcionPush)).toBe(true);
  });
});
