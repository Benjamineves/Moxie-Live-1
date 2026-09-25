import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */

  // sharp rasterizes badge artwork server-side (lib/badge-artwork.ts).
  // It is a native binary and must not be traced into the bundler —
  // left to Next's default handling it either fails to resolve its
  // platform binary at runtime or is bundled uselessly. Declared here
  // rather than relying on it being a transitive dependency of
  // next/image, which is how the icon-generation script has been using
  // it and is not a guarantee for production code.
  serverExternalPackages: ["sharp"],
  async headers() {
    return [
      {
        // The Service Worker spec re-checks for updates on every
        // navigation, but only up to a 24h mandated ceiling if the
        // response is cacheable — an explicit no-cache here means a
        // deployed sw.js change (bumped CACHE_VERSION) takes effect on
        // the very next load instead of waiting.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

// Sentry: uploads source maps at build time so browser stack traces are
// readable — only when SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are
// set (Vercel). Without them the build is unchanged apart from Sentry's
// instrumentation, which stays inert without a DSN (lib/sentry-options.ts).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  telemetry: false,
});
