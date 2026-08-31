"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const RESEND_SECONDS = 30;

// Security note (see docs/design/moxie_digital_password_reset.html): this
// form must respond identically whether or not `email` matches a real
// account. resetPasswordForEmail() itself doesn't leak that distinction,
// but to be safe we also never branch the UI on its result — any outcome
// other than a locally-caught malformed email always lands on "check your
// inbox." Real failures (network, rate limit) are logged, never surfaced
// as a different state, so there's no observable signal to enumerate with.
async function requestReset(email: string) {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) {
    console.error("[forgot-password] Missing Supabase configuration.");
    return;
  }
  const origin = window.location.origin;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error) {
    console.error("[forgot-password] resetPasswordForEmail failed:", error.message);
  }
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState(false);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(RESEND_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startResendTimer() {
    setResendSeconds(RESEND_SECONDS);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendSeconds((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setEmailError(true);
      return;
    }
    setEmailError(false);
    setPending(true);
    await requestReset(trimmed);
    setPending(false);
    setSent(true);
    startResendTimer();
  }

  async function onResend() {
    if (resendSeconds > 0) return;
    await requestReset(email.trim());
    startResendTimer();
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--green-bg)]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 stroke-[var(--green-fg)]" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22 6 12 13 2 6" />
          </svg>
        </div>
        <h1 className="mt-5 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
          Check your <em className="text-[var(--gold)] not-italic">inbox.</em>
        </h1>
        <p className="mt-3 font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text2)]">
          We sent a reset link to
          <br />
          <span className="font-semibold text-[var(--navy)]">{email.trim()}</span>
          <br />
          Tap it on this device — the link expires in 15 minutes.
        </p>
        <button
          type="button"
          onClick={onResend}
          disabled={resendSeconds > 0}
          className="mt-6 w-full rounded-lg border border-[var(--gold-line)] px-5 py-3 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--navy)] transition hover:bg-[var(--gold-dim)] disabled:opacity-40"
        >
          Resend link
        </button>
        <p className="mt-3 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
          {resendSeconds > 0
            ? `Didn't get it? Check spam, or resend in ${resendSeconds}s`
            : "Didn't get it? Check spam, or tap Resend Link above."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
        Locked out? <em className="text-[var(--gold)] not-italic">Let&apos;s fix that.</em>
      </h1>
      <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
        Enter the email on your account and we&apos;ll send a link to set a new password.
      </p>

      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-4">
        <label className="flex flex-col gap-1 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
          Email address
          <input
            type="email"
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(false);
            }}
            className={`rounded-lg border bg-[var(--white)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2 ${
              emailError ? "border-[var(--red-fg)]" : "border-[var(--divider)]"
            }`}
          />
        </label>
        {emailError ? (
          <p className="-mt-2 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">
            Enter a valid email address
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-lg bg-[var(--navy-deep)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--gold)] transition hover:bg-[var(--navy)] disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send reset link →"}
        </button>
      </form>

      <p className="mt-8 font-[family-name:var(--font-dm)] text-sm">
        Remembered it?{" "}
        <Link className="text-[var(--blue-fg)] underline" href="/login">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
