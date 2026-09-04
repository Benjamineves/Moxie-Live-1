"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  checkOfflineCacheHealth,
  getOfflineMeta,
  removeOfflineVessel,
  saveVesselForOffline,
  type OfflineDocType,
  type OfflineVesselIdentity,
} from "@/lib/offline-vessel-store";

type Status = "checking" | "not_cached" | "caching" | "cached" | "evicted";

function formatSyncedAt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function subscribeNoop() {
  return () => {};
}

/**
 * Per-vessel "save for offline" control and sync-status UI (build spec
 * §4b/§4c) — the honesty §4c asks for is the actual point: this always
 * shows the real state (not_cached / caching / cached / evicted), never
 * a silent assumption that a past save is still good.
 *
 * `autoSave` runs the identical save flow without a tap for a single-
 * vessel owner (§8 decision 2) — same function either way, only the
 * trigger differs. `disabled` covers dormant/decommissioned/unactivated
 * vessels, where document access is suspended entirely (build spec §6,
 * matching VesselOwnerProfile's own dormant-lock).
 */
export function SaveOfflineControl({
  identity,
  autoSave,
  disabled = false,
}: {
  identity: OfflineVesselIdentity;
  autoSave: boolean;
  disabled?: boolean;
}) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const [status, setStatus] = useState<Status>("checking");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoTriggered = useRef(false);

  async function refreshStatus() {
    const meta = getOfflineMeta(identity.mxeId);
    if (!meta) {
      setStatus("not_cached");
      setLastSyncedAt(null);
      return;
    }
    const health = await checkOfflineCacheHealth(identity.mxeId);
    setLastSyncedAt(meta.lastSyncedAt);
    setStatus(health === "healthy" ? "cached" : "evicted");
  }

  useEffect(() => {
    if (!mounted || disabled) return;
    let cancelled = false;
    // The leading await defers every setState below into a microtask —
    // deliberate, not incidental: this repo's lint config treats a
    // setState reachable synchronously from an effect body as an error
    // (see InstallPrompt.tsx's useSyncExternalStore notes for the same
    // constraint), and checkOfflineCacheHealth's own "not cached" branch
    // would otherwise resolve synchronously.
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await refreshStatus();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, disabled, identity.mxeId]);

  useEffect(() => {
    if (!mounted || disabled || autoTriggered.current) return;
    if (autoSave && status === "not_cached") {
      autoTriggered.current = true;
      (async () => {
        await Promise.resolve();
        await handleSave();
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, disabled, autoSave, status]);

  async function handleSave() {
    setStatus("caching");
    setError(null);
    const result = await saveVesselForOffline(identity);
    if (!result.ok) {
      setError(result.error);
      setStatus("not_cached");
      return;
    }
    if (result.notificationPermission === "denied") {
      setPermissionNote("Notifications are off, so iOS may still clear this cache under storage pressure.");
    } else if (result.notificationPermission !== "granted" && result.notificationPermission !== "unsupported") {
      setPermissionNote(null);
    } else if (!result.persisted && result.notificationPermission === "granted") {
      setPermissionNote("Saved, but this device didn't grant protected storage — it may still be cleared if space runs low.");
    } else {
      setPermissionNote(null);
    }
    await refreshStatus();
  }

  async function handleRemove() {
    await removeOfflineVessel(identity.mxeId);
    setStatus("not_cached");
    setLastSyncedAt(null);
    setPermissionNote(null);
  }

  if (!mounted || disabled || status === "checking") return null;

  return (
    <div className="mb-6 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] px-4 py-3">
      {status === "not_cached" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
            Save this vessel&apos;s documents so they&apos;re readable with no signal.
          </p>
          <button
            type="button"
            onClick={() => void handleSave()}
            className="shrink-0 rounded-lg bg-[var(--navy)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--gold)]"
          >
            Save for offline
          </button>
        </div>
      ) : status === "caching" ? (
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">Saving for offline…</p>
      ) : status === "cached" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
            <span className="font-semibold">Available offline</span>
            {lastSyncedAt ? ` · last synced ${formatSyncedAt(lastSyncedAt)}` : null}
          </p>
          <div className="flex shrink-0 items-center gap-4">
            <button
              type="button"
              onClick={() => void handleSave()}
              className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--navy)] underline"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void handleRemove()}
              className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--navy)] underline"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
            No longer available offline — this device cleared the cache
            {lastSyncedAt ? ` (last synced ${formatSyncedAt(lastSyncedAt)})` : ""}. Save again while you have signal.
          </p>
          <button
            type="button"
            onClick={() => void handleSave()}
            className="shrink-0 rounded-lg bg-[var(--navy)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--gold)]"
          >
            Save again
          </button>
        </div>
      )}
      {permissionNote ? (
        <p className="mt-2 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">{permissionNote}</p>
      ) : null}
      {error ? <p className="mt-2 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p> : null}
    </div>
  );
}

export type { OfflineDocType, OfflineVesselIdentity };
