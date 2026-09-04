"use client";

import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { clearAllOfflineData } from "@/lib/offline-vessel-store";

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const router = useRouter();

  async function onSignOut() {
    // Cleared before the auth call, not after — a shared/borrowed
    // device must not leak a saved-offline vessel's documents to
    // whoever signs in next (build spec §6). Runs regardless of
    // whether signOut() itself succeeds.
    await clearAllOfflineData();
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
