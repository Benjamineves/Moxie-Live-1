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

const META_KEY = "moxie-offline-vessels";
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
    const docRes = await cache.match(`/api/vessels/${meta.mxeId}/documents/${doc}`);
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

    for (const docType of identity.availableDocs) {
      try {
        const url = `/api/vessels/${identity.mxeId}/documents/${docType}`;
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
  const res = await cache.match(`/api/vessels/${mxeId}/documents/${docType}`);
  if (!res) return null;
  return URL.createObjectURL(await res.blob());
}
