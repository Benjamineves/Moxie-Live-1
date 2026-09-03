// Moxie PWA service worker — app-shell caching only (build-order step 3,
// docs/moxie_digital_pwa_spec.md §9). Deliberately does NOT cache
// documents, vessel data, share links, or billing — that's step 4, and
// per §4 it needs the persistent-storage/explicit-opt-in design attached
// to it. This worker only makes the app's own static framework assets
// available offline and gives navigation a real fallback page instead of
// the browser's native "no internet" error, so the app can still *open*
// with no signal even though it can't yet show anything useful without one.
//
// Bump CACHE_VERSION whenever PRECACHE_URLS changes — activate() deletes
// every other "moxie-shell-*" cache, so old versions never accumulate.
const CACHE_VERSION = "moxie-shell-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("moxie-shell-") && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never cache mutating requests — a stale POST/PUT/DELETE response
  // served from cache would be a correctness bug, not a convenience.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cache-first: Next's own content-hashed, immutable static assets and
  // the icon/manifest files this same build generated. Safe to serve
  // from cache indefinitely — a new deploy means new hashed filenames,
  // never the same URL with different content.
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.json");

  if (isStaticAsset) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Navigation (page loads): network-first. Every page in this app is
  // dynamic and auth-gated -- caching rendered HTML risks serving a
  // signed-out shell to a signed-in user or vice versa, so this never
  // serves a cached page. It only falls back to a static offline page
  // when the network request fails outright (no signal).
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Everything else (API routes, RSC data, vessel/document/billing
  // requests) — untouched, default network handling. Explicitly out of
  // scope for this pass per §4/§9 step 4.
});
