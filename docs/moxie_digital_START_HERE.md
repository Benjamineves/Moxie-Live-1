# Moxie Digital — START HERE

**Read this first.** It says what Moxie is today, where everything lives, which documents describe the code accurately, and which have drifted. How to *work* in the repo — standing rules, migrations, verification, code conventions — is in [`CLAUDE.md`](../CLAUDE.md) at the repo root.

*Last brought current: 2026-09-14. The previous version (August) was a pre-build guide for assembling a build folder; everything it described is now built or superseded.*

---

## 1. What Moxie is, as built

A vessel registry. Every boat gets a permanent **MXE ID** (`MXE-01024`), printed on a weatherproof QR badge that goes on the hull. Scanning it opens the vessel's profile: a public view for anyone, and an owner view for the owner. Owners manage documents, a photo, Trusted Contact share links, ownership transfer to a buyer, and decommissioning.

**Money:**
- A one-time **badge fee** per vessel ($29).
- An account-level subscription: **Basic** ($59/yr, 2 active vessels) or **Full Access** ($149/yr, 5 active vessels).
- A **transfer fee** paid by the seller ($49 on Basic, $25 on Full).

Prices and limits live in `web/src/lib/tier-config.ts`; the actual charge comes from the Stripe Price each env var points at. The badge fee, signup bundle, transfer fee and plan picker checkouts are card-only; the Basic → Full upgrade at `/dashboard/upgrade` is not yet (open item 10).

**Badge inventory:** MXE IDs are **sequential, five digits**, allocated when a badge batch is minted, not when a vessel registers. A vessel is assigned a pre-minted identity from the pool at creation; badges encode `/s/<token>`, which resolves to the vessel. An unpaid vessel's identity can be reclaimed back to stock.

**Dormancy:** a vessel can be *lapsed* (subscription failed or ended), *locked* (more vessels than the plan covers, after a 14-day grace window), or *decommissioned*. Its identity and public page persist in every case. Owners are notified by email and in-app.

**Live:** `moxieyacht.com` is the app, QR links and dashboard. `moxieyachting.com` is marketing (`/` and `/pricing`); the middleware redirects between them. Deploys go to Vercel on every push to `main`.

---

## 2. Where things live

