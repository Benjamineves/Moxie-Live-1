"use client";

import { clearAllOfflineData } from "@/lib/offline-vessel-store";

/**
 * dashboard/page.tsx's sign-out uses its own server action (redirects to
 * /login) rather than SignOutButton.tsx's client-side signOut() + "/"
 * redirect — this wraps that same server action with the same offline-
 * data clear SignOutButton.tsx does, so both sign-out paths clear a
 * shared/borrowed device's cached documents (build spec §6), not just
 * one of them. onSubmit fires before the form's action submission
 * proceeds; not awaited, since Cache Storage deletion and
 * localStorage.removeItem are both fast relative to the ensuing
 * navigation.
 */
export function SignOutFormButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={() => void clearAllOfflineData()}>
      <button
        type="submit"
        className="rounded-md border border-[var(--gold)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--gold)]"
      >
        Sign out
      </button>
    </form>
  );
}
