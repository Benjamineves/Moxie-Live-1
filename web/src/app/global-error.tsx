"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Last-resort boundary for an error in the root layout itself. Reports it to
 * Sentry (when configured) and shows a plain page — the root layout, and so
 * its fonts and styles, may be what failed.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "48px 24px", textAlign: "center", color: "#0d1f35" }}>
        <h1 style={{ fontWeight: 400 }}>Something went wrong on our end.</h1>
        <p>It&apos;s been reported. Please try again in a moment.</p>
        <p>
          <Link href="/" style={{ color: "#0d1f35" }}>
            Back to home
          </Link>
        </p>
      </body>
    </html>
  );
}
