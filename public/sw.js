// Feature 64 (PWA) — service worker. Feature 284: relevo consentido, purga y rescate.
//
// El navegador re-descarga este archivo en cada navegacion (el update del SW NO
// pasa por el propio SW), asi que este bloque funciona como "kill-switch":
// un SW zombie ya instalado se limpia SOLO en cuanto se sirve esta version,
// sin pasos manuales.
const ES_DEV =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1";

// ---------------------------------------------------------------------------------------------
// RESCATE_FORZOSO — el kill-switch de PRODUCCION. Vale `false` y asi tiene que quedarse.
// ---------------------------------------------------------------------------------------------
//
// POR QUE EXISTE (feature 284, decision del humano del 2026-08-25). Un service worker roto
// PERSISTE en el telefono: no se arregla desplegando otra vez, porque el navegador busca la
// version nueva a traves del mecanismo que se acaba de romper. Y desde esta feature el relevo
// espera al usuario (ver mas abajo), asi que un SW roto puede quedarse al mando MUCHO mas
// tiempo que antes: si nadie pulsa "actualizar" y nadie cierra la app, el SW nuevo se queda en
// `waiting` para siempre. Sin esta bandera, la unica salida seria que cada usuario borrara los
// datos del sitio a mano, uno por uno.
//
// COMO SE USA. Se pone `true`, se despliega, y se comprueba en un telefono que la app vuelve.
// Esta version:
//   1. pide el relevo (`skipWaiting`) SIN esperar al usuario -- es el unico caso en el que se
//      hace, y por eso la bandera es una constante y no una condicion escondida;
//   2. borra TODAS las caches del origen, tambien las vigentes;
//   3. se DES-REGISTRA, con lo que el origen se queda sin service worker.
// Despues se vuelve a poner en `false` y se despliega la version buena, que se instala limpia.
//
// LO QUE NO HACE, a proposito: NO renavega ni recarga la pagina de nadie en produccion (R5).
// El documento que ya estuviera roto lo sigue estando hasta que el usuario recargue, y esa es
// SU decision; lo que esta version garantiza es que al recargar ya no hay SW ni cache que le
// devuelvan la version rota.
//
// La otra mitad del rescate NO vive aqui sino en el `<head>` del documento
// (`lib/pwa/rescate-inline.ts`, parametro `?rescate=sw`): hace falta que sea codigo INLINE del
// HTML porque si los chunks de JavaScript estan rotos, ningun componente llega a ejecutarse.
const RESCATE_FORZOSO = false;

