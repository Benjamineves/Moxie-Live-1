"use client";

/**
 * Client-side "save for offline" mechanics (build spec §4). Two layers,
 * kept deliberately separate:
 *
 *  - localStorage holds small, synchronous-to-read METADATA: which
 *    vessels have been saved, when, and which documents/photo they
 *    should have. This is what the sync-status UI reads to render
 *    "Available offline · last synced [date]" without an async call.
 *  - The Cache API (one cache per vessel, `moxie-vessel-<mxeId>`) holds
 *    the actual bytes — documents, photo, and a synthetic identity.json
 *    response for the core vessel fields. This is what makes eviction
 *    detectable: iOS can silently clear a Cache Storage entry while
 *    leaving localStorage untouched, so "the metadata says cached" and
 *    "the bytes are actually still there" are two different questions —
 *    checkOfflineCacheHealth answers the second one.
 *
 * Everything here is scoped per-vessel by design, not per-account: sign-
 * out clears all of it (see SignOutButton.tsx), so nothing survives to
 * leak into a different account on a shared device (build spec §6).
 */

import { vesselDocumentUrl } from "@/lib/document-url";

const META_KEY = "moxie-offline-vessels";
/** Public Supabase Storage photo URLs, matched by path shape rather than a hardcoded project host — same rule public/sw.js uses. */
const PHOTO_URL_PATTERN = /\/storage\/v1\/object\/public\/vessel-photos\//i;
const IDENTITY_KEY = "/__offline__/identity.json";

export type OfflineDocType = "registration" | "insurance" | "boater_card";

export type OfflineVesselIdentity = {
  mxeId: string;
  vesselName: string;
  make: string | null;
  model: string | null;
  year: number | null;
  hin: string | null;
  regState: string | null;
  regNumber: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  emgName: string | null;
  emgPhone: string | null;
  photoUrl: string | null;
  availableDocs: OfflineDocType[];
  /**
   * Storage's updated_at per document, used only to derive the cache key
   * (see lib/document-url.ts). Persisted into the cached identity.json so
   * the offline read can rebuild the exact URL the save wrote — resolving
   * it from the caller instead would let the two drift the moment a
   * document is replaced, turning a stale document into a missing one.
   */
  docVersions?: Partial<Record<OfflineDocType, string | null>>;
};

type OfflineVesselMeta = {
  mxeId: string;
  vesselName: string;
  lastSyncedAt: string;
  hasPhoto: boolean;
  docs: OfflineDocType[];
};

type MetaStore = Record<string, OfflineVesselMeta>;

function cacheNameFor(mxeId: string) {
  return `moxie-vessel-${mxeId.toUpperCase()}`;
}

function readStore(): MetaStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as MetaStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: MetaStore) {
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(store));
  } catch {
    // Storage full or unavailable (private browsing) — offline save is
    // best-effort by nature; silently skipping the metadata write still
    // leaves whatever made it into the Cache API usable this session.
  }
}

export function listOfflineVessels(): OfflineVesselMeta[] {
  return Object.values(readStore()).sort((a, b) => b.lastSyncedAt.localeCompare(a.lastSyncedAt));
}

export function getOfflineMeta(mxeId: string): OfflineVesselMeta | null {
  return readStore()[mxeId.toUpperCase()] ?? null;
}

const DOC_URL_PATTERN = /^\/api\/vessels\/[^/]+\/documents\/[a-z_]+$/i;

/** Relative path+query of a cached entry, so absolute cache keys compare against the relative URLs the app builds. */
function relativeKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Resolves a cached document by the URL the save actually wrote, reading
 * the version out of the cached identity.json rather than trusting the
 * caller. Falls back to the untokenized URL for entries saved before
 * documents were versioned — those are still perfectly good bytes, and
 * failing to find them would be a regression dressed up as a fix.
 */
async function matchCachedDocument(cache: Cache, mxeId: string, docType: OfflineDocType) {
  const identityRes = await cache.match(IDENTITY_KEY);
  let uploadedAt: string | null = null;
  if (identityRes) {
    try {
      const identity = (await identityRes.clone().json()) as OfflineVesselIdentity;
      uploadedAt = identity.docVersions?.[docType] ?? null;
    } catch {
      // Corrupt identity.json — the untokenized fallback below still
      // reaches anything saved before versioning existed.
    }
  }

  const versioned = await cache.match(vesselDocumentUrl(mxeId, docType, uploadedAt));
  if (versioned) return versioned;
  return cache.match(vesselDocumentUrl(mxeId, docType, null));
}

/**
 * Compares metadata against what's actually still in Cache Storage.
 * True eviction detection, not a guess — this is the honesty §4c asks
 * for: the metadata surviving doesn't mean the bytes did.
 */
export async function checkOfflineCacheHealth(mxeId: string): Promise<"healthy" | "evicted" | "not_cached"> {
  const meta = getOfflineMeta(mxeId);
  if (!meta) return "not_cached";
  if (typeof caches === "undefined") return "evicted";

  const hasCache = await caches.has(cacheNameFor(mxeId));
  if (!hasCache) return "evicted";

  const cache = await caches.open(cacheNameFor(mxeId));
  const identityRes = await cache.match(IDENTITY_KEY);
  if (!identityRes) return "evicted";

  for (const doc of meta.docs) {
    const docRes = await matchCachedDocument(cache, meta.mxeId, doc);
    if (!docRes) return "evicted";
  }

  return "healthy";
}

export type SaveOfflineResult =
  | { ok: true; notificationPermission: NotificationPermission | "unsupported"; persisted: boolean }
  | { ok: false; error: string };

