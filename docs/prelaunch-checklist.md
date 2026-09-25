# Pre-launch checklist

_Last updated 25 September 2026._ One list for launch readiness. Detail lives
in `moxie_roadmap.md`; this file is the gate. **Blocker** = don't launch until
it's done. Status: **done** · **open** (code/work to do) · **needs Ben**
(a decision, account, dashboard setting or purchase only Ben can make).

## Security

| Item | Status | Blocker |
|---|---|---|
| Public key can't read `vessels`; public schema grants and default privileges closed (`20261010`, `20261013`) | done | — |
| Document and photo buckets: own-folder policies, 10 MB + type limits (`20261011`, `20261012`) | done | — |
| Stored-path check, safe sign-in redirects, owner lookup, Apple button hidden (authz audit) | done | — |
| Dependency vulnerabilities: `next` 16.3.6, `sharp` 0.35.4, transitive fixes — `npm audit --omit=dev` reports 0 (2026-09-25). Re-run before launch | done | — |
| CAPTCHA (Cloudflare Turnstile) on sign-up, sign-in, reset — code shipped behind `NEXT_PUBLIC_CAPTCHA_ENABLED` (off); turn on per `lib/captcha-config.ts` | needs Ben (site + secret key, then Vercel env, then Supabase) | **Yes** |
| Stripe webhook secret: live-mode endpoint's `whsec_` in Vercel Production, webhook pointed at the apex; confirm a test event verifies | needs Ben | **Yes** |
| Vercel env review: Production has live values only, no test keys; `CRON_SECRET` set; `ADMIN_EMAILS` without `ben@`; service-role key not in Preview | needs Ben | **Yes** |
| Leaked-password protection; 30-day session inactivity timeout | needs Ben (Supabase Pro) | — |
| Per-user storage quota (uploads can exceed the plan's 500 MB, 10 MB at a time) | open (deferred) | — |
| Public scan profile: remove marina name and city from the allow-list (storage city/state stay public) | open | **Yes** |

## Payments

| Item | Status | Blocker |
|---|---|---|
| Pricing numbers: Basic setup fee, Full annual, transfer fee | needs Ben | **Yes** |
| Stripe live keys in Vercel, live Prices, live webhook | needs Ben | **Yes** |
| Document-limit decision (Basic 3 vs fixed slots) — settle with pricing | needs Ben | **Yes** (drives copy) |
| Transfer buyer never has to subscribe (30-day window via scheduler) | open | — |
| Upgrading to Full doesn't restore cap-locked vessels | open | — |
| Stored tier vs Stripe reconciliation (scheduler; must skip billing-exempt) | open | — |
| Abandoned Basic→Full upgrades | done (none exist; closed for new clicks) | — |

## Data / backups

| Item | Status | Blocker |
|---|---|---|
| Supabase Pro for daily backups (none today — no restore point) | needs Ben | **Yes** |
| Migrations run: `20261005`–`20261014` — their tables/functions confirmed in the 2026-09-25 security snapshot and later checks; earlier ones not re-checked | done | — |

## Email

| Item | Status | Blocker |
|---|---|---|
| Auth email through Resend SMTP | done | — |
| Raise Auth email rate limit (25/hour today); confirm Resend plan covers auth + app mail | needs Ben | **Yes** |
| Support address: `support@moxieyachting.com` (alias on the admin mailbox); FAQ updated | done | — |
| `admin@moxieyachting.com` confirmed receiving (commercial-interest and scheduler digest mail, and now support@) | needs Ben | **Yes** |
| DMARC `p=none` → `quarantine` after a few weeks of clean sending | open | — |

## Public copy accuracy

| Item | Status | Blocker |
|---|---|---|
| "Unlimited documents" — removed from `/pricing`, upgrade form, signup bundle, badge payment page | done | — |
| "Email reminders" — removed from upgrade form and badge payment page | done | — |
| FAQ share-link answer reworded to what's built (file names only; marina access opens registration/insurance). Viewing is post-launch | done | — |
| Homepage waitlist "we'll follow up" — list now stores, but nothing in admin shows it | open | — |
| Maintenance-history lines on the home page | done (service records shipped) | — |
| `/login` intro: provider line and developer setup text removed; email sign-in only | done | — |
| `/signup`: provider line, "Or email" divider and Supabase confirmation wording removed; email sign-up only | done | — |

## Legal

| Item | Status | Blocker |
|---|---|---|
| Terms of service and privacy policy — **no pages exist**; needed before taking payments and holding owners' documents | needs Ben | **Yes** |
| "Patent pending": convert the provisional by **26 Jun 2027** or remove the claim (site, footer, printed badge) | needs Ben | — (date-bound) |
| Account deletion: none in the app — handled by emailing support (Terms to say so) | done (by policy) | — |

## Badge operations

| Item | Status | Blocker |
|---|---|---|
| Badge supplier (sheet size, bleed, crop marks) → print exporter | needs Ben | **Yes** |
| First print run (100 identities / 200 badges; scan test at 3") | open (after supplier) | **Yes** |
| Two-badge mailer packaging | open (after badges) | **Yes** |
| Badge replacement process (lost/damaged) | open | — |
| `shipped_at` / `received_at` renames + per-identity despatch time | open | — |

## Monitoring

| Item | Status | Blocker |
|---|---|---|
| `CRON_SECRET` in Vercel Production, first scheduler run (report-only) | needs Ben | — |
| Uptime monitor on `/api/health/scheduler` after the first run | open | — |
| Error reporting: Sentry code shipped (server, edge, browser; errors only, scrubbed), inert until `NEXT_PUBLIC_SENTRY_DSN` is set | needs Ben (Sentry project + Vercel env) | — |
| Badge pool low-water alarm on `/admin` | done | — |
