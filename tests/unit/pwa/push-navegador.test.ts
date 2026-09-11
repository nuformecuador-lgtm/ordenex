// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";

import {
  claveAplicacionDesde,
  clavesDeSuscripcion,
  contenedorDeServiceWorker,
  etiquetaDeDispositivo,
  haySoportePush,
} from "@/lib/pwa/push-navegador";

// FICHA 410 (tanda 5) — LO QUE EL NAVEGADOR APORTA AL CANAL, probado sin montar nada.
//
// Es el cimiento de R13/R45: el control aparece o no aparece según lo que diga `haySoportePush()`,
// y la instrucción de instalar en la pantalla de inicio se pinta justo en el `false`. Si esta
// función se equivoca, 3 de 18 mensajeros no se enteran de que les falta un paso.

/** jsdom no trae ninguna de las tres piezas; se ponen y se quitan a mano. */
function ponerEnVentana(clave: string, valor: unknown): void {
  Object.defineProperty(window, clave, { value: valor, configurable: true, writable: true });
}

function quitarDeVentana(clave: string): void {
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, clave);
}

function ponerServiceWorker(valor: unknown): void {
  Object.defineProperty(navigator, "serviceWorker", {
    value: valor,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  quitarDeVentana("PushManager");
  quitarDeVentana("Notification");
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "serviceWorker");
});

describe("haySoportePush — R13/R45: quién puede recibir push", () => {
  it("las TRES piezas juntas: con service worker, PushManager y Notification dice que sí", () => {
    ponerServiceWorker({});
    ponerEnVentana("PushManager", function PushManager() {});
    ponerEnVentana("Notification", { permission: "default" });

    expect(haySoportePush()).toBe(true);
  });

  it("SIN `PushManager` dice que NO — es el caso real de iPhone sin instalar la app", () => {
    ponerServiceWorker({});
    ponerEnVentana("Notification", { permission: "default" });

    expect(haySoportePush()).toBe(false);
  });

  it("sin `Notification` tampoco: mostrar el aviso del sistema es la mitad del canal", () => {
    ponerServiceWorker({});
    ponerEnVentana("PushManager", function PushManager() {});

    expect(haySoportePush()).toBe(false);
  });

  it("sin contenedor de service worker tampoco, y en jsdom limpio ése es el caso", () => {
    ponerEnVentana("PushManager", function PushManager() {});
    ponerEnVentana("Notification", { permission: "default" });

    expect(contenedorDeServiceWorker()).toBeNull();
    expect(haySoportePush()).toBe(false);
  });

  it("un `serviceWorker` DECLARADO pero `undefined` se lee como ausente, no como presente", () => {
    // El `in` diría que sí y la línea siguiente reventaría. Es la lección que `useActualizacionPwa`
    // dejó escrita y aquí se ejecuta.
    ponerServiceWorker(undefined);
    ponerEnVentana("PushManager", function PushManager() {});
    ponerEnVentana("Notification", { permission: "default" });

    expect("serviceWorker" in navigator).toBe(true);
    expect(haySoportePush()).toBe(false);
  });
});

describe("claveAplicacionDesde — la clave pública en bytes", () => {
  it("deshace el alfabeto url-safe y repone el relleno: los bytes salen exactos", () => {
    // Vector calculado A MANO, no copiado de la salida: `--_-` en url-safe es `++/+` en base64
    // estándar, o sea los valores 62, 62, 63, 62 → 111110 111110 111111 111110 → los bytes
    // 11111011, 11101111, 11111110 = 251, 239, 254. Sin el reemplazo del alfabeto, `atob` leería
    // otros caracteres y saldrían otros bytes: la clave iría mal y el `subscribe` fallaría.
    const bytes = claveAplicacionDesde("--_-");

    expect(Array.from(bytes)).toEqual([251, 239, 254]);
  });

  it("una clave sin relleno (longitud no múltiplo de 4) también se lee", () => {
    // "QUJD" es "ABC"; quitándole un carácter de relleno, "QUJDRA" (6) exige reponer "==".
    expect(Array.from(claveAplicacionDesde("QUJDRA"))).toEqual([65, 66, 67, 68]);
  });

  it("el resultado es respaldable por `applicationServerKey` (un `ArrayBuffer`, no compartido)", () => {
    const bytes = claveAplicacionDesde("QUJD");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
  });
});

describe("clavesDeSuscripcion — lo que viaja al servidor", () => {
  function suscripcionFalsa(json: unknown): PushSubscription {
    return { toJSON: () => json } as unknown as PushSubscription;
  }

  it("extrae endpoint, p256dh y auth, y NADA más", () => {
    const claves = clavesDeSuscripcion(
      suscripcionFalsa({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        expirationTime: null,
        keys: { p256dh: "PPP", auth: "AAA" },
      }),
    );

    // Los tres nombres se afirman A MANO: son el contrato con `registrarSuscripcionSchema`, que es
    // `strict()` y rechaza cualquier campo de más.
    expect(claves).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: "PPP",
      auth: "AAA",
    });
    expect(Object.keys(claves ?? {}).sort()).toEqual(["auth", "endpoint", "p256dh"]);
  });

  it("si falta una clave devuelve `null`: media suscripción no se registra", () => {
    expect(
      clavesDeSuscripcion(
        suscripcionFalsa({ endpoint: "https://x/y", keys: { p256dh: "PPP" } }),
      ),
    ).toBeNull();
    expect(
      clavesDeSuscripcion(suscripcionFalsa({ endpoint: "https://x/y", keys: {} })),
    ).toBeNull();
    expect(clavesDeSuscripcion(suscripcionFalsa({ keys: { p256dh: "P", auth: "A" } }))).toBeNull();
  });
});

describe("etiquetaDeDispositivo — R23: un nombre reconocible, NO el user-agent", () => {
  const EDGE =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
  const CHROME_ANDROID =
    "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36";
  const SAFARI_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

  it("el orden de la lista importa: Edge NO se etiqueta como Chrome ni como Safari", () => {
    expect(etiquetaDeDispositivo(EDGE)).toBe("Edge en Windows");
  });

  it("Chrome en Android, que es la mitad de la plantilla", () => {
    expect(etiquetaDeDispositivo(CHROME_ANDROID)).toBe("Chrome en Android");
  });

  it("iPhone se reconoce por el sistema, no por el modelo", () => {
    expect(etiquetaDeDispositivo(SAFARI_IPHONE)).toBe("Safari en iPhone");
  });

  it("NO deja pasar el modelo del teléfono ni la versión: eso identifica a la persona", () => {
    // La mitad que de verdad protege R23. Una implementación que recortara el user-agent pasaría
    // los casos de arriba y caería aquí.
    const etiqueta = etiquetaDeDispositivo(CHROME_ANDROID) ?? "";
    expect(etiqueta).not.toContain("SM-A546E");
    expect(etiqueta).not.toContain("131.0");
    expect(etiqueta).not.toContain("AppleWebKit");
    expect(etiqueta.length).toBeLessThanOrEqual(60);
  });

  it("un user-agent que no reconoce nadie se queda SIN etiqueta, no con basura", () => {
    expect(etiquetaDeDispositivo("curl/8.4.0")).toBeUndefined();
  });
});
