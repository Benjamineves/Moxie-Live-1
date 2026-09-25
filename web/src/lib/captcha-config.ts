/**
 * The CAPTCHA switch (Cloudflare Turnstile) for sign-up, sign-in and
 * password reset. OFF unless NEXT_PUBLIC_CAPTCHA_ENABLED is exactly "true".
 *
 * Order to turn it on (docs/prelaunch-checklist.md):
 *   1. Create a Turnstile widget in Cloudflare; put its SITE key in
 *      NEXT_PUBLIC_TURNSTILE_SITE_KEY and set NEXT_PUBLIC_CAPTCHA_ENABLED=true
 *      in Vercel Production. Deploy (NEXT_PUBLIC_ values are baked in at
 *      build time).
 *   2. THEN in Supabase: Auth → Attack Protection → enable CAPTCHA,
 *      provider Turnstile, with the widget's SECRET key.
 * Reversed, Supabase rejects every sign-in that arrives without a token.
 * To turn it off, reverse the order: Supabase first, then the flag.
 *
 * Testing it locally: use a production build (`next build` + `next start`)
 * with the two variables set. On 2026-09-25 (Next 16.3.6, Turbopack) the dev
 * server did NOT inline these values into client code when they came from
 * .env.development.local — the server rendered the widget, the browser didn't,
 * and React logged a hydration mismatch. A production build inlined them.
 * Cloudflare's always-pass test site key is 1x00000000000000000000AA.
 *
 * On with no site key is a configuration error the forms SHOW — not a
 * silent fallback to no captcha, which Supabase would then refuse with an
 * unhelpful message.
 */
export type CaptchaConfig = { enabled: false } | { enabled: true; siteKey: string | null };

export function captchaConfig(env: { flag?: string; siteKey?: string }): CaptchaConfig {
  if (env.flag !== "true") return { enabled: false };
  const siteKey = env.siteKey?.trim() || null;
  return { enabled: true, siteKey };
}

// Read with literal property access so Next inlines them into the client
// bundle.
export const CAPTCHA = captchaConfig({
  flag: process.env.NEXT_PUBLIC_CAPTCHA_ENABLED,
  siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
});
