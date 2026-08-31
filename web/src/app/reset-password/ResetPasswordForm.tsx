"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Strength = "empty" | "weak" | "fair" | "strong";

// Client-side hint only — matches docs/design/moxie_digital_password_reset.html's
// heuristic. Real minimum length/complexity enforcement happens server-side
// via Supabase.
function scorePassword(value: string): Strength {
  if (value.length === 0) return "empty";
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 8 && /[0-9]/.test(value) && /[a-zA-Z]/.test(value)) score++;
  if (value.length >= 12 && /[0-9]/.test(value) && /[^a-zA-Z0-9]/.test(value)) score++;
  if (score === 0) return "weak";
  if (score === 1) return "fair";
  return "strong";
}

const STRENGTH_HINT: Record<Strength, string> = {
  empty: "At least 8 characters",
  weak: "Too short — needs 8+ characters",
  fair: "Fair — try adding numbers",
  strong: "Strong password",
};

const STRENGTH_BAR_COLOR: Record<Strength, string> = {
  empty: "bg-[var(--divider)]",
  weak: "bg-[var(--red-fg)]",
  fair: "bg-[var(--amber-fg)]",
  strong: "bg-[var(--green-fg)]",
};

function StrengthBars({ strength }: { strength: Strength }) {
  const litCount = strength === "empty" ? 0 : strength === "weak" ? 1 : strength === "fair" ? 2 : 3;
  return (
    <div className="mt-1.5 flex gap-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`h-[3px] flex-1 rounded-full transition-colors ${
            i < litCount ? STRENGTH_BAR_COLOR[strength] : "bg-[var(--divider)]"
          }`}
        />
      ))}
    </div>
  );
}

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [confirmError, setConfirmError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  const strength = scorePassword(password);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setPasswordError(true);
      return;
    }
    setPasswordError(false);

    if (password !== confirm) {
      setConfirmError(true);
      return;
    }
    setConfirmError(false);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Missing Supabase configuration.");
      return;
    }

    setPending(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--green-bg)]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 stroke-[var(--green-fg)]" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <h1 className="mt-5 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
          Password <em className="text-[var(--gold)] not-italic">updated.</em>
        </h1>
        <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          You&apos;re all set — sign in with your new password.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block w-full rounded-lg bg-[var(--navy-deep)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--gold)] transition hover:bg-[var(--navy)]"
        >
          Back to sign in →
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
        Choose a <em className="text-[var(--gold)] not-italic">new password.</em>
      </h1>
      <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
        Make it something you&apos;ll remember — or better yet, save it somewhere you won&apos;t lose it this time.
      </p>

      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-4">
        <label className="flex flex-col gap-1 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
          New password
          <input
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordError) setPasswordError(false);
            }}
            className={`rounded-lg border bg-[var(--white)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2 ${
              passwordError ? "border-[var(--red-fg)]" : "border-[var(--divider)]"
            }`}
          />
          <StrengthBars strength={strength} />
          <span className="mt-0.5 font-[family-name:var(--font-dm)] text-[11px] font-normal normal-case tracking-normal text-[var(--text3)]">
            {STRENGTH_HINT[strength]}
          </span>
        </label>

        <label className="flex flex-col gap-1 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (confirmError) setConfirmError(false);
            }}
            className={`rounded-lg border bg-[var(--white)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2 ${
              confirmError ? "border-[var(--red-fg)]" : "border-[var(--divider)]"
            }`}
          />
          {confirmError ? (
            <span className="font-[family-name:var(--font-dm)] text-[11.5px] font-normal normal-case tracking-normal text-[var(--red-fg)]">
              Passwords don&apos;t match
            </span>
          ) : null}
        </label>

        {error ? <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-lg bg-[var(--navy-deep)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--gold)] transition hover:bg-[var(--navy)] disabled:opacity-50"
        >
          {pending ? "Updating…" : "Update password →"}
        </button>
      </form>
    </div>
  );
}
