"use client";

import { useState, useSyncExternalStore } from "react";

const DISMISSED_KEY = "moxie-install-dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Module-level store for the captured beforeinstallprompt event, read via
// useSyncExternalStore below. A plain useState+useEffect pair would need a
// setState call synchronously in the effect body just to register the
// listener's result, which is exactly the cascading-render footgun
// useSyncExternalStore exists to avoid — and since there's only ever one
// live prompt per page load, one shared module-level slot (registered once,
// not re-subscribed per mount) is simpler than per-component state anyway.
let capturedPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    capturedPrompt = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
}

function clearCapturedPrompt() {
  capturedPrompt = null;
  listeners.forEach((l) => l());
}

function subscribeToPrompt(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function subscribeNoop() {
  return () => {};
}

// Static, browser-only facts (no "did this change" event to subscribe to) —
// read via useSyncExternalStore with a no-op subscribe so the SSR pass gets
// a fixed server snapshot and the client pass gets the real one, without a
// setState-in-effect round trip in between.
function useClientOnly<T>(getClientValue: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeNoop, getClientValue, () => serverValue);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag — display-mode media query doesn't reliably
    // reflect home-screen launches there.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports as "Macintosh" but is touch-capable, unlike a real Mac.
  const isIPadOS = window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIPadOS;
}

/**
 * Dashboard-only install trigger (moxie_digital_pwa_spec.md §3/§8). This
 * component is mounted from the dashboard, which the domain-split
 * middleware already keeps exclusive to moxieyacht.com — no host check
 * needed here.
 *
 * Android/Chrome: capture `beforeinstallprompt` and trigger it directly.
 * iOS Safari never fires that event — there is no programmatic install —
 * so the same button opens IOSInstallCard's manual Share-sheet steps
 * instead. Everywhere else (desktop Safari/Firefox, already-standalone,
 * previously dismissed) renders nothing; there's no install path to offer.
 */
export function InstallPrompt() {
  const mounted = useClientOnly(() => true, false);
  const standalone = useClientOnly(isStandalone, false);
  const dismissedInStorage = useClientOnly(() => window.localStorage.getItem(DISMISSED_KEY) === "1", false);
  const ios = useClientOnly(isIOS, false);
  const deferredPrompt = useSyncExternalStore(
    subscribeToPrompt,
    () => capturedPrompt,
    () => null,
  );

  const [dismissedNow, setDismissedNow] = useState(false);
  const [showIOSCard, setShowIOSCard] = useState(false);

  function dismiss() {
    setDismissedNow(true);
    window.localStorage.setItem(DISMISSED_KEY, "1");
  }

  async function handleInstallClick() {
    if (ios) {
      setShowIOSCard(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    clearCapturedPrompt();
    if (outcome === "accepted") dismiss();
  }

  if (!mounted || standalone || dismissedInStorage || dismissedNow) return null;
  if (!ios && !deferredPrompt) return null;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] px-4 py-3">
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
          Install Moxie for one-tap access to your dashboard — no browser tabs, no re-signing in.
        </p>
        <div className="flex shrink-0 items-center gap-4">
          <button
            type="button"
            onClick={handleInstallClick}
            className="rounded-lg bg-[var(--navy)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--gold)]"
          >
            Install Moxie
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--navy)] underline"
          >
            Not now
          </button>
        </div>
      </div>
      {showIOSCard ? <IOSInstallCard onClose={() => setShowIOSCard(false)} onDone={dismiss} /> : null}
    </>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 shrink-0" aria-hidden>
      <path
        d="M12 3v12M12 3l-4 4M12 3l4 4"
        stroke="var(--aqua-bright)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
        stroke="var(--aqua-bright)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IOSInstallCard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-[rgba(13,31,53,0.55)] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Install Moxie on iOS"
    >
      <div className="w-full max-w-sm rounded-2xl bg-[var(--cream)] p-6">
        <h2 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
          Add to Home Screen
        </h2>
        <p className="mb-5 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          iOS doesn&apos;t allow apps to install themselves — three taps in Safari does it.
        </p>
        <ol className="mb-6 flex flex-col gap-4">
          <li className="flex items-center gap-3">
            <ShareIcon />
            <span className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
              Tap the <strong>Share</strong>
              {" "}icon in Safari&apos;s toolbar
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--gold-line)] font-[family-name:var(--font-dm)] text-lg leading-none text-[var(--gold)]">
              +
            </span>
            <span className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
              Scroll down and tap{" "}
              <strong>Add to Home Screen</strong>
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--navy)] font-[family-name:var(--font-dm)] text-xs font-semibold text-[var(--gold)]">
              Add
            </span>
            <span className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
              Tap <strong>Add</strong>
              {" "}in the top right
            </span>
          </li>
        </ol>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text2)] underline"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg bg-[var(--aqua-bright)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy-deep)]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
