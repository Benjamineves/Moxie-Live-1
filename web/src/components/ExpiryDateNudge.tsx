"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY_PREFIX = "moxie-expiry-nudge-dismissed:";

/**
 * Catch-up prompt for documents that were uploaded before there was
 * anywhere to put their expiry date. Same shape as AddPhotoNudge, with
 * one difference: AddPhotoNudge needs no dismiss state because its
 * condition IS the data (it vanishes the moment photo_url is set), while
 * this one asks for something an owner may reasonably not have to hand,
 * so it's dismissible and stays dismissed per vessel.
 *
 * COPY CONSTRAINT — deliberate, do not "improve" this into a reminder
 * offer: nothing here may promise a reminder, notification, or alert.
 * No email provider is configured, so a promised reminder would silently
 * never arrive — worst of all for insurance, where the owner would be
 * relying on it. The ask is framed entirely around seeing status at a
 * glance on this page, which is the thing that actually works today.
 * Reminder copy lands when email does.
 */
export function ExpiryDateNudge({
  mxeId,
  missingRegistration,
  missingInsurance,
  href,
}: {
  mxeId: string;
  missingRegistration: boolean;
  missingInsurance: boolean;
  /** Where "Add" goes. Passed in because the documents it points at no longer live on the page that renders this nudge. */
  href: string;
}) {
  const [dismissed, setDismissed] = useState(true); // hidden until the effect confirms otherwise
  const storageKey = `${DISMISSED_KEY_PREFIX}${mxeId}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Deliberate microtask deferral — this repo's lint config errors on
      // a setState reachable synchronously from an effect body.
      await Promise.resolve();
      if (cancelled) return;
      try {
        setDismissed(window.localStorage.getItem(storageKey) === "1");
      } catch {
        // Private browsing with storage blocked — show the nudge rather
        // than suppress it; it's dismissible either way.
        setDismissed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Nothing to persist to; it stays dismissed for this session.
    }
  }

  if (dismissed) return null;

  const which =
    missingRegistration && missingInsurance
      ? "your registration and insurance"
      : missingRegistration
        ? "your registration"
        : "your insurance";

  return (
    <section className="mx-auto mt-6 max-w-lg rounded-xl bg-[var(--gold-dim)] p-5">
      <div className="flex items-center gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--gold-dim)]">
          <svg className="h-[18px] w-[18px] stroke-[var(--gold)]" viewBox="0 0 24 24" fill="none" strokeWidth={1.5}>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
            Add the expiry date on {which}
          </p>
          <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            It&apos;s printed on the document — adding it shows current, expiring, or expired at a glance whenever you
            open this page.
          </p>
        </div>
        <a
          href={href}
          className="shrink-0 rounded-md bg-[var(--navy)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--gold)] no-underline"
        >
          Add
        </a>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="mt-3 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text2)] underline"
      >
        Not now
      </button>
    </section>
  );
}
