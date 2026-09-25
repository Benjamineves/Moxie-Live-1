"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { safeNextPath } from "@/lib/safe-next";
import { useCaptcha } from "@/components/auth/useCaptcha";

type Props = { nextPath: string };

export function LoginForm({ nextPath }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const captcha = useCaptcha();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captcha.token ? { captchaToken: captcha.token } : undefined,
    });
    setPending(false);
    captcha.reset();
    if (signErr) {
      setError(signErr.message);
      return;
    }
    router.push(safeNextPath(nextPath));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
        Sign in
      </h1>
      <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
        Use the email and password on your account.
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2"
          />
        </label>
        <Link
          className="-mt-2 self-end font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline"
          href="/forgot-password"
        >
          Forgot password?
        </Link>
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
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-8 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
        Need an account?{" "}
        <Link className="text-[var(--blue-fg)] underline" href={`/signup?next=${encodeURIComponent(nextPath)}`}>
          Create one
        </Link>
      </p>
      <p className="mt-4 font-[family-name:var(--font-dm)] text-sm">
        <Link className="text-[var(--text3)] underline" href="/">
          ← Home
        </Link>
      </p>
    </div>
  );
}
