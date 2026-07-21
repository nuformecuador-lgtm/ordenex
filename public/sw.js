// Feature 64 (PWA) — service worker.
//
// El navegador re-descarga este archivo en cada navegacion (el update del SW NO
// pasa por el propio SW), asi que este bloque de dev funciona como "kill-switch":
// un SW zombie ya instalado en un navegador de desarrollo se limpia SOLO en cuanto
// se sirve esta version, sin pasos manuales.
const ES_DEV =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1";

if (ES_DEV) {
  // En desarrollo el SW se AUTODESTRUYE: cachear los chunks de Next (`/_next/static/`)
  // rompe el HMR porque sus hashes cambian en cada recompilacion -> el chunk viejo
  // falla al cargar y la pagina entra en recarga infinita. Limpia todas las caches,
  // se des-registra y recarga los clientes a un estado limpio (sin SW).
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        for (const key of await caches.keys()) await caches.delete(key);
        await self.registration.unregister();
        for (const client of await self.clients.matchAll()) {
          client.navigate(client.url);
        }
      })()
    );
  });
} else {
  // ---- PWA de produccion ----
  const CACHE_NAMES = {
    static: "next-static-v1",
    pages: "pages-cache-v1",
  };

  const PRECACHE_URLS = ["/", "/offline.html"];

  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches
        .open(CACHE_NAMES.pages)
        .then((cache) => cache.addAll(PRECACHE_URLS))
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
  });

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
            const clone = response.clone();
            caches
              .open(CACHE_NAMES.pages)
              .then((cache) => cache.put(request, clone));
            return response;
          })
          .catch(() =>
            caches.match(request).then((cached) => cached || caches.match("/offline.html"))
          )
      );
      return;
    }

    if (url.pathname.includes("/_next/static/")) {
      event.respondWith(
        caches
          .open(CACHE_NAMES.static)
          .then((cache) =>
            cache.match(request).then(
              (cached) =>
                cached ||
                fetch(request).then((response) => {
                  cache.put(request, response.clone());
                  return response;
                })
            )
          )
      );
      return;
    }
  });
}
