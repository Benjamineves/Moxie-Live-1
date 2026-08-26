"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const router = useRouter();

  async function onSignOut() {
    const supabase = createSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void onSignOut()}
      className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--gold)] hover:text-white"
    >
      {label}
    </button>
  );
}
