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
| Dependency vulnerabilities: `npm audit` (prod, 2026-09-25) — **1 critical** (`next` DoS, fix `next@16.3.6`), **4 high** (`sharp` → 0.35.4 major; `postcss`, `nanoid`, `ws` transitive), 1 moderate. Upgrade, then re-run | open | **Yes** |
| CAPTCHA (Cloudflare Turnstile) on sign-up, sign-in, reset — code behind a flag first, then the Supabase setting | needs Ben (site key), then open | **Yes** |
| Stripe webhook secret: live-mode endpoint's `whsec_` in Vercel Production, webhook pointed at the apex; confirm a test event verifies | needs Ben | **Yes** |
| Vercel env review: Production has live values only, no test keys; `CRON_SECRET` set; `ADMIN_EMAILS` without `ben@`; service-role key not in Preview | needs Ben | **Yes** |
| Leaked-password protection; 30-day session inactivity timeout | needs Ben (Supabase Pro) | — |
| Per-user storage quota (uploads can exceed the plan's 500 MB, 10 MB at a time) | open (deferred) | — |

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
| `support@moxieyacht.com` mailbox — the FAQ tells people to use it | needs Ben | **Yes** |
| `admin@moxieyachting.com` confirmed receiving (commercial-interest and scheduler digest mail) | needs Ben | — |
| DMARC `p=none` → `quarantine` after a few weeks of clean sending | open | — |

## Public copy accuracy

| Item | Status | Blocker |
|---|---|---|
| "Unlimited documents" — `/pricing`, upgrade form, signup bundle; documents are four fixed slots | open (remove or build) | **Yes** |
| "Email reminders" — upgrade form, badge payment page; nothing sends them | open (remove or ship scheduler reminders) | **Yes** |
| FAQ "show my documents" via share link — recipients see file names only, can't open them | open (reword or build) | **Yes** |
| Homepage waitlist "we'll follow up" — list now stores, but nothing in admin shows it | open | — |
| Maintenance-history lines on the home page | done (service records shipped) | — |

## Legal

| Item | Status | Blocker |
|---|---|---|
| Terms of service and privacy policy — **no pages exist**; needed before taking payments and holding owners' documents | needs Ben | **Yes** |
| "Patent pending": convert the provisional by **26 Jun 2027** or remove the claim (site, footer, printed badge) | needs Ben | — (date-bound) |

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
| Error reporting — nothing alerts on a 500 today (no Sentry or similar) | open | — |
| Badge pool low-water alarm on `/admin` | done | — |
