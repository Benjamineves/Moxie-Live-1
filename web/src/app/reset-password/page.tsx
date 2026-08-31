import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set new password · Moxie",
};

export default async function ResetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  // No session means the recovery link's code exchange (in /auth/callback)
  // never succeeded — missing, expired, or already-used token. There's no
  // legitimate way to reach this page with a usable session otherwise.
  if (!user) {
    return (
      <div className="min-h-screen bg-[var(--cream)]">
        <div className="mx-auto max-w-md px-6 py-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--red-bg)]">
            <svg viewBox="0 0 24 24" className="h-6 w-6 stroke-[var(--red-fg)]" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="mt-5 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            Link <em className="text-[var(--gold)] not-italic">expired.</em>
          </h1>
          <p className="mt-3 font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text2)]">
            Reset links are only good for 15 minutes, and this one&apos;s past that — or it&apos;s already been used.
          </p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-block w-full rounded-lg bg-[var(--navy-deep)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--gold)] transition hover:bg-[var(--navy)]"
          >
            Request a new link →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <ResetPasswordForm />
    </div>
  );
}
