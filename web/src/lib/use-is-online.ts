"use client";

import { useSyncExternalStore } from "react";

/**
 * Live connectivity, for UI that has to be honest about whether a
 * network-dependent control will actually work (moxie_digital_pwa_spec.md
 * §3b). Kept updating via the online/offline events rather than checked
 * once on load — someone sitting on an offline surface waiting for signal
 * to come back is exactly the case these controls exist for.
 *
 * useSyncExternalStore rather than a useEffect+setState pair: this repo's
 * lint config errors on a setState reachable synchronously from an effect
 * body, and a browser event subscription with a differing server value is
 * precisely the shape useSyncExternalStore exists for.
 *
 * Shared by /offline-vessel's exit link and DocumentsEdit's View action —
 * both need the same question answered, so they ask it the same way.
 */
function subscribeOnlineStatus(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

function getOnlineServerSnapshot() {
  // Only matters for the hydration handshake — never a value anyone sees
  // for long. Defaulting to "offline" is the conservative choice: the
  // first paint never briefly shows an enabled control that the real
  // navigator.onLine value, read a tick later on the client, would
  // immediately have to disable again.
  return false;
}

export function useIsOnline() {
  return useSyncExternalStore(subscribeOnlineStatus, getOnlineSnapshot, getOnlineServerSnapshot);
}
