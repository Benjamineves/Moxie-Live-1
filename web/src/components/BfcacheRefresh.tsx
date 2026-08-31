"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * This page's data (tier, billing) is fetched fresh server-side per
 * request by design, to avoid a client-side loading spinner. That's the
 * right call for a normal navigation — but the browser's own
 * back-forward cache can restore a whole prior render of this page from
 * memory on a Back-button return (e.g. from checkout), bypassing that
 * fetch entirely and showing stale data with no request ever made.
 * `pageshow`'s `persisted` flag is how browsers report exactly that
 * restoration; router.refresh() re-runs the server component in place.
 */
export function BfcacheRefresh() {
  const router = useRouter();

  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) {
        router.refresh();
      }
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  return null;
}
