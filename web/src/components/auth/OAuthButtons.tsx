"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Provider = "google" | "apple";

type Props = {
  nextPath: string;
  /** Shown above buttons for screen readers / layout consistency */
  className?: string;
};

// Google sign-in was never configured — hidden rather than left as a
// visibly broken control on the login/signup pages. Needs a Google Cloud
// OAuth client set up and registered as a provider in Supabase Auth before
// this can flip back to true.
const GOOGLE_OAUTH_ENABLED = false;

function normalizeNext(path: string) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!p.startsWith("/") || p.startsWith("//")) return "/dashboard";
  return p;
}

export function OAuthButtons({ nextPath, className = "" }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Provider | null>(null);

  async function signInWith(provider: Provider) {
    setError(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Missing Supabase configuration.");
      return;
    }
    setPending(provider);
    const origin = window.location.origin;
    const next = normalizeNext(nextPath);
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { data, error: oauthErr } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (oauthErr) {
      setPending(null);
      setError(oauthErr.message);
      return;
    }

    if (data.url) {
      window.location.assign(data.url);
      return;
    }

    setPending(null);
    setError("Could not start sign-in.");
  }

  return (
    <div className={className}>
      <p className="mb-3 text-center font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        Continue with
      </p>
      <div className="flex flex-col gap-3">
        {GOOGLE_OAUTH_ENABLED ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => signInWith("google")}
            className="flex items-center justify-center gap-2 rounded-lg border border-[var(--divider)] bg-[var(--white)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--text)] transition hover:bg-[var(--cream2)] disabled:opacity-50"
          >
            {pending === "google" ? (
              "Redirecting…"
            ) : (
              <>
                <GoogleMark className="h-5 w-5 shrink-0" />
                Continue with Google
              </>
            )}
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => signInWith("apple")}
          className="flex items-center justify-center gap-2 rounded-lg border border-[var(--navy-deep)] bg-[var(--navy-deep)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--cream)] transition hover:bg-[var(--navy)] disabled:opacity-50"
        >
          {pending === "apple" ? "Redirecting…" : "Sign in with Apple"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p>
      ) : null}
    </div>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
