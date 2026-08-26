import { hayTrabajoDeclarado } from "@/lib/pwa/trabajo-en-curso";

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
 * ## Por que esta funcion cambio de raiz el 2026-08-25 (B1 de la revision)
 *
 * La primera version comparaba `input.value` con `input.defaultValue`. **Medido con sondas
 * sobre React 19.2.4**: en un input CONTROLADO React mantiene `defaultValue` sincronizado con
 * `value`, asi que teclear `45000` en el campo del recaudo dejaba `value === defaultValue` y
 * esta funcion respondia **false**. Y esta app no usa otra cosa: el campo del recaudo es
 * `<Input value={linea.monto} onChange={...}>` (`components/shared/DesglosePagoField.tsx`).
 * La señal del archivo tampoco valia: el panel limpia `input.value` justo tras elegir la foto,
 * a proposito, para poder volver a elegir la misma.
 *
 * O sea que la version anterior **no veia el unico caso que importaba** —panel de gestion con
 * dinero tecleado y fotos elegidas— y su test estaba verde porque asignaba `.value` a un input
 * suelto, que es justo lo unico que si detectaba: un test que se probaba a si mismo.
 *
 * ## Como se resuelve ahora: dos capas, y la primera es la que manda
 *
 *  1. **El registro explicito** (`lib/pwa/trabajo-en-curso.ts`). El estado que se perderia vive
 *     en React y desde el DOM no se ve, asi que la superficie que lo tiene **lo declara**. Es
 *     la unica señal FIABLE, y es la que cubre el panel de gestion del mensajero.
 *  2. **Un barrido del DOM** para lo que no se ha declarado. Se conserva porque cuesta poco y
 *     atrapa casos reales (un dialogo abierto, la camara del escaner encendida, una mutacion en
 *     vuelo), pero **ya no compara con `defaultValue`**: mira si el campo TIENE CONTENIDO, que
 *     es lo unico que se puede afirmar mirando un input controlado desde fuera.
 *
 * ## Lo que NO garantiza
 *
 * La capa 1 cubre **lo declarado**, no «todo». Una pantalla nueva con datos sin guardar no se
 * protege sola. Por eso el texto del aviso **ya no promete** que no se pierde nada: promete
 * menos y cumple.
 */
export function hayTrabajoEnCurso(documento: Document): boolean {
  return (
    hayTrabajoDeclarado() ||
    hayDialogoAbierto(documento) ||
    hayCampoConContenido(documento) ||
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

/**
 * Un campo de texto con algo escrito, o una casilla marcada, o un archivo ya elegido.
 *
 * Se mira el CONTENIDO y no la diferencia con el valor por defecto: con inputs controlados esa
 * diferencia siempre es cero (ver la cabecera). El precio es que un formulario PRECARGADO se
 * lee como trabajo en curso aunque el usuario no haya tocado nada — y ese es exactamente el
 * lado hacia el que esta funcion debe equivocarse: el aviso espera.
 *
 * Los campos de BUSQUEDA quedan fuera (`type="search"`, `role="searchbox"`): filtrar un listado
 * no es trabajo que una recarga destruya, y son los campos que mas a menudo tienen contenido en
 * reposo — dejarlos dentro dejaria el aviso sin aparecer nunca en los listados.
 */
function hayCampoConContenido(documento: Document): boolean {
  const campos = documento.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );

  for (const campo of Array.from(campos)) {
    if (campo.getAttribute("role") === "searchbox") continue;
    if (campo instanceof HTMLInputElement) {
      if (campo.type === "hidden") continue;
      if (campo.type === "search") continue;
      if (campo.type === "file") {
        if ((campo.files?.length ?? 0) > 0) return true;
        continue;
      }
      if (campo.type === "checkbox" || campo.type === "radio") {
        if (campo.checked) return true;
        continue;
      }
    }
    if (campo.value !== "") return true;
  }
  return false;
}

function hayAlgoEnVuelo(documento: Document): boolean {
  return documento.querySelector('[aria-busy="true"]') !== null;
}

function hayCamaraAbierta(documento: Document): boolean {
  return documento.querySelector("video") !== null;
}
