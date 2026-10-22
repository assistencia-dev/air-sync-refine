/* DBS AIR PWA: cache only public static assets. Never cache HTML, API, auth, or business data. */
const CACHE_NAME = "dbs-air-static-v3";
const STATIC_ASSET = /\.(?:js|css|svg|png|jpe?g|webp|woff2?|ttf|ico)$/i;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("dbs-air-static-") && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !STATIC_ASSET.test(url.pathname)) return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("supabase")) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      throw error;
    }
  })());
});
