"use client";

import { useEffect } from "react";
import { StatusScreen } from "@/components/StatusScreen";

/**
 * A badge scan that failed on OUR side — today, a missing service role.
 *
 * The whole point of this boundary is the distinction it draws. An unknown
 * or retired token 404s and says the badge is not recognised (not-found.tsx).
 * Anything that throws lands here, gets a 500, and says the opposite: the
 * badge is probably fine, we could not check it. Before this, a missing
 * `SUPABASE_SERVICE_ROLE_KEY` called notFound(), so a misconfigured deploy
 * told everyone scanning a real hull badge that it did not exist — the one
 * flow where a stranger's first impression of Moxie is formed.
 *
 * No "Back to home" link: whoever is here is standing at a boat with a
 * phone, not browsing. Retrying is the only thing worth offering, and a
 * 500 is usually transient from their side.
 */
export default function BadgeScanError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server already logged the cause; this records that a scanner
    // actually hit it, with the digest that ties the two together.
    console.error("[badge-scan] scan failed", error.digest ?? error.message);
  }, [error]);

  return (
    <StatusScreen
      title="Can't check"
      accent="that badge."
      body="Something went wrong on our side, so we could not look this badge up. The badge itself is almost certainly fine — please try again in a moment."
      href={null}
    >
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-[var(--navy)] px-5 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--gold)]"
      >
        Try again
      </button>
    </StatusScreen>
  );
}
