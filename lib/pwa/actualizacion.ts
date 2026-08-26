/**
 * Feature 284 — el contrato entre la pagina y el service worker para el relevo de version,
 * y la regla que decide cuando NO se puede avisar.
 *
 * Este modulo es PURO y sin React a proposito: la regla de "hay una gestion a medias" es lo
 * unico que separa un aviso util de una recarga que se lleva por delante el trabajo del
 * mensajero, y tiene que poder probarse sin montar la app entera.
 */

/**
 * Mensaje con el que la pagina AUTORIZA el relevo. El service worker no llama a
 * `skipWaiting()` en ningun otro sitio: si este mensaje no llega, el SW nuevo se queda en
 * `waiting` y la pagina viva sigue con su version y su cache.
 *
 * El literal esta duplicado en `public/sw.js` porque el service worker no puede importar del
 * bundle (es un archivo estatico que no pasa por el compilador). La guardia
 * `pwa-relevo-y-purga.guardia.test.ts` comprueba que los dos textos siguen siendo el mismo.
 */
export const MENSAJE_RELEVO_AHORA = "ordenex:relevo-ahora";

/**
 * Mensaje que la pagina manda al cargar. Le sirve al SW para reintentar la purga de caches
 * viejas: el momento en que una pagina nueva avisa es justo el momento en que la ultima
 * pagina de la build anterior puede haber desaparecido.
 */
export const MENSAJE_PAGINA_LISTA = "ordenex:pagina-lista";

/**
 * Parametro de rescate (`?rescate=sw`). Lo lee un script INLINE del `<head>`; ver
 * `lib/pwa/rescate-inline.ts`.
 */
export const PARAMETRO_RESCATE = "rescate";
export const VALOR_RESCATE = "sw";

/**
 * ¿El usuario esta en medio de algo que una recarga se llevaria por delante?
 *
 * POR QUE ESTA REGLA EXISTE. El aviso de version nueva termina en `location.reload()`, y una
 * recarga es destructiva: se lleva el formulario a medio llenar, la foto del comprobante sin
 * subir y el escaner abierto. La decision del humano (2026-08-25) fue explicita: "si el
 * usuario esta en medio de algo, el aviso espera; nunca se recarga sin que el lo pida". Asi
 * que el aviso NI SIQUIERA SE PINTA mientras esta funcion diga que si -- no se le ofrece un
 * boton que pueda pulsar por reflejo a mitad de una gestion.
 *
 * ES UNA HEURISTICA SOBRE EL DOM, y se dice en vez de fingir que es exacta: no hay en este
 * repo un registro central de "trabajo en curso" al que preguntar, y montarlo habria obligado
 * a tocar todos los formularios de la app. Se equivoca SIEMPRE HACIA EL MISMO LADO: ante la
 * duda dice que si (el aviso espera un poco mas), nunca que no.
 *
 * Las cinco señales, cada una con su motivo:
 *
 *  1. un dialogo abierto -> el usuario esta dentro de una tarea modal;
 *  2. un campo con algo que el usuario escribio o eligio (distinto de su valor por defecto);
 *  3. un archivo ya elegido en un input de tipo `file` -> la foto que aun no subio;
 *  4. algo declarado en vuelo (`aria-busy`) -> una mutacion a medio camino;
 *  5. un `<video>` en el documento -> la camara del escaner de guias esta abierta.
 */
export function hayTrabajoEnCurso(documento: Document): boolean {
  return (
    hayDialogoAbierto(documento) ||
    hayCampoConDatos(documento) ||
    hayAlgoEnVuelo(documento) ||
    hayCamaraAbierta(documento)
  );
}

function hayDialogoAbierto(documento: Document): boolean {
  // Los dialogos de Base UI se MONTAN al abrirse, asi que su sola presencia ya es la señal.
  // `dialog[open]` cubre el elemento nativo, que si vive montado y cerrado.
  return (
    documento.querySelector('[role="dialog"], [role="alertdialog"]') !== null ||
    documento.querySelector("dialog[open]") !== null
  );
}

function hayCampoConDatos(documento: Document): boolean {
  const campos = documento.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select");

  for (const campo of Array.from(campos)) {
    if (campo instanceof HTMLSelectElement) {
      const porDefecto = Array.from(campo.options).findIndex((o) => o.defaultSelected);
      if (campo.selectedIndex !== (porDefecto === -1 ? 0 : porDefecto)) return true;
      continue;
    }
    if (campo instanceof HTMLInputElement) {
      if (campo.type === "hidden") continue;
      if (campo.type === "file") {
        if ((campo.files?.length ?? 0) > 0) return true;
        continue;
      }
      if (campo.type === "checkbox" || campo.type === "radio") {
        if (campo.checked !== campo.defaultChecked) return true;
        continue;
      }
    }
    if (campo.value !== campo.defaultValue) return true;
  }
  return false;
}

function hayAlgoEnVuelo(documento: Document): boolean {
  return documento.querySelector('[aria-busy="true"]') !== null;
}

function hayCamaraAbierta(documento: Document): boolean {
  return documento.querySelector("video") !== null;
}
