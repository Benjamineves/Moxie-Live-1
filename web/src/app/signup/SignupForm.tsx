"use client";

import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { safeNextPath } from "@/lib/safe-next";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { useCaptcha } from "@/components/auth/useCaptcha";

type Props = { nextPath: string };

export function SignupForm({ nextPath }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const captcha = useCaptcha();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Missing Supabase configuration.");
      return;
    }
    if (!captcha.ready) {
      setError("Complete the security check first.");
      return;
    }
    setPending(true);
    const origin = window.location.origin;
    const { error: signErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(nextPath))}`,
        ...(captcha.token ? { captchaToken: captcha.token } : {}),
      },
    });
    setPending(false);
    captcha.reset();
    if (signErr) {
      setError(signErr.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
          Check your email
        </h1>
        <p className="mt-4 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          We sent a confirmation link to <span className="font-semibold text-[var(--navy)]">{email}</span>. Open it
          to confirm your account. If it doesn&apos;t sign you in — say you opened it on another device — sign in
          below with your email and password.
        </p>
        <Link
          className="mt-8 inline-block font-[family-name:var(--font-dm)] text-sm text-[var(--blue-fg)] underline"
          href={`/login?next=${encodeURIComponent(nextPath)}`}
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
        Create account
      </h1>
      <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
        Create an account with your email and a password.
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2"
          />
        </label>
        <label className="flex flex-col gap-1 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
          Password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2"
          />
        </label>
        {captcha.widget}
        {captcha.configError ? (
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{captcha.configError}</p>
        ) : null}
        {error ? (
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={pending || !captcha.ready || !!captcha.configError}
          className="mt-2 rounded-lg bg-[var(--navy-deep)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--gold)] transition hover:bg-[var(--navy)] disabled:opacity-50"
        >
          {pending ? "Creating…" : "Sign up"}
        </button>
      </form>

      <p className="mt-8 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
        Already have an account?{" "}
        <Link className="text-[var(--blue-fg)] underline" href={`/login?next=${encodeURIComponent(nextPath)}`}>
          Sign in
        </Link>
      </p>
      <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
        New to Moxie?{" "}
        <Link className="text-[var(--gold-deep)] underline underline-offset-2" href="/faq">
          Read the FAQ
        </Link>
        .
      </p>
    </div>
  );
}
