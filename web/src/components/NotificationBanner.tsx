"use client";

import { useState, useTransition } from "react";
import { dismissNotification } from "@/lib/owner-actions";

export type OwnerNotification = { id: string; type: string; message: string; created_at: string };

/**
 * Renders unread rows from owner_notifications — the read side of the
 * one notification hook (lib/notify.ts notifyOwner()). In-app only for
 * now; when email is added, this component doesn't change, only
 * notifyOwner()'s body does.
 */
export function NotificationBanner({ notifications }: { notifications: OwnerNotification[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const visible = notifications.filter((n) => !dismissed.has(n.id));
  if (visible.length === 0) return null;

  function dismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
    startTransition(async () => {
      await dismissNotification(id);
    });
  }

  return (
    <div className="mb-6 flex flex-col gap-2">
      {visible.map((n) => (
        <div
          key={n.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] px-4 py-3"
        >
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">{n.message}</p>
          <button
            type="button"
            onClick={() => dismiss(n.id)}
            disabled={pending}
            className="shrink-0 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--navy)] underline disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
