/**
 * moxieyacht.com and moxieyachting.com are one Vercel deployment but two
 * distinct browser origins — no shared cookie domain. moxieyacht.com is
 * canonical and session-aware (auth, dashboard, MXE scans, the PWA);
 * moxieyachting.com is marketing-only. See docs/moxie_digital_pwa_spec.md
 * for the decision record.
 */
export const APP_HOST = "moxieyacht.com";
export const MARKETING_HOST = "moxieyachting.com";
export const APP_ORIGIN = `https://${APP_HOST}`;
export const MARKETING_ORIGIN = `https://${MARKETING_HOST}`;
