import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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

export default nextConfig;
