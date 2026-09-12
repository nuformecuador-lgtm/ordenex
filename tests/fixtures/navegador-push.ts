import { vi } from "vitest";

/**
 * FICHA 410 (tanda 5) — UN NAVEGADOR DE MENTIRA CON CANAL DE PUSH.
 *
 * jsdom no trae ninguna de las tres piezas que el canal necesita (`navigator.serviceWorker`,
 * `PushManager`, `Notification`), y ésa es justamente la situación que el control tiene que
 * distinguir: **la ausencia de `PushManager` es el iPhone sin instalar**, no un error. Este fixture
 * las pone y las quita para que los tres archivos que lo usan describan el navegador en una línea
 * en vez de copiarse cincuenta.
 *
 * No hay nada de producción aquí: es el doble del navegador, no del canal.
 */

export const ENDPOINT_FALSO = "https://fcm.googleapis.com/fcm/send/abc123";

export const USER_AGENT_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36";

export interface SuscripcionFalsa {
  endpoint: string;
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

export function suscripcionFalsa(endpoint: string = ENDPOINT_FALSO): SuscripcionFalsa {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "PPP", auth: "AAA" } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

export interface EscenarioNavegadorPush {
  /** El permiso que el navegador YA tiene guardado para este sitio. */
  permiso?: NotificationPermission;
  /** Qué contesta `requestPermission()` cuando la persona toca el control. */
  respuestaAlPedir?: NotificationPermission;
  /** La suscripción que ya existía en este dispositivo, si la había. */
  suscripcionPrevia?: SuscripcionFalsa | null;
  /** La que devuelve `subscribe()`. Por defecto, una nueva. */
  suscripcionNueva?: SuscripcionFalsa;
  /** `false` = navegador SIN `PushManager`: el caso real del iPhone sin instalar. */
  conPushManager?: boolean;
}

export interface NavegadorPushMontado {
  pedirPermiso: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  getSubscription: ReturnType<typeof vi.fn>;
}

export function montarNavegadorPush(
  escenario: EscenarioNavegadorPush = {},
): NavegadorPushMontado {
  const {
    permiso = "default",
    respuestaAlPedir = "granted",
    suscripcionPrevia = null,
    suscripcionNueva,
    conPushManager = true,
  } = escenario;

  // ⚠️ FICHA 422 — UN NAVEGADOR DE VERDAD ACTUALIZA `Notification.permission` CON LA RESPUESTA.
  // Antes este doble no lo hacía: `requestPermission()` resolvía «granted» y `permission` seguía
  // diciendo «default» para siempre. Daba igual mientras `activar()` se guardaba la respuesta en
  // una variable local, pero desde que el trabajo del alta vive en `lib/pwa/alta-push.ts` —que
  // **comprueba** el permiso en vez de pedirlo (R16/R17)— un doble que no lo actualiza describe un
  // navegador que no existe, y pondría rojo el camino correcto.
  const estadoDelPermiso = { valor: permiso };
  const pedirPermiso = vi.fn().mockImplementation(async () => {
    estadoDelPermiso.valor = respuestaAlPedir;
    return respuestaAlPedir;
  });
  const subscribe = vi.fn().mockResolvedValue(suscripcionNueva ?? suscripcionFalsa());
  const getSubscription = vi.fn().mockResolvedValue(suscripcionPrevia);
  const registro = { pushManager: { getSubscription, subscribe } };

  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      getRegistration: vi.fn().mockResolvedValue(registro),
      ready: Promise.resolve(registro),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "userAgent", {
    value: USER_AGENT_ANDROID,
    configurable: true,
  });
  if (conPushManager) {
    Object.defineProperty(window, "PushManager", {
      value: function PushManager() {},
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(window, "Notification", {
    value: {
      // Captador y no valor fijo: así `permission` refleja lo que el navegador contestó.
      get permission() {
        return estadoDelPermiso.valor;
      },
      requestPermission: pedirPermiso,
    },
    configurable: true,
    writable: true,
  });

  return { pedirPermiso, subscribe, getSubscription };
}

export function limpiarNavegadorPush(): void {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "serviceWorker");
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "PushManager");
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "Notification");
}
