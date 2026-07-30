/**
 * Feature 161 — preferencia de sonido del aviso in-app (design §2.2).
 *
 * Vive en el DISPOSITIVO, no en la cuenta (R16): no hay tabla de preferencias de usuario y
 * `specs/146-campana-notificaciones/design.md:503` las declara fuera de alcance. El precio
 * -- no viaja entre dispositivos -- queda declarado en el requisito, no escondido aqui.
 *
 * Se separa del generador del tono a proposito: el generador no debe saber de preferencias,
 * y asi el toggle de la campana lee el estado sin arrastrar el contexto de audio.
 */

/** Clave de almacenamiento. Prefijo `ordenex:` para no colisionar con nada del host. */
export const CLAVE_SONIDO = "ordenex:sonido-notificaciones";

const VALOR_ACTIVADO = "on";
const VALOR_SILENCIADO = "off";

/**
 * `true` = suena. La AUSENCIA de valor guardado es sonido activado (R15): el aviso llega
 * por defecto y silenciarlo es un acto deliberado.
 *
 * Si el almacenamiento no esta disponible (modo privado, cookies bloqueadas, servidor)
 * devuelve activado y NO lanza (R17).
 */
export function leerPreferenciaSonido(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(CLAVE_SONIDO) !== VALOR_SILENCIADO;
  } catch {
    return true;
  }
}

/** Persiste la eleccion para las siguientes cargas del mismo dispositivo (R16). */
export function guardarPreferenciaSonido(activado: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CLAVE_SONIDO,
      activado ? VALOR_ACTIVADO : VALOR_SILENCIADO,
    );
  } catch {
    // Sin almacenamiento la preferencia dura lo que la pagina. No es motivo para romper
    // el click del usuario (R17).
  }
}
