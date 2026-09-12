// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { suscribirYRegistrarEsteDispositivo } from "@/lib/pwa/alta-push";
import {
  ENDPOINT_FALSO,
  limpiarNavegadorPush,
  montarNavegadorPush,
  suscripcionFalsa,
} from "../../fixtures/navegador-push";

// FICHA 422 (T4.1 — R15, R16, R17, R20, R23) — EL ALTA DE ESTE DISPOSITIVO, EN UN SOLO SITIO.
//
// ⚠️ LO QUE ESTE ARCHIVO EXISTE PARA DEMOSTRAR: que el permiso aquí se **COMPRUEBA** y no se
// **PIDE**. Es la mitad del diseño de la ficha. La reactivación silenciosa reutiliza esta función
// sin arrastrar el `requestPermission()` del interruptor, así que si un día alguien «arreglara» un
// `sin-permiso` llamando a la petición desde aquí, la aplicación empezaría a pedirle el permiso a
// la gente al cargar una página —sin gesto, sin contexto— que es exactamente lo que 410/R10 pasó
// media ficha evitando: un «no» del navegador es casi irreversible.
//
// Y la otra mitad: una preferencia puesta NO puede saltarse la comprobación del permiso (R17). La
// preferencia ni siquiera entra en esta función; quien la consulta es el llamante, y aun así esto
// no pasa de la primera comprobación sin permiso concedido.

const { registrarMock } = vi.hoisted(() => ({ registrarMock: vi.fn() }));

vi.mock("@/lib/actions/push", () => ({
  registrarSuscripcionPush: registrarMock,
  eliminarSuscripcionPush: vi.fn(),
  obtenerClavePublicaPush: vi.fn(),
  olvidarPreferenciaDeAvisos: vi.fn(),
}));

/** Una clave pública base64url cualquiera; lo que importa es que sea convertible. */
const CLAVE = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

beforeEach(() => {
  vi.clearAllMocks();
  registrarMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  limpiarNavegadorPush();
  vi.restoreAllMocks();
});

describe("422/R15 — con el permiso concedido, suscribe y registra", () => {
  it("⭑ llama a `subscribe` con `userVisibleOnly` y registra la suscripción entera", async () => {
    const nueva = suscripcionFalsa();
    const { subscribe } = montarNavegadorPush({ permiso: "granted", suscripcionNueva: nueva });

    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "suscrito" });
    expect(subscribe).toHaveBeenCalledTimes(1);
    const opciones = subscribe.mock.calls[0]?.[0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    // Obligatorio en Chrome: sin él, `subscribe` rechaza.
    expect(opciones.userVisibleOnly).toBe(true);
    // La clave viaja en BYTES, no como texto: el soporte de la forma en texto no es uniforme.
    expect(opciones.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(opciones.applicationServerKey.length).toBeGreaterThan(0);

    expect(registrarMock).toHaveBeenCalledTimes(1);
    expect(registrarMock.mock.calls[0]?.[0]).toEqual({
      endpoint: ENDPOINT_FALSO,
      p256dh: "PPP",
      auth: "AAA",
      // La etiqueta la compone el cliente a partir de una lista blanca; NO es el user-agent crudo.
      etiqueta: "Chrome en Android",
    });
  });
});

describe("422/R16-R17 — el permiso se COMPRUEBA, y NUNCA se pide", () => {
  it("⭑ con el permiso en «default» NO se suscribe", async () => {
    // ⚠️ ÉSTE ES EL CASO QUE LA FICHA EXIGE: quitar la comprobación de `granted` en `alta-push.ts`
    // tiene que ponerlo rojo (mutación M2). Sin ella, la reactivación silenciosa acabaría llamando
    // a `subscribe` con el permiso sin conceder.
    const { subscribe, pedirPermiso } = montarNavegadorPush({ permiso: "default" });

    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "sin-permiso" });
    expect(subscribe).not.toHaveBeenCalled();
    expect(registrarMock).not.toHaveBeenCalled();
    expect(pedirPermiso).not.toHaveBeenCalled();
  });

  it("⭑ con el permiso en «denied» tampoco, y tampoco se pide", async () => {
    const { subscribe, pedirPermiso } = montarNavegadorPush({ permiso: "denied" });

    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "sin-permiso" });
    expect(subscribe).not.toHaveBeenCalled();
    expect(pedirPermiso).not.toHaveBeenCalled();
  });

  it("⭑ R16: `requestPermission` no se llama en NINGUNO de los tres estados del permiso", async () => {
    // El barrido entero, para que el día que alguien lo añada «solo para el caso default» esto se
    // ponga rojo igualmente.
    for (const permiso of ["default", "denied", "granted"] as const) {
      vi.clearAllMocks();
      registrarMock.mockResolvedValue({ status: "ok" });
      const { pedirPermiso } = montarNavegadorPush({ permiso });

      await suscribirYRegistrarEsteDispositivo(CLAVE);

      expect(pedirPermiso, `se pidió el permiso con permiso=${permiso}`).not.toHaveBeenCalled();
      limpiarNavegadorPush();
    }
  });

  it("control positivo: el MISMO escenario con `granted` sí suscribe", async () => {
    // Sin esto, los tres casos de arriba pasarían en verde con una función que no hiciera nada.
    const { subscribe } = montarNavegadorPush({ permiso: "granted" });

    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "suscrito" });
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});