| Path | What |
|---|---|
| `web/` | The Next.js app (Next 16.2, React 19, Turbopack) |
| `web/src/app/` | Routes. `[mxeId]` is the vessel profile; `dashboard/`, `admin/`, `transfer/`, `s/[token]`, `api/stripe/webhook` |
| `web/src/lib/` | Server logic and pure modules. **Relative imports with `.ts` extensions here** — see CLAUDE.md |
| `web/src/lib/*.test.mts` | Tests, run by `npm test` (Node's test runner) |
| `web/scripts/` | One-off scripts that import production modules (badge artwork, live-send checks, email template generation) |
| `supabase/seed.sql` | **The base schema** — `users`, `vessels`, `marinas`, `vessel_documents`, `qr_tokens`, `waitlist`, and the `updated_at` triggers |
| `supabase/migrations/` | Everything since. Prepared by Claude, **run by hand** in the Supabase SQL editor |
| `docs/` | Specs (below), `docs/design/` HTML mockups and the brand guide PDF, `docs/email/` paste-ready Supabase email templates |
| `.claude/launch.json` | Dev servers: `moxie-web` (dev, :3010), `moxie-web-prod` (`next start`, :3012) |

**Services:** Supabase (Postgres; Auth with email + password plus Google and Apple sign-in; Storage), Stripe (test mode), Resend (transactional email from `notifications@send.moxieyacht.com`), Vercel.

---

## 3. The specs, and how far each one matches the code

The rule that used to govern this folder — "anything named `moxie_digital_` is current" — no longer holds. Several specs predate large parts of the build. **Where a spec and the code disagree, the code (and the newer, more specific spec) is right**, including over the build spec's own claim to override everything. Drift is noted below rather than fixed in the specs.

| Spec | Status | Drift from the code |
|---|---|---|
| [`moxie_digital_brand_addendum_integration.md`](moxie_digital_brand_addendum_integration.md) | **Current.** §6b (surface-specific colour tokens, measured contrast) is the reference for any colour work | None known |
| [`moxie_digital_dormant_identity_spec.md`](moxie_digital_dormant_identity_spec.md) | Built. §8 records known gaps | **§5 "Document overflow"** — Basic's document limit is 3 and exactly 3 slots count, so no document can ever lock, and there's no choose-which-documents flow. **§5 "Storage overflow"** (uploads blocked when over) — not verified against the code. **§6 "Locked → owner upgrades to Full (restores all)"** — not implemented; upgrading doesn't restore locked vessels (the owner has to use manage-fleet). **§7.4** says there's no email infrastructure; there is (Resend), and dormancy events now email |
| [`moxie_digital_badge_provisioning_spec.md`](moxie_digital_badge_provisioning_spec.md) | Built, stages 1–7c (schema, minting, artwork, contact sheet, `/s/<token>`, status transitions, assignment at creation, reclaim) | **Header says "Planned, not built. No code or migration written."** The reclaim principle section still says "**Not built.** `delete_unactivated_vessel` is the likely hook" — it's built. It describes reclaim as an **admin** action; since 2026-09-14 the **owner's** delete button for an unpaid vessel also reclaims the badge, through the same shared helper and Stripe check |
| [`moxie_digital_pwa_spec.md`](moxie_digital_pwa_spec.md) | Largely built (service worker, install prompt, offline vessel and document caching) | **Header says "Build spec · not yet built."** Its "Related" line calls `notifyOwner()` in-app banners only; it also emails now. Which parts of the spec remain unbuilt hasn't been audited |
| [`moxie_digital_technical_spec_share_profile.md`](moxie_digital_technical_spec_share_profile.md) | Built (`vessel_shares`, share sheet, `/api/share/[token]`) | **Header says "Designed, not built."** Detail-level drift not audited |
| [`moxie_digital_build_spec.md`](moxie_digital_build_spec.md) | Historical master spec (August). Still useful for data model, role visibility and the reasoning behind early decisions | **Pricing model** — describes a "one-time setup fee" plus a subscription as two alternative tiers; the build has a badge fee *and* a Basic/Full subscription. **MXE ID format** — §9 says "not actually resolved" and recommends randomized 6-character IDs; they're sequential, five digits, pre-minted. **Transactional email** — "no provider chosen"; Resend is live. **Design file list** still calls `moxie_digital_auth_login.html` magic-link sign-in; auth is email + password plus Google and Apple sign-in (§9-B7 records the email + password decision). **Precedence** — its header says it wins over every other document; on these points it doesn't |
| [`moxie_digital_acceptance_tests.md`](moxie_digital_acceptance_tests.md) | Historical (August) | **MXE ID format** listed as unresolved. **Fixture vessels** `MXE-00001` (Discovery One) and friends don't exist in the live database; live vessels start at `MXE-01006`. Largely covers P0 milestones since superseded by the badge, transfer and dormancy work |
| [`moxie_digital_schema.sql`](moxie_digital_schema.sql) | **Out of date — don't run it.** Header says "CURRENT" | A copy of `supabase/seed.sql` plus what migration `20260825` adds, from August. Has none of the tables or functions from the 36 migrations since. For the base schema use `supabase/seed.sql`; for what actually exists, query the live database |
| [`moxie_digital_broker_role_spec.md`](moxie_digital_broker_role_spec.md) | **Not built**, and says so. "Commercial / Broker" is advertised on `/pricing` with a contact button | Accurate as far as checked |
| [`moxie_digital_marina_registry_spec.md`](moxie_digital_marina_registry_spec.md) | **Not built**, and says so | Accurate as far as checked |
| [`docs/email/README.md`](email/README.md) | Current — how the Supabase password-reset template is generated and pasted | None known |

---

## 4. Open items

Known and deliberately not done, as of 2026-09-14. The first several were raised in recent tasks; don't rediscover them.

| # | Item | State |
|---|---|---|
| 1 | **Upgrading to Full doesn't restore locked vessels** | Known billing-correctness bug, queued as the next task. An owner who pays for Full still has to choose active vessels in manage-fleet |
| 2 | **Transfer buyer with no subscription** | Product decision open. A buyer who receives a vessel by transfer gets an active vessel and full Basic management without subscribing, indefinitely |
| 3 | **Stored tier disagreeing with Stripe** | Needs a scheduled reconciliation job. The app has **no scheduled jobs**: every dormancy check runs lazily on page loads and `/admin`. Recorded in the dormant identity spec §8 |
| 4 | **Unpaid vessel expiry** | Deferred. Abandoned signups hold a badge identity until reclaimed by the owner or an admin; an age-based sweep needs the same missing scheduler |
| 5 | **Payment records can still be deleted explicitly** | Vessel deletes can no longer cascade to them (`20261001`), but a direct `DELETE FROM vessel_payments` isn't blocked. Making the tables append-only is an open decision |
| 6 | **App copy promises email reminders** | `dashboard/upgrade/UpgradeForm.tsx` lists "Email reminders before insurance/registration lapse" as a Full Access feature, and `dashboard/[mxeId]/payment/PaymentForm.tsx` offers "email reminders across your whole fleet". The expiry-reminder email has a template and **no sender**. This breaks the copy rule in CLAUDE.md |
| 7 | **Stripe `unpaid` recovery reads as a resubscription** | Notified in-app instead of by email. Recorded in the dormant identity spec §8 |
| 8 | **Live Stripe keys** | Everything runs in Stripe test mode. Switching to live is the last step before real customers |
| 9 | **Native app** | Deferred; the PWA covers it for now |
| 10 | **Basic → Full upgrade (`/dashboard/upgrade`) predates the checkout conventions** | `upgradeToFullAccess` swaps the subscription to the Full price and creates the proration invoice's PaymentIntent when the owner asks to *see* the total, before any payment. Its payment methods follow the subscription's `payment_settings`, unset on every subscription that exists today. The plan picker on the same page was brought in line on 2026-09-14. See the roadmap for the unpaid-Full risk |

**Migration state, checked read-only against the live database on 2026-09-14:** `20260929`, `20260930`, `20261002` and `20261003` have been run — each one's changed function or column is visible live. `20261001` (payment and history foreign keys to `ON DELETE RESTRICT`) **can't be confirmed** that way, because foreign-key rules aren't visible through PostgREST; check it in the SQL editor with `select conname, confdeltype from pg_constraint where conrelid = 'vessel_payments'::regclass and contype = 'f';` (`r` = RESTRICT, `c` = CASCADE). Anything after `20261003` postdates this document.
