// FICHA 410 (design §12, T2.1) — LAS CLAVES VAPID, Y QUE PASA CUANDO NO ESTAN.
//
// Espejo de `lib/config/email.ts`: las credenciales viven SOLO en variables de entorno
// (`docs/architecture.md` > «Sin hardcode de contexto»), se leen y se validan en UN solo sitio, y
// si falta una pieza se cita el NOMBRE de la variable, JAMAS su valor (R29/R31).
//
// ⚠️ SIN CLAVES, LA APP NO REVIENTA — Y ESO ES UN REQUISITO, NO UNA CORTESIA (R30). Es la leccion
// de la ficha 400: un fallo de configuracion no puede parar la operacion. Sin VAPID:
//   · el control de activacion NO se ofrece (R13),
//   · el decorador NO encola ningun trabajo,
//   · el handler del job TERMINA sin enviar, dejando constancia con el nombre de la variable.
// Nada lanza, nada bloquea, y la campana sigue funcionando exactamente igual que hoy.
//
// POR QUE LA CLAVE PUBLICA NO ES `NEXT_PUBLIC_*` (R32): una `NEXT_PUBLIC_` se hornea en el bundle
// en TIEMPO DE COMPILACION, asi que rotarla exigiria un despliegue. Aqui se resuelve en TIEMPO DE
// EJECUCION y se sirve al navegador por Server Action (`lib/actions/push.ts`), de modo que hay UNA
// sola fuente y rotar la clave es cambiar una variable de entorno.

/** Contacto que exige el estandar VAPID cuando no se configura otro. No es un secreto. */
const DEFAULT_SUBJECT = "mailto:soporte@ordenex.co";

/** Nombres de las variables. Se exportan para que los mensajes y los tests citen el MISMO texto. */
export const VAPID_PUBLIC_KEY = "VAPID_PUBLIC_KEY";
export const VAPID_PRIVATE_KEY = "VAPID_PRIVATE_KEY";
export const VAPID_SUBJECT = "VAPID_SUBJECT";

/**
 * Falta alguna pieza de la configuracion VAPID. Se lanza ANTES de tocar la red. Cita QUE falta
 * (el NOMBRE de la variable), nunca el valor (R29/R31).
 *
 * ⚠️ Quien lo captura NO debe propagarlo al usuario ni abortar una operacion de negocio: el borde
 * de esta ficha (decorador, handler, Server Action) comprueba `pushConfigurado()` ANTES, y este
 * error existe solo para que un camino no previsto falle ruidosamente en el servidor en vez de
 * enviar a ciegas.
 */
export class PushNoConfiguradoError extends Error {
  constructor(pieza: string) {
    super(`push: configuracion VAPID incompleta (falta ${pieza})`);
    this.name = "PushNoConfiguradoError";
  }
}

export interface PushConfig {
  /** Clave publica (base64url). VIAJA al navegador: no es secreto. */
  publicKey: string;
  /** ⚠️ SECRETO. No sale del servidor, ni a un log, ni a un mensaje de error (R31). */
  privateKey: string;
  /** `mailto:` de contacto que el estandar exige en el JWT de VAPID. */
  subject: string;
}

function leerTexto(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  return raw.trim();
}

/**
 * Los nombres de las variables VAPID que faltan, en orden. Vacio = canal configurado.
 *
 * Devuelve NOMBRES y nunca valores: es lo que se escribe en el log cuando el canal no esta
 * configurado (R30), y es la unica forma de que ese log sirva para arreglarlo sin filtrar nada.
 */
export function piezasVapidAusentes(): string[] {
  return [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY].filter((name) => leerTexto(name) === null);
}

/**
 * HAY CANAL DE PUSH. Es la condicion que decide, en el borde, si se instancia el emisor real o no
 * se hace nada. Mira la clave PUBLICA y la PRIVADA porque sin las dos no hay envio posible: la
 * publica es lo que el navegador necesita para suscribirse y la privada lo que firma la entrega.
 *
 * `VAPID_SUBJECT` NO entra: trae default de proveedor, igual que `SMTP_HOST` en el canal de correo.
 */
export function pushConfigurado(): boolean {
  return piezasVapidAusentes().length === 0;
}

/**
 * La clave PUBLICA para el navegador, resuelta en tiempo de ejecucion (R32), o `null` si el canal
 * no esta configurado. `null` y no una excepcion: el cliente pregunta para saber si puede ofrecer
 * el control, y «no hay canal» es una respuesta legitima, no un error.
 */
export function clavePublicaPush(): string | null {
  return pushConfigurado() ? leerTexto(VAPID_PUBLIC_KEY) : null;
}

/**
 * Lee y valida la configuracion VAPID completa. Lanza `PushNoConfiguradoError` citando el NOMBRE de
 * la variable ausente. Llamar SOLO tras `pushConfigurado()`.
 */
export function loadPushConfig(): PushConfig {
  const publicKey = leerTexto(VAPID_PUBLIC_KEY);
  if (publicKey === null) throw new PushNoConfiguradoError(VAPID_PUBLIC_KEY);
  const privateKey = leerTexto(VAPID_PRIVATE_KEY);
  if (privateKey === null) throw new PushNoConfiguradoError(VAPID_PRIVATE_KEY);
  return { publicKey, privateKey, subject: leerTexto(VAPID_SUBJECT) ?? DEFAULT_SUBJECT };
}
