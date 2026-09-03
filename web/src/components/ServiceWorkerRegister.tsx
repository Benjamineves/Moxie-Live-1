"use client";

import { useEffect } from "react";
import { MARKETING_HOST } from "@/lib/site-domains";

/**
 * Registers public/sw.js (app-shell caching only — see that file's own
 * header comment for exactly what it does and doesn't cache). Mounted
 * once from the root layout, which is shared by both domains — skip on
 * moxieyachting.com (marketing-only) so the marketing site never becomes
 * installable or gets a stray service-worker registration.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (window.location.hostname.replace(/^www\./, "") === MARKETING_HOST) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[sw] Registration failed:", err);
    });
  }, []);

  return null;
}
