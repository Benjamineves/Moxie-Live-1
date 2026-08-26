"use client";

import { useState } from "react";
import Link from "next/link";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Props = { nextPath: string };

export function SignupForm({ nextPath }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Missing Supabase configuration.");
      return;
    }
    setPending(true);
    const origin = window.location.origin;
    const { error: signErr } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}` },
    });
    setPending(false);
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
          If confirmation is required, use the link Supabase sends—then sign in. If confirmations are
          disabled, you can go straight to login.
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
        Continue with Google or Apple for the fastest setup, or create an account with email and password.
      </p>

      <OAuthButtons nextPath={nextPath} className="mt-8" />

      <div className="relative mt-10">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <div className="w-full border-t border-[var(--divider)]" />
        </div>
        <div className="relative flex justify-center text-xs uppercase tracking-[0.12em]">
          <span className="bg-[var(--cream)] px-3 font-[family-name:var(--font-dm)] text-[var(--text3)]">
            Or email
          </span>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-4">
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
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2"
          />
        </label>
        {error ? (
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
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
    </div>
  );
}