/**
 * The core save flow (build spec §4a/§4b/§4d). Same function whether
 * triggered by an explicit tap or the automatic single-vessel case
 * (§8 decision 2) — the only difference is what triggers the call, not
 * what it does. Notification permission is requested here, first tap,
 * not at app launch (§8 decision 5); persistent storage follows it,
 * since Safari only grants persistence once notification permission is
 * already granted (§4a).
 */
export async function saveVesselForOffline(identity: OfflineVesselIdentity): Promise<SaveOfflineResult> {
  if (typeof window === "undefined" || typeof caches === "undefined") {
    return { ok: false, error: "Offline storage isn't available in this browser." };
  }

  let notificationPermission: NotificationPermission | "unsupported" = "unsupported";
  if ("Notification" in window) {
    try {
      notificationPermission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    } catch {
      notificationPermission = "denied";
    }
  }

  let persisted = false;
  try {
    persisted = (await navigator.storage?.persist?.()) ?? false;
  } catch {
    persisted = false;
  }

  try {
    const cache = await caches.open(cacheNameFor(identity.mxeId));
    const confirmedDocs: OfflineDocType[] = [];

    const wantedDocUrls = new Set<string>();

    for (const docType of identity.availableDocs) {
      try {
        const url = vesselDocumentUrl(identity.mxeId, docType, identity.docVersions?.[docType]);
        wantedDocUrls.add(url);
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          await cache.put(url, res.clone());
          confirmedDocs.push(docType);
        }
      } catch {
        // One document failing (locked, network blip) shouldn't abort
        // the rest — partial offline coverage, honestly reported via
        // the docs list actually cached, beats an all-or-nothing save.
      }
    }

    // Same reasoning as the photo sweep below: a replaced document is a
    // new key rather than an overwrite, so its predecessor would sit here
    // forever otherwise — bytes counting against the quota iOS evicts
    // against, which nothing can reach. This also clears the untokenized
    // entry left by a save that predates versioning.
    await Promise.all(
      (await cache.keys())
        .filter((req) => {
          const key = relativeKey(req.url);
          return DOC_URL_PATTERN.test(key.split("?")[0]) && !wantedDocUrls.has(key);
        })
        .map((req) => cache.delete(req)),
    );

    // A replaced photo gets a new ?v= token (see uploadVesselPhoto), so
    // it is a different cache key rather than an overwrite. Without this
    // sweep every replacement would leave its predecessor behind in this
    // vessel's cache forever — dead bytes counting against the storage
    // quota that iOS evicts against, for an image nothing can reach.
    await Promise.all(
      (await cache.keys())
        .filter((req) => PHOTO_URL_PATTERN.test(req.url) && req.url !== identity.photoUrl)
        .map((req) => cache.delete(req)),
    );

    let hasPhoto = false;
    if (identity.photoUrl) {
      try {
        const res = await fetch(identity.photoUrl, { cache: "no-store" });
        if (res.ok) {
          await cache.put(identity.photoUrl, res.clone());
          hasPhoto = true;
        }
      } catch {
        hasPhoto = false;
      }
    }

    const identityPayload = { ...identity, availableDocs: confirmedDocs, hasPhoto };
    await cache.put(
      IDENTITY_KEY,
      new Response(JSON.stringify(identityPayload), { headers: { "Content-Type": "application/json" } }),
    );

    const store = readStore();
    store[identity.mxeId.toUpperCase()] = {
      mxeId: identity.mxeId,
      vesselName: identity.vesselName,
      lastSyncedAt: new Date().toISOString(),
      hasPhoto,
      docs: confirmedDocs,
    };
    writeStore(store);

    return { ok: true, notificationPermission, persisted };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not save for offline." };
  }
}

export async function removeOfflineVessel(mxeId: string): Promise<void> {
  if (typeof caches !== "undefined") {
    await caches.delete(cacheNameFor(mxeId));
  }
  const store = readStore();
  delete store[mxeId.toUpperCase()];
  writeStore(store);
}

/** Sign-out hook (build spec §6) — nothing cached should survive a switch to a different account on the same device. */
export async function clearAllOfflineData(): Promise<void> {
  if (typeof caches !== "undefined") {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith("moxie-vessel-")).map((n) => caches.delete(n)));
  }
  try {
    window.localStorage.removeItem(META_KEY);
  } catch {
    // Nothing left to clean up if localStorage itself is unavailable.
  }
}

/** Reads back a cached vessel's identity + resolves its cached photo to a blob URL, for the fully-offline viewer. */
export async function readOfflineVessel(
  mxeId: string,
): Promise<{ identity: OfflineVesselIdentity & { hasPhoto: boolean }; photoBlobUrl: string | null } | null> {
  if (typeof caches === "undefined") return null;
  const hasCache = await caches.has(cacheNameFor(mxeId));
  if (!hasCache) return null;

  const cache = await caches.open(cacheNameFor(mxeId));
  const identityRes = await cache.match(IDENTITY_KEY);
  if (!identityRes) return null;
  const identity = (await identityRes.json()) as OfflineVesselIdentity & { hasPhoto: boolean };

  let photoBlobUrl: string | null = null;
  if (identity.photoUrl) {
    const photoRes = await cache.match(identity.photoUrl);
    if (photoRes) photoBlobUrl = URL.createObjectURL(await photoRes.blob());
  }

  return { identity, photoBlobUrl };
}

/** Opens a cached document as a blob URL — used by the offline viewer's "Open" buttons. */
export async function openOfflineDocument(mxeId: string, docType: OfflineDocType): Promise<string | null> {
  if (typeof caches === "undefined") return null;
  const cache = await caches.open(cacheNameFor(mxeId));
  const res = await matchCachedDocument(cache, mxeId, docType);
  if (!res) return null;
  return URL.createObjectURL(await res.blob());
}
