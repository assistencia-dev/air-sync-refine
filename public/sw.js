/* DBS AIR PWA: cache only public static assets. Never cache HTML, API, auth, or business data. */
const CACHE_NAME = "dbs-air-static-v4";
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
  // Vite serves its live module graph here. Mixing it with a PWA cache can
  // combine imports from different dependency installations in the preview.
  if (/^\/(?:node_modules|src|@[^/]*)(?:\/|$)/.test(url.pathname)) return;
  if (url.origin !== self.location.origin || !STATIC_ASSET.test(url.pathname)) return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("supabase")) return;

  event.respondWith((async () => {
    let cache;
    try { cache = await caches.open(CACHE_NAME); } catch (_) {}
    try {
      const response = await fetch(request);
      if (cache && response.ok && response.type === "basic") {
        // Cache quota must never turn a successful download into stale JS.
        try { await cache.put(request, response.clone()); } catch (_) {}
      }
      return response;
    } catch (error) {
      const cached = cache && await cache.match(request);
      if (cached) return cached;
      throw error;
    }
  })());
});
