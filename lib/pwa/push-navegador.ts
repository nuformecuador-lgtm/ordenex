/**
 * FICHA 410 (tanda 5) — LO QUE EL NAVEGADOR APORTA AL CANAL DE PUSH, sin React y sin servidor.
 *
 * Módulo PURO a propósito: las cuatro decisiones que hay aquí —si el navegador puede, cómo se
 * traduce la clave pública, qué se le manda al servidor de una suscripción y cómo se nombra este
 * dispositivo— se prueban sin montar un componente ni tocar la base. Es el mismo criterio con el
 * que `lib/pwa/actualizacion.ts` sacó su regla del hook.
 *
 * ⚠️ R23 — AQUÍ NO SE REGISTRA NADA. Este archivo NO escribe en consola: el `endpoint` y las claves
 * de una suscripción pasan por estas funciones y no pueden acabar en un log por descuido.
 */

/** Lo que el servidor necesita de una suscripción del navegador (`lib/types/push.ts`). */
export interface ClavesDeSuscripcion {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * El contenedor de service workers, o `null`.
 *
 * Se mira el **valor** y no `"serviceWorker" in navigator`: la propiedad puede existir declarada y
 * valer `undefined` (navegadores viejos, contextos no seguros), y ahí el `in` dice que sí y la
 * línea siguiente revienta. Es la lección que `useActualizacionPwa` ya dejó escrita.
 */
export function contenedorDeServiceWorker(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined") return null;
  return navigator.serviceWorker ?? null;
}

/**
 * R13/R45 — ¿este navegador puede recibir push?
 *
 * Las tres piezas van juntas y las tres se miran por valor. **El caso que este `false` representa
 * de verdad es iOS sin instalar:** en una pestaña normal de Safari `PushManager` no existe, y solo
 * aparece cuando la aplicación está en la pantalla de inicio. Por eso quien consume esto no puede
 * limitarse a no pintar nada: ahí va la instrucción de instalar (R45, `design.md §11.1`).
 */
export function haySoportePush(): boolean {
  if (!contenedorDeServiceWorker()) return false;
  if (typeof window === "undefined") return false;
  const ventana = window as unknown as { PushManager?: unknown; Notification?: unknown };
  return Boolean(ventana.PushManager) && Boolean(ventana.Notification);
}

/**
 * R32 — la clave pública VAPID llega como texto base64url y `pushManager.subscribe` la quiere en
 * bytes. La conversión es estándar y sin sorpresas: se repone el relleno, se deshace el alfabeto
 * url-safe y se copia byte a byte.
 *
 * Se convierte a `Uint8Array` en vez de pasar la cadena tal cual —que la especificación también
 * admite— porque el soporte de la forma en texto no es uniforme entre navegadores y un fallo aquí
 * se ve como «el botón no hizo nada».
 */
export function claveAplicacionDesde(base64Url: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64);
  // El `ArrayBuffer` explicito no es adorno: `new Uint8Array(n)` se tipa sobre `ArrayBufferLike`,
  // que incluye `SharedArrayBuffer`, y `applicationServerKey` no lo admite.
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/**
 * Las tres piezas que identifican una suscripción, extraídas de la que entrega el navegador.
 *
 * Devuelve `null` si falta alguna: registrar una suscripción a medias deja una fila que nunca podrá
 * entregar nada y que el servicio de push rechazará una y otra vez.
 */
export function clavesDeSuscripcion(suscripcion: PushSubscription): ClavesDeSuscripcion | null {
  const json = suscripcion.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

/**
 * Los navegadores en el orden en que hay que preguntar: el de Edge y el de Opera dicen también
 * «Chrome», y el de Chrome dice también «Safari». Preguntar al revés etiqueta media plantilla
 * como Safari.
 */
const NAVEGADORES: ReadonlyArray<readonly [string, string]> = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["SamsungBrowser", "Samsung Internet"],
  ["Firefox", "Firefox"],
  ["Chrome", "Chrome"],
  ["Safari", "Safari"],
];

const SISTEMAS: ReadonlyArray<readonly [string, string]> = [
  ["Android", "Android"],
  ["iPhone", "iPhone"],
  ["iPad", "iPad"],
  ["Windows", "Windows"],
  ["Mac OS", "Mac"],
  ["Linux", "Linux"],
];

/**
 * Un nombre corto y reconocible para este dispositivo («Chrome en Android»), que es lo que la
 * columna `push_suscripcion.etiqueta` espera del cliente (`design.md §4.1`).
 *
 * ⚠️ NO es el user-agent recortado: es una **lista blanca** de nombres conocidos. La diferencia
 * importa porque el user-agent crudo lleva versiones y modelos de teléfono, o sea un rastro que
 * identifica a la persona, y esta columna se guarda. Lo que no está en la lista no se guarda:
 * `undefined` y la fila se queda sin etiqueta, que no le hace daño a nadie.
 */
export function etiquetaDeDispositivo(userAgent: string): string | undefined {
  const navegador = NAVEGADORES.find(([aguja]) => userAgent.includes(aguja))?.[1];
  const sistema = SISTEMAS.find(([aguja]) => userAgent.includes(aguja))?.[1];
  if (navegador && sistema) return `${navegador} en ${sistema}`;
  return navegador ?? sistema;
}