if (ES_DEV || RESCATE_FORZOSO) {
  // En desarrollo el SW se AUTODESTRUYE: cachear los chunks de Next (`/_next/static/`)
  // rompe el HMR porque sus hashes cambian en cada recompilacion -> el chunk viejo
  // falla al cargar y la pagina entra en recarga infinita. Limpia todas las caches,
  // se des-registra y recarga los clientes a un estado limpio (sin SW).
  //
  // El rescate de produccion comparte estos dos pasos (limpiar + des-registrar) y NO el
  // tercero: renavegar clientes solo ocurre en `localhost`.
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        for (const key of await caches.keys()) await caches.delete(key);
        await self.registration.unregister();
        if (ES_DEV) {
          for (const client of await self.clients.matchAll()) {
            client.navigate(client.url);
          }
        }
      })()
    );
  });
} else {
  // ---- PWA de produccion ----
  //
  // Los nombres suben a v2 en este despliegue (feature 284, R8) para que la purga de
  // `activate` se lleve DE UNA VEZ todo lo que el SW anterior acumulo en el telefono desde
  // la feature 64 bajo `next-static-v1` / `pages-cache-v1`. Sin el cambio de nombre la purga
  // no borraria nada: la cache vieja se llamaria igual que la nueva.
  const CACHE_NAMES = {
    static: "next-static-v2",
    pages: "pages-cache-v2",
  };

  /** Unica lista de caches que este SW considera suyas. Todo lo demas se barre. */
  const CACHES_VIGENTES = [CACHE_NAMES.static, CACHE_NAMES.pages];

  // R12: el precache son DOS urls y ni una mas. Ampliarlo es la ficha 285 (offline de verdad).
  const PRECACHE_URLS = ["/", "/offline.html"];

  // ---------------------------------------------------------------------------------------
  // TOPE_ESTATICOS — SIN CALIBRAR (2026-08-25).
  // ---------------------------------------------------------------------------------------
  // Numero maximo de entradas que puede tener la cache de estaticos. Existe porque los chunks
  // de Next cambian de hash en CADA despliegue y `sw.js` no: si un despliegue no toca este
  // archivo no hay SW nuevo, no hay `activate`, no hay purga -- y la cache sigue engordando
  // dentro del mismo nombre. Este tope es el unico mecanismo que acota SIEMPRE.
  //
  // El 200 NO esta medido con trafico real: se fija midiendo cuantos `/_next/static/` distintos
  // carga un recorrido completo del mensajero (DevTools -> Network, filtro `_next/static`) y
  // poniendo al menos el doble, y ese recorrido no se pudo hacer -- produccion se vacio el
  // 2026-08-25 y en `localhost` este SW no existe (se autodestruye, ver arriba). Se declara
  // SIN CALIBRAR con el precedente de `RUTA_ORIGEN_MAX_KM` en este repo, y se re-mide con
  // trafico real. Ficha: specs/284-pwa-correcta.
  const TOPE_ESTATICOS = 200;

  // Mensajes que este SW acepta de la pagina. Los mismos literales viven en
  // `lib/pwa/actualizacion.ts` (el SW no puede importar del bundle) y una guardia comprueba
  // que no divergen.
  const MENSAJE_RELEVO_AHORA = "ordenex:relevo-ahora";
  const MENSAJE_PAGINA_LISTA = "ordenex:pagina-lista";

  // ---------------------------------------------------------------------------------------
  // EL RELEVO Y LA PURGA SON LA MISMA DECISION
  // ---------------------------------------------------------------------------------------
  // `install` YA NO llama a `skipWaiting()`. El SW nuevo se instala, se queda en `waiting` y
  // no toca nada: el SW viejo sigue sirviendo a la pagina viva con su cache intacta, asi que
  // esa pagina siempre encuentra los chunks de SU build. El relevo ocurre cuando el usuario lo
  // pide (la app le enseña un aviso con un boton) o cuando cierra la app del todo.
  //
  // Y por eso mismo la purga NO puede correr a ciegas en `activate`: si el usuario pulsa
  // "actualizar" con otra pestaña abierta a medio trabajo, `activate` corre CON esa pagina
  // viva. Barrer entonces `next-static-v1` seria romperla. Asi que:
  //
  //   - `activate` anota que ventanas existian en ese instante (son las de la build ANTERIOR)
  //     y solo purga si no queda ninguna;
  //   - mientras alguna siga viva, la cache vieja se queda Y ADEMAS se sigue leyendo: el
  //     `fetch` de estaticos busca en TODAS las caches del origen, no solo en la vigente;
  //   - cada vez que una pagina avisa de que ya cargo (`ordenex:pagina-lista`) se reintenta la
  //     purga, que es el momento en que la ultima pagina vieja acaba de desaparecer.
  //
  // Ventanas que existian cuando este SW tomo el control. `null` = todavia no activo.
  let ventanasDeLaBuildAnterior = null;
  let purgaPendiente = false;

  self.addEventListener("install", (event) => {
    // Sin `skipWaiting()`: quedarse en `waiting` ES el comportamiento correcto (R3, R4).
    event.waitUntil(
      caches.open(CACHE_NAMES.pages).then((cache) => cache.addAll(PRECACHE_URLS))
    );
  });

  self.addEventListener("message", (event) => {
    const tipo = event.data && event.data.tipo;
    if (tipo === MENSAJE_RELEVO_AHORA) {
      // UNICO camino por el que este SW pide el relevo, y lo dispara un gesto del usuario.
      self.skipWaiting();
      return;
    }
    if (tipo === MENSAJE_PAGINA_LISTA) {
      event.waitUntil(purgarSiSeFueLaBuildAnterior());
    }
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const ventanas = await self.clients.matchAll({
          includeUncontrolled: true,
          type: "window",
        });
        ventanasDeLaBuildAnterior = new Set(ventanas.map((cliente) => cliente.id));
        purgaPendiente = true;
        // `claim()` se conserva: sin `skipWaiting`, un `activate` espontaneo solo ocurre con
        // CERO clientes -- ahi `claim` solo sirve para que la primera instalacion de la vida
        // del navegador empiece a proteger cuanto antes. Y cuando el relevo lo pide el
        // usuario, `claim` es lo que hace que su pestaña reciba `controllerchange` y recargue.
        await self.clients.claim();
        await purgarSiSeFueLaBuildAnterior();
      })()
    );
  });

  /**
   * Borra toda cache que no este en `CACHES_VIGENTES`, pero SOLO si ya no queda viva ninguna
   * de las ventanas que existian cuando este SW tomo el control. Devuelve si purgo.
   */
  async function purgarSiSeFueLaBuildAnterior() {
    if (!purgaPendiente) return false;
    if (ventanasDeLaBuildAnterior && ventanasDeLaBuildAnterior.size > 0) {
      const vivas = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });
      if (vivas.some((cliente) => ventanasDeLaBuildAnterior.has(cliente.id))) {
        return false;
      }
    }
    for (const nombre of await caches.keys()) {
      if (!CACHES_VIGENTES.includes(nombre)) await caches.delete(nombre);
    }
    purgaPendiente = false;
    ventanasDeLaBuildAnterior = null;
    return true;
  }

  /** Deja la cache de estaticos en `TOPE_ESTATICOS` entradas borrando las MAS ANTIGUAS. */
  async function recortarEstaticos(cache) {
    // `cache.keys()` devuelve las claves en ORDEN DE INSERCION: lo primero que sale es lo que
    // entro antes, o sea lo de los despliegues mas viejos. Y si el recorte llegara a tocar una
    // entrada de la build vigente, el coste es una recarga desde red: ese archivo sigue
    // existiendo en el servidor. El daño de verdad nunca fue "falta en la cache", fue "falta
    // en la cache Y ya no esta en el servidor", y eso solo le pasa a lo viejo.
    const claves = await cache.keys();
    const sobran = claves.length - TOPE_ESTATICOS;
    for (let i = 0; i < sobran; i++) await cache.delete(claves[i]);
  }

  async function responderEstatico(event, request) {
    // `caches.match` mira TODAS las caches del origen, no solo la vigente. Es lo que permite
    // que una pagina de la build anterior siga encontrando SUS chunks en `next-static-v1`
    // mientras esa cache sigue ahi (la purga espera a que esa pagina se cierre).
    const cacheado = await caches.match(request);
    if (cacheado) return cacheado;

    const respuesta = await fetch(request);
    // R11: una respuesta que no es satisfactoria NO se graba. Durante un despliegue un chunk
    // puede volver 404, y con cache-first ese 404 se quedaria PARA SIEMPRE en el telefono.
    if (!respuesta.ok) return respuesta;

    const cache = await caches.open(CACHE_NAMES.static);
    // Ni el guardado ni el recorte retrasan la respuesta (R10): van en `waitUntil`.
    event.waitUntil(
      cache
        .put(request, respuesta.clone())
        .then(() => recortarEstaticos(cache))
    );
    return respuesta;
  }

  self.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") || url.host.includes("supabase.co")) {
      return;
    }

    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const clone = response.clone();
              event.waitUntil(
                caches
                  .open(CACHE_NAMES.pages)
                  .then((cache) => cache.put(request, clone))
              );
            }
            return response;
          })
          .catch(() =>
            caches.match(request).then((cached) => cached || caches.match("/offline.html"))
          )
      );
      return;
    }

    if (url.pathname.includes("/_next/static/")) {
      event.respondWith(responderEstatico(event, request));
      return;
    }
  });
}
