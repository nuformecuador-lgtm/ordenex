/**
 * Feature 289 — qué app de mapas eligió por última vez este mensajero.
 *
 * Vive en el DISPOSITIVO, no en la cuenta, igual que la preferencia de sonido (feature 161):
 * no hay tabla de preferencias de usuario y crear una migración por una preferencia de UI no
 * se paga. El precio -- no viaja entre teléfonos, se pierde al borrar los datos del sitio --
 * queda declarado aquí y no escondido.
 */

import { APPS_NAVEGACION, type AppNavegacion } from "./navegacion-externa";

/** Clave de almacenamiento. Prefijo `ordenex:` para no colisionar con nada del host. */
export const CLAVE_APP_NAVEGACION = "ordenex:app-navegacion";

/**
 * La última app usada, o `null` si no hay ninguna guardada.
 *
 * Devuelve `null` también cuando lo guardado no es una app conocida: el almacenamiento es
 * editable por quien tenga el teléfono, y una app retirada del catálogo dejaría ahí su rastro.
 * Sin almacenamiento (servidor, modo privado, cookies bloqueadas) devuelve `null` y NO lanza.
 */
export function leerAppPreferida(): AppNavegacion | null {
  if (typeof window === "undefined") return null;
  try {
    const guardado = window.localStorage.getItem(CLAVE_APP_NAVEGACION);
    return APPS_NAVEGACION.includes(guardado as AppNavegacion)
      ? (guardado as AppNavegacion)
      : null;
  } catch {
    return null;
  }
}

/** Persiste la elección para las siguientes aperturas del modal en este mismo dispositivo. */
export function guardarAppPreferida(app: AppNavegacion): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLAVE_APP_NAVEGACION, app);
  } catch {
    // Sin almacenamiento la preferencia dura lo que la página. No es motivo para romper el
    // toque del usuario: el enlace ya está navegando.
  }
}
