"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js (app-shell caching only — see that file's own
 * header comment for exactly what it does and doesn't cache). Mounted
 * once from the root layout. No UI, no state — the service worker
 * itself is the only thing doing anything here.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[sw] Registration failed:", err);
    });
  }, []);

  return null;
}
