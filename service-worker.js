const CACHE_PREFIX = "real-scene-root";
const THEME_PACK_VERSION = "themes-c940b01c395d";
const APP_BUNDLE_VERSION = "6201fb1fc4a8";
const APP_STYLE_VERSION = "469d570c485c";
const CACHE_VERSION = `v3-${THEME_PACK_VERSION}-${APP_BUNDLE_VERSION}-${APP_STYLE_VERSION}`;
// Retire the previous app cache, including any cached API responses.
const APP_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}-api-network-only-v1`;
const INDEX_URL = new URL("./index.html", self.registration.scope).href;
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./assets/app-icon-192.png",
  "./assets/app-icon-512.png",
  "./vendor/react.production.min.js",
  "./vendor/react-dom.production.min.js",
  "./assets/app/app-6201fb1fc4a8.js",
  "./assets/app/app-469d570c485c.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(`${CACHE_PREFIX}-`) && key !== APP_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(INDEX_URL, copy));
          return response;
        })
        .catch(() => caches.match(INDEX_URL))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }
        const copy = response.clone();
        caches.open(APP_CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
