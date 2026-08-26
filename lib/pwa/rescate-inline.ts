import { PARAMETRO_RESCATE, VALOR_RESCATE } from "@/lib/pwa/actualizacion";

/**
 * Feature 284 — EL CAMINO DE RESCATE, mitad del navegador.
 *
 * ## Por que existe
 *
 * Un service worker roto PERSISTE en el dispositivo. No se arregla desplegando otra vez,
 * porque el navegador busca la version nueva a traves del mecanismo que se acaba de romper, y
 * desde esta feature el relevo ademas ESPERA al usuario: un SW roto puede quedarse al mando
 * indefinidamente. Sin una salida, la unica seria que cada usuario borrara los datos del sitio
 * a mano, telefono por telefono.
 *
 * Hay dos mitades y hacen falta las dos:
 *
 *  - la del SW (`RESCATE_FORZOSO` en `public/sw.js`): sirve cuando el SW nuevo SI llega al
 *    telefono, y desaloja al anterior aunque su relevo este roto;
 *  - esta, la del documento: sirve cuando lo que esta roto es la propia app. Basta con abrir
 *    `https://…/?rescate=sw` para que el origen se quede sin service worker y sin caches.
 *
 * ## Por que INLINE en el `<head>` y no un componente
 *
 * Porque el caso que hay que sobrevivir es precisamente "los chunks de JavaScript estan
 * rotos". Un componente de React vive en un chunk; `next/script` con `afterInteractive`
 * tambien depende del runtime de Next. Este codigo viaja DENTRO del HTML que sirve el
 * servidor, asi que se ejecuta aunque no cargue ni un solo chunk.
 *
 * ## Lo que NO hace
 *
 * No se ejecuta nunca salvo que la URL traiga el parametro: sin el, sale en la primera linea.
 * Y la recarga final la ha pedido el usuario al abrir esa URL — no hay ninguna recarga
 * espontanea (R5).
 *
 * Se escribe en ES5 (`var`, `function`) a proposito: es el ultimo codigo que queda en pie en
 * un navegador donde ya ha fallado todo lo demas, y no se compila ni se transpila.
 */
export const RESCATE_INLINE = `(function () {
  try {
    var busqueda = window.location.search || "";
    if (busqueda.indexOf("${PARAMETRO_RESCATE}=${VALOR_RESCATE}") === -1) return;
    var destino = window.location.pathname;
    var tareas = [];
    if (navigator.serviceWorker) {
      tareas.push(
        navigator.serviceWorker.getRegistrations().then(function (registros) {
          return Promise.all(
            registros.map(function (registro) {
              return registro.unregister();
            })
          );
        })
      );
    }
    if (window.caches) {
      tareas.push(
        caches.keys().then(function (nombres) {
          return Promise.all(
            nombres.map(function (nombre) {
              return caches.delete(nombre);
            })
          );
        })
      );
    }
    Promise.all(tareas)
      .catch(function () {})
      .then(function () {
        window.location.replace(destino);
      });
  } catch (error) {}
})();`;
