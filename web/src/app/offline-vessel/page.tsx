"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  listOfflineVessels,
  openOfflineDocument,
  readOfflineVessel,
  type OfflineDocType,
  type OfflineVesselIdentity,
} from "@/lib/offline-vessel-store";

const DOC_LABELS: Record<OfflineDocType, string> = {
  registration: "Registration",
  insurance: "Insurance card",
  boater_card: "Boater card",
};

/**
 * moxie_digital_pwa_spec.md §3b: this page's exit to /dashboard is
 * gated on live connectivity, not just present/absent — /dashboard
 * isn't cacheable (dynamic, auth-gated, per-user data; caching it
 * risks serving one signed-in user's data to another), so the link is
 * only real when there's actually a network to carry it. Kept updating
 * live (not just checked once on load) via the online/offline events,
 * since a visitor sitting on this page waiting for signal to come back
 * is exactly the case this exists for. useSyncExternalStore rather than
 * a useEffect+setState pair — this repo's lint config errors on a
 * setState reachable synchronously from an effect body, and this is
 * precisely the browser-subscription shape useSyncExternalStore exists
 * for.
 */
function subscribeOnlineStatus(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
function getOnlineSnapshot() {
  return navigator.onLine;
}
function getOnlineServerSnapshot() {
  // Never actually shown — offline-vessel has no server data dependency
  // and this only matters for the hydration handshake. Defaulting to
  // "offline" is the conservative choice: it means the very first paint
  // never briefly shows an enabled dashboard link that the real
  // navigator.onLine value (checked a tick later, on the client) might
  // immediately have to disable again.
  return false;
}
function useIsOnline() {
  return useSyncExternalStore(subscribeOnlineStatus, getOnlineSnapshot, getOnlineServerSnapshot);
}

/**
 * The fully-offline viewer (build spec §4). No server data dependency —
 * everything here comes from Cache Storage / localStorage via
 * offline-vessel-store.ts, read entirely client-side, because the whole
 * point is that this has to work with zero network. public/sw.js
 * precaches this route's own shell (cache-first, ignoring the ?mxeId
 * query string) so the shell itself loads offline too; a query string
 * rather than a dynamic [mxeId] segment is deliberate — one cached URL
 * serves every vessel, since the actual content comes from the client
 * JS reading local storage after mount, not from anything the server
 * rendered per-mxeId.
 *
 * Its exit back into the app (moxie_digital_pwa_spec.md §3b) is a
 * /dashboard link gated on useIsOnline() above — /dashboard itself
 * still isn't cacheable (see that same section for why), so the link
 * is only real when there's actually a network to carry it.
 */
export default function OfflineVesselPage() {
  const isOnline = useIsOnline();
  const [mxeId, setMxeId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<(OfflineVesselIdentity & { hasPhoto: boolean }) | null>(null);
  const [photoBlobUrl, setPhotoBlobUrl] = useState<string | null>(null);
  const [docUrls, setDocUrls] = useState<Partial<Record<OfflineDocType, string>>>({});
  const [otherSaved, setOtherSaved] = useState<{ mxeId: string; vesselName: string; lastSyncedAt: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Deliberate microtask deferral — see SaveOfflineControl.tsx's
      // matching comment; this repo's lint config errors on a setState
      // reachable synchronously from an effect body.
      await Promise.resolve();
      if (cancelled) return;

      const params = new URLSearchParams(window.location.search);
      const requested = params.get("mxeId")?.trim().toUpperCase() || null;
      setMxeId(requested);

      const all = listOfflineVessels();
      if (requested) {
        const result = await readOfflineVessel(requested);
        if (cancelled) return;
        if (result) {
          setIdentity(result.identity);
          setPhotoBlobUrl(result.photoBlobUrl);
          const urls: Partial<Record<OfflineDocType, string>> = {};
          for (const doc of result.identity.availableDocs) {
            const url = await openOfflineDocument(requested, doc);
            if (url) urls[doc] = url;
          }
          if (!cancelled) setDocUrls(urls);
        }
        setOtherSaved(all.filter((v) => v.mxeId !== requested).map(({ mxeId, vesselName, lastSyncedAt }) => ({ mxeId, vesselName, lastSyncedAt })));
      } else {
        setOtherSaved(all.map(({ mxeId, vesselName, lastSyncedAt }) => ({ mxeId, vesselName, lastSyncedAt })));
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <header className="sticky top-0 z-20 border-b border-[var(--divider)] bg-[var(--navy-deep)] px-5 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <p className="font-[family-name:var(--font-display)] text-lg font-light italic text-white">
            <span className="text-[var(--gold)]">M</span>oxie
          </p>
          <span className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.55)]">
            Offline copy
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-5 py-8">
        {isOnline ? (
          <Link
            href="/dashboard"
            className="mb-6 inline-flex items-center gap-1.5 rounded-lg bg-[var(--navy)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--gold)]"
          >
            Go to your dashboard →
          </Link>
        ) : (
          <div
            aria-disabled="true"
            className="mb-6 inline-flex items-center gap-1.5 rounded-lg border border-[var(--divider)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text3)]"
          >
            Dashboard — needs a connection
          </div>
        )}
        {!loaded ? (
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">Loading your saved copy…</p>
        ) : identity ? (
          <>
            {photoBlobUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoBlobUrl}
                alt={identity.vesselName}
                className="mb-4 h-48 w-full rounded-xl object-cover"
              />
            ) : null}
            <p className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--text3)]">
              {identity.mxeId} · viewed offline from this device&apos;s saved copy
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
              {identity.vesselName}
            </h1>
            <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">
              {[identity.year, identity.make, identity.model].filter(Boolean).join(" ")}
            </p>

            <dl className="mt-5 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
              {identity.hin ? <Row label="HIN" value={identity.hin} /> : null}
              {identity.regState || identity.regNumber ? (
                <Row label="Registration" value={[identity.regState, identity.regNumber].filter(Boolean).join(" ")} />
              ) : null}
              {identity.ownerName ? <Row label="Owner" value={identity.ownerName} /> : null}
              {identity.ownerPhone ? <Row label="Owner phone" value={identity.ownerPhone} /> : null}
              {identity.emgName ? <Row label="Emergency contact" value={identity.emgName} /> : null}
              {identity.emgPhone ? <Row label="Emergency phone" value={identity.emgPhone} /> : null}
            </dl>

            <h2 className="mt-6 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
              Documents saved offline
            </h2>
            <div className="mt-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
              {identity.availableDocs.length === 0 ? (
                <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">
                  No documents were saved for offline access.
                </p>
              ) : (
                identity.availableDocs.map((doc) => (
                  <div
                    key={doc}
                    className="flex items-center justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0"
                  >
                    <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{DOC_LABELS[doc]}</p>
                    {docUrls[doc] ? (
                      <a
                        href={docUrls[doc]}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-md border border-[var(--gold-line)] px-3 py-2 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--navy)]"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">Unavailable</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        ) : mxeId ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
              Not saved on this device
            </h1>
            <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              {mxeId} hasn&apos;t been saved for offline access here — or the saved copy was cleared. Reconnect and
              save it again from the vessel&apos;s page.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
              No vessel saved offline
            </h1>
            <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              Reconnect, open a vessel, and tap &quot;Save for offline&quot; to keep its documents readable with no
              signal.
            </p>
          </div>
        )}

        {otherSaved.length > 0 ? (
          <div className="mt-8">
            <h2 className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
              Other vessels saved on this device
            </h2>
            <div className="mt-3 flex flex-col gap-2">
              {otherSaved.map((v) => (
                <a
                  key={v.mxeId}
                  href={`/offline-vessel?mxeId=${encodeURIComponent(v.mxeId)}`}
                  className="rounded-lg border border-[var(--divider)] bg-[var(--white)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)] no-underline"
                >
                  {v.vesselName} <span className="text-[var(--text3)]">· {v.mxeId}</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0">
      <dt className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">
        {label}
      </dt>
      <dd className="text-right font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{value}</dd>
    </div>
  );
}
