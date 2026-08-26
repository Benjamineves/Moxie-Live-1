# Moxie Digital — START HERE

**Read this first. It tells you what to put in the build folder and what to leave out.**

Simple rule: **if the filename starts with `moxie_digital_`, it's current. If it doesn't, it's superseded — don't upload it.**

---

## Part 1 — Files that GO IN the build folder

Eleven files. That's the whole set.

### Specs and data (4 files)

| File | What it is |
|---|---|
| `moxie_digital_build_spec.md` | **The master document.** Scope, data model, payment logic, API endpoints, QR spec, build priority, open questions. If anything contradicts this, this wins. |
| `moxie_digital_schema.sql` | Runnable Postgres schema + seed data for both real vessels. Run this against Supabase. |
| `moxie_digital_acceptance_tests.md` | Definition of "done" for each milestone. Use this to check work. |
| `Moxie___Brand_Guide__Complete__v1.pdf` | Brand reference. Optional — token values are already in every HTML file — but useful. |

### Design files (7 files)

| File | What it is |
|---|---|
| `moxie_digital_homepage.html` | Marketing site / funnel entry point |
| `moxie_digital_auth_login.html` | Magic-link sign-in (new) |
| `moxie_digital_intake_form.html` | 4-step vessel registration (patched) |
| `moxie_digital_payment_checkout.html` | Two-tier Stripe checkout (new) |
| `moxie_digital_profile_owner.html` | Owner dashboard (patched) |
| `moxie_digital_profile_all_roles.html` | Public + role-gated profile renders |
| `moxie_digital_scan_success.html` | QR scan confirmation animation |
| `moxie_digital_qr_roles.html` | Role explainer page (low priority) |

---

## Part 2 — Files that DO NOT go in the build folder

Uploading these is the most likely way to get a confused or inconsistent build, because Claude Code would see two contradicting versions of the same thing.

**Superseded — replaced by a `moxie_digital_` file:**
- `moxie_technical_handoff_v1.html` → replaced by `moxie_digital_build_spec.md`
- `moxie_seed.sql` and `moxie_seed_data.json` → replaced by `moxie_digital_schema.sql`
- `moxie_acceptance_tests.md` → replaced by `moxie_digital_acceptance_tests.md`
- `moxie_seed_v2.sql`, `moxie_seed_data_v2.json`, `moxie_acceptance_tests_v2.md`, `moxie_technical_spec_v2_selfserve_funnel.md` → the intermediate versions, all now renamed
- `moxie_vessel_intake_form.html`, `moxie_vessel_profile_owner.html`, `moxie_homepage_v2.html`, `moxie_vessel_profile_all_roles.html`, `moxie_scan_success.html`, `moxie_qr_roles.html`, `moxie_payment_checkout.html`, `moxie_auth_login.html`, and the `_v2` HTML files → all renamed with the `moxie_digital_` prefix
- `moxie_tech_brief.docx` → superseded by the build spec

**Already applied — nothing left to do with them:**
- `moxie_patch_storage_type.md`
- `moxie_patch_v2_payment_photo_billing.md`

Both are now baked into the HTML files. The record of what they changed is in `moxie_digital_build_spec.md` §13. Re-applying them would double-patch the files.

**Not build-relevant (keep them, just not in this folder):**
- `moxie_digital_app_future_reference.md` — for whenever the app gets prioritized
- `moxie_provisional_patent_spec_v8_FINAL.pdf` — legal record; its alignment with the build is summarized in build spec §11
- `moxie_strategy_brief_v4_final.docx` — business strategy, predates the pivot
- `moxie_app.jsx` — app prototype, deferred
- `moxie_marina_onepager_1.pdf`, `captain_newsletter_extraction.md`, `moxie_workstream_dashboard.html` — marketing/ops, not build inputs

---

## Part 3 — The sequence

1. **Get your brother's project folder onto your machine** (local, not over VPN).
2. **Open that folder in Claude Code** — this becomes the only project folder. Don't create a second one.
3. **First task — git baseline.** Ask Claude Code to initialize git (if needed) and commit the current state as-is, before changing anything. Five minutes, and from then on every change is tracked and reversible.
4. **Second task — inventory.** Ask what's actually built, what the stack is, and how much of the folder is real source vs. dependencies.
5. **Third task — gap check.** Ask it to compare what exists against `moxie_digital_build_spec.md` and flag: what matches, what was built on stale assumptions (old domain, no payment, no storage_type, marina-first priority), and what's missing.
6. **Then build**, milestone by milestone, per the build priority table in the spec (§8).

### The first build prompt, once the gap check is done

> Read `moxie_digital_build_spec.md` fully before doing anything else — it's the source of truth for scope, data model, and priority order. Then read `moxie_digital_acceptance_tests.md` for P0-A and P0-B specifically. Build just those two milestones: the static public vessel profile page, and the scan-success animation → redirect. Use `moxie_digital_profile_all_roles.html` (public render only) and `moxie_digital_scan_success.html` as the exact design reference, and `moxie_digital_schema.sql` for the data model. Use the seeded Discovery One vessel (MXE-00001) as the test case. Don't start on payment, intake, or anything else yet — stop and show me when P0-A and P0-B pass their acceptance tests.

---

## Part 4 — Still open (won't block starting)

| # | Item | Status |
|---|---|---|
| 1 | **Pricing** — setup fee + subscription amounts | Placeholders in the checkout page. Needed before real charges, not before building |
| 2 | **MXE ID format** — sequential vs. randomized | Every existing document says sequential/TBD. If you find the doc that decided randomized, it overrides. See build spec §9-B6 |
| 3 | **Transactional email provider** — Postmark / Resend / SendGrid | Needed for magic-link login. Pick one before P0-E |
| 4 | **Stripe account** | Test mode is enough to build against; live keys are the last step before launch |
| 5 | **Domain DNS** — `moxieyacht.com` (QR/short) + `moxieyachting.com` (marketing) | Both owned. Wiring needed before a live deploy |
| 6 | **Native app vs. PWA** | Deferred entirely — see `moxie_digital_app_future_reference.md` |