describe("422 — lo que este navegador no puede dar", () => {
  it("sin `Notification` en el navegador: `sin-soporte`, y no revienta", async () => {
    // jsdom limpio: ni `Notification` ni service worker. Es el iPhone sin instalar.
    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "sin-soporte" });
    expect(registrarMock).not.toHaveBeenCalled();
  });

  it("con permiso pero sin service worker: `sin-soporte`", async () => {
    montarNavegadorPush({ permiso: "granted" });
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "serviceWorker");

    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "sin-soporte" });
  });

  it("⭑ sin registro de service worker activo se termina, y NO se espera a `ready`", async () => {
    // `navigator.serviceWorker.ready` no resuelve NUNCA si no hay registro activo. Si esta función
    // lo esperara, el camino silencioso dejaría una promesa colgada para siempre. Aquí `ready` es
    // una promesa que nunca resuelve: si alguien la usara, el test moriría por timeout.
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        getRegistration: vi.fn().mockResolvedValue(undefined),
        ready: new Promise(() => {}),
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "Notification", {
      value: { permission: "granted", requestPermission: vi.fn() },
      configurable: true,
      writable: true,
    });

    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "sin-soporte" });
  });
});

describe("422/R20 — un alta que falla no deja el dispositivo creyendo que va a recibir", () => {
  it("⭑ el servidor rechaza el registro: se DESHACE la suscripción del navegador", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const nueva = suscripcionFalsa();
    montarNavegadorPush({ permiso: "granted", suscripcionNueva: nueva });
    registrarMock.mockResolvedValue({ status: "unauthenticated" });

    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "fallo" });
    // Una suscripción viva que el servidor no conoce es un dispositivo que cree que va a recibir
    // avisos y no los va a recibir.
    expect(nueva.unsubscribe).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("registrar la suscripción");
  });

  it("⭑ el navegador entrega una suscripción incompleta: se deshace y no se registra", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rota = suscripcionFalsa();
    // Sin `keys`: registrarla dejaría una fila que nunca podrá entregar nada.
    rota.toJSON = () => ({ endpoint: ENDPOINT_FALSO }) as ReturnType<typeof rota.toJSON>;
    montarNavegadorPush({ permiso: "granted", suscripcionNueva: rota });

    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "fallo" });
    expect(registrarMock).not.toHaveBeenCalled();
    expect(rota.unsubscribe).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("suscribir este dispositivo");
  });

  it("⭑ `subscribe` revienta (sin red): `fallo`, registrado, y NO lanza", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { subscribe } = montarNavegadorPush({ permiso: "granted" });
    subscribe.mockRejectedValue(new Error("sin red"));

    const resultado = await suscribirYRegistrarEsteDispositivo(CLAVE);

    expect(resultado).toEqual({ estado: "fallo" });
    expect(registrarMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});

describe("422/R23 — ni el endpoint ni las claves salen por la consola", () => {
  it("⭑ ningún registro de fallo contiene el endpoint ni las claves", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    montarNavegadorPush({ permiso: "granted" });
    registrarMock.mockResolvedValue({ status: "conflict" });

    await suscribirYRegistrarEsteDispositivo(CLAVE);

    const registrado = error.mock.calls.map((c) => c.map(String).join(" ")).join(" | ");
    expect(registrado).not.toContain(ENDPOINT_FALSO);
    expect(registrado).not.toContain("abc123");
    expect(registrado).not.toContain("PPP");
    expect(registrado).not.toContain("AAA");
    // Control positivo: se registró algo útil, no se silenció el fallo.
    expect(registrado).toContain("registrar la suscripción");
    expect(registrado).toContain("conflict");
  });
});
