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
