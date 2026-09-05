// Moxie PWA service worker — app-shell caching (build-order step 3) plus
// explicit per-vessel document/photo caching (step 4,
// docs/moxie_digital_pwa_spec.md §4/§9). Still deliberately does NOT
// cache vessel data, share links, or billing — only what "save for
// offline" (offline-vessel-store.ts) explicitly wrote into a per-vessel
// `moxie-vessel-<mxeId>` cache.
//
// Bump CACHE_VERSION whenever PRECACHE_URLS changes — activate() deletes
// every other "moxie-shell-*" cache, so old versions never accumulate.
// Per-vessel caches are versioned by mxeId, not by this constant, and are
// cleared individually (removeOfflineVessel) or entirely on sign-out
// (clearAllOfflineData) — activate() here never touches them.
const CACHE_VERSION = "moxie-shell-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const OFFLINE_VESSEL_PATH = "/offline-vessel";

const PRECACHE_URLS = [
  OFFLINE_URL,
  OFFLINE_VESSEL_PATH,
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

  // Per-vessel documents (build spec §4, this build's own proxy route —
  // see api/vessels/[mxeId]/documents/[docType]/route.ts) — cache-first
  // READ only. This handler never WRITES a cache entry on a miss; the
  // only writer is the explicit "save for offline" flow in
  // offline-vessel-store.ts. Silently caching on every visit here would
  // undo §4b's "explicit, not silent" requirement — an owner who never
  // taps "save for offline" should have nothing saved, even if they
  // view the document online.
  //
  // Invalidation, as with photos below, happens at the URL rather than
  // by weakening the strategy: lib/document-url.ts appends a ?v= token
  // derived from the stored file's own updated_at, so replacing a
  // document yields a key this cache has never held and falls through
  // to the network. Matching on pathname only — the regex below runs
  // against url.pathname, which excludes the query — is what keeps that
  // token from falling out of this branch entirely.
  const docMatch = url.origin === self.location.origin && url.pathname.match(/^\/api\/vessels\/([A-Za-z0-9-]+)\/documents\/[a-z_]+$/i);
  if (docMatch) {
    const mxeId = docMatch[1].toUpperCase();
    event.respondWith(
      caches.open(`moxie-vessel-${mxeId}`).then(async (cache) => {
        const cached = await cache.match(request);
        return cached || fetch(request);
      }),
    );
    return;
  }

  // Vessel photos — public Supabase Storage bucket, so cross-origin
  // (see lib/vessel-uploads.ts's vessel-photos bucket). Matched by path
  // shape rather than a hardcoded project host, and by the MXE ID
  // segment the upload path always includes, so the same per-vessel
  // cache identity.json/documents are stored under is checked here too.
  // Same cache-first-READ-only rule as documents, same reason.
  //
  // Cache-first is deliberate and stays: an offline owner needs the
  // photo they saved, and a revalidating strategy would make that a
  // coin flip. Invalidation is handled where it belongs — at the URL.
  // uploadVesselPhoto stamps a fresh ?v= token on every upload, so a
  // replaced photo is simply a key this cache has never seen and falls
  // through to the network. Matching on pathname (which excludes the
  // query) keeps that token from breaking the rule below.
  const photoMatch = url.pathname.match(/\/storage\/v1\/object\/public\/vessel-photos\/.*\/(MXE-\d{5})\//i);
  if (photoMatch) {
    const mxeId = photoMatch[1].toUpperCase();
    event.respondWith(
      caches.open(`moxie-vessel-${mxeId}`).then(async (cache) => {
        const cached = await cache.match(request);
        return cached || fetch(request);
      }),
    );
    return;
  }

  // The offline-vessel viewer itself: cache-first, ignoring the ?mxeId
  // query string — its shell has no server data dependency (it reads
  // Cache Storage/localStorage client-side after mount, see
  // app/offline-vessel/page.tsx), so the one precached response is
  // correct for every mxeId, online or off.
  if (url.origin === self.location.origin && url.pathname === OFFLINE_VESSEL_PATH) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(OFFLINE_VESSEL_PATH);
        return cached || fetch(request);
      }),
    );
    return;
  }

  // Navigation (page loads): network-first. Every other page in this
  // app is dynamic and auth-gated -- caching rendered HTML risks serving
  // a signed-out shell to a signed-in user or vice versa, so this never
  // serves a cached page. It only falls back to a static offline page
  // when the network request fails outright (no signal).
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Everything else (vessel data, share links, billing) — untouched,
  // default network handling. Explicitly out of scope per §4.
});
