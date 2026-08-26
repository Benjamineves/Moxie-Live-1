# Moxie Digital — Master Build Spec

**This is the single source of truth for the build.** If anything in another document contradicts this file, this file wins.

**Version:** Consolidated, August 2026. Everything named `moxie_digital_*` is current. Anything with an older name (`moxie_technical_handoff_v1.html`, `moxie_seed.sql`, `moxie_acceptance_tests.md`, `moxie_seed_data.json`, `moxie_patch_*.md`, `moxie_strategy_brief_v4_final.docx`, or any HTML file without the `moxie_digital_` prefix) is superseded — do not build from it.

**Supersedes:** `moxie_technical_handoff_v1.html` (June 2025) for build priority and scope, plus both standalone patch documents, which have now been applied directly to the HTML design files and are no longer needed as separate instructions (see §13). The v1 data model, design tokens, and role-visibility map remain valid and are folded in below.

**Purpose:** Ben is not able to sell into marinas/brokerages/partnerships day-to-day right now. The only thing that matters for this build is: a stranger hears about Moxie, goes to the site, and comes out the other end with a paid account, a working QR code, and a vinyl sticker on the way — with zero manual steps from Ben in between.

---

## 0. Scope change from v1

**Paused, not deleted:**
- Marina operator role — no marina auth, no marina dashboard, no marina-facing render. The `marina` field-visibility tier and `marina_id` schema stay in the data model (already designed, cheap to keep), but nothing gets built against them this phase.
- Coast Guard role — same treatment. Schema stays, nothing built.
- Everything from the workstream dashboard other than the core funnel (brokerage-as-customer, title/escrow, charter fleet distribution, craft beer/brand partnerships, dock box).

**In scope, v1 build:** Public role (unauthenticated scan) and Owner role (authenticated) only.

**New in this version, didn't exist in any prior spec:** payment. Nothing in v1 — the tech handoff, the intake form, the owner profile — has a checkout step. This is now the most load-bearing new piece of the build.

**Folded in:** the `storage_type` / `storage_description` fields from this spec §13 (patch now applied to the HTML files) are merged into the canonical schema below (§3). That patch is no longer a separate document — treat this spec as the current baseline.

---

## 1. The funnel

This is the order Claude Code should build and think in. Everything else is secondary to this path working end-to-end.

1. Visitor lands on the marketing site.
2. Creates an account.
3. Fills out vessel intake — vessel data, document uploads. Photo upload is offered but **optional** — never blocks account creation or payment (see §4a).
4. System assigns an `MXE-XXXXX` ID and generates a digital QR code image tied to that vessel.
5. Payment — two separate moments, detailed in §4:
   a. **One-time setup fee** — small, decoy-priced. Unlocks: QR download, sticker-order eligibility, basic tier (limited docs, 1 photo).
   b. **Recurring subscription** — unlocks the full-featured app (unlimited docs, more photos, whatever the engagement/reminder features end up being). Priced so the setup fee looks like the obvious cheap-and-limited option next to it.
6. Vinyl sticker order is created and queued for fulfillment; owner can also download/print the QR themselves immediately once 5a clears.

**✅ Confirmed — QR generation timing.** MXE ID and QR image are generated as soon as intake (step 3) completes — inactive until payment clears. This is what §5's `qr_status` gate implements: generation is a POST-intake action, activation is a payment-webhook action.

---

## 2. UI inventory — all files present and current

Every design file needed for this build now exists, is brand-compliant, and has all patches applied. Nothing is missing.

| File | Status | Role in the funnel |
|---|---|---|
| `moxie_digital_homepage.html` | Current | Entry point — marketing site. Primary CTA should push account creation over waitlist |
| `moxie_digital_auth_login.html` | **New** | Magic-link sign-in for returning owners. Did not exist in any prior version |
| `moxie_digital_intake_form.html` | **Patched** | 4-step registration. Storage-type pills, optional photo upload, and payment redirect all applied |
| `moxie_digital_payment_checkout.html` | **New** | Two-tier checkout with Stripe Payment Element mount. Did not exist in any prior version |
| `moxie_digital_profile_owner.html` | **Patched** | Owner dashboard. Account & Billing sheet + "Add a photo" nudge applied |
| `moxie_digital_profile_all_roles.html` | Current | Public + Owner renders (ignore Marina/CG renders this phase) |
| `moxie_digital_scan_success.html` | Current | Scan-confirmation animation |
| `moxie_digital_qr_roles.html` | Current | Role explainer — low priority, not on the critical path |

**Note on approach:** these HTML files are design references, not the final application. Claude Code should port them into the Next.js component structure, preserving the exact markup, CSS variables, and interaction behavior. They are not meant to be served as static files in production.

---

## 3. Data model — merged storage_type + payment additions

```sql
-- vessels table (v1 base + storage_type patch + payment gating fields)
vessels {
  -- ...all existing v1 fields unchanged (mxe_id, owner_id, vessel_name, make, model, etc.)...

  -- From storage_type patch (unchanged, now baseline):
  storage_type          text DEFAULT 'marina',  -- 'marina' | 'trailer' | 'home' | 'yard' | 'mooring' | 'other'
  storage_description   text,                    -- e.g. "Trailer at home, Walnut Creek CA"

  -- New — payment/QR gating:
  qr_status             text DEFAULT 'pending_payment', -- 'pending_payment' | 'active'
  qr_generated_at        timestamp,
  sticker_order_status   text DEFAULT 'not_ordered'      -- 'not_ordered' | 'ordered' | 'printed' | 'shipped'
}

-- users table (v1 base + Stripe identity)
users {
  -- ...all existing v1 fields unchanged...

  stripe_customer_id     text,
  subscription_status    text DEFAULT 'none',   -- 'none' | 'active' | 'past_due' | 'canceled'
  subscription_tier      text DEFAULT 'basic'   -- 'basic' | 'full'
}

-- new table
vessel_payments {
  id                      uuid PRIMARY KEY
  vessel_id               uuid REFERENCES vessels(id)
  payment_type            text,   -- 'setup_fee' | 'subscription'
  stripe_payment_intent_id text,
  amount_cents            integer,
  status                  text,   -- 'pending' | 'paid' | 'failed' | 'refunded'
  paid_at                 timestamp
}
```

---

## 4. Payment & identity capture

**Recommended: Stripe** (Checkout or Payment Element) for both the one-time setup fee and the recurring subscription. Reasoning:
- Handles PCI compliance — Moxie's backend never touches raw card data.
- Natively supports both a one-time charge and a subscription in the same customer object.
- Stripe Checkout collects name and billing address as part of the payment flow itself. This is what your brother was pointing at — you get verified name/address at the payment step for free, without building separate identity-verification UI. The Stripe Customer object becomes the canonical source for that data; `users.stripe_customer_id` references it rather than Moxie re-collecting and duplicating name/address fields elsewhere.

**Gating logic:**
```
On vessel_payments row inserted with payment_type='setup_fee' AND status='paid':
  → set vessels.qr_status = 'active'
  → set vessels.qr_generated_at = now()
  → QR download becomes available, public profile URL goes live
  → This is PERMANENT once set. Nothing downstream ever flips qr_status back.

On users row: subscription_status changes to 'active' (via Stripe webhook)
  → set users.subscription_tier = 'full'
  → unlocks full doc/photo limits and engagement features across all
    vessels owned by that user

On users row: subscription_status changes to 'past_due' or 'canceled'
  (via Stripe webhook, after Stripe's own dunning/retry cycle completes —
  don't downgrade on the first missed payment, only once Stripe's retries
  are exhausted and the subscription actually lapses)
  → set users.subscription_tier = 'basic'
  → does NOT touch vessels.qr_status — sticker and public profile stay live
  → account, login, and all previously-stored data remain fully intact —
    this is a feature-depth downgrade, not an account suspension
```

**✅ Confirmed — the sticker/public profile never deactivates**, even if the subscription lapses. Once `qr_status='active'`, it's permanent. Confirmed approach: rather than treating a lapsed subscription as "losing the product," treat it as **automatic downgrade to the Basic tier** — same account, same login, same stored documents, just back to Basic's feature ceiling until they resubscribe. This matches the stated principle: whether Basic or Full, the goal is the same account staying in use, not losing the person entirely. Re-upgrading should be a single action from the Account & Billing panel (§5 of the UI patch) — reactivate the Stripe subscription, no re-onboarding.

**Billing cadence:** Annual subscription, billed as one annual charge, **displayed to the user as a monthly-equivalent price** (exactly as shown on the payment page: "$[X]/mo · billed annually"). In Stripe terms: create the Price object with a `yearly` interval and the full annual amount; the monthly figure shown in the UI is `annual_amount / 12`, a display-only calculation — Stripe still only ever charges once a year. Don't build a second, separate "true monthly" billing option unless that changes later.

---

## 4a. Photo upload — optional, never a signup blocker

**✅ Confirmed:** photo upload must not block account creation, intake completion, or payment. Concretely:
- The photo upload field in intake Step 3 (see UI patch §1) is optional — a "Skip for now" affordance, not a required field, and doesn't gate the "Continue to Payment" button.
- `vessels.photo_url` stays nullable indefinitely. A vessel can reach `qr_status='active'` with no photo at all — the profile hero just renders the existing decorative navy/gold background (already the default treatment per the brand guide's vessel profile mockup) instead of a real photo.
- Since photo upload is deferred rather than eliminated, it doubles as a natural re-engagement hook: an owner with no `photo_url` set is exactly the kind of thing worth surfacing as a prompt inside the owner dashboard after activation (see UI patch, new §7 — "Add a photo" nudge). This serves the "keep them checking the app" goal directly — it's a small, low-friction reason to open the app again post-signup, not just a missing-field warning.

---

## 5. QR generation & activation

```
function onIntakeFormSubmit(vesselData):
  vessel = db.vessels.create(vesselData)  # includes storage_type from the form
  vessel.mxe_id = generateNextMxeId()
  vessel.qr_status = 'pending_payment'
  # QR image can be generated here (inactive) or deferred to payment webhook —
  # see the open decision in §1.
  return vessel

function onPaymentWebhookSucceeded(vesselId, paymentType):
  if paymentType == 'setup_fee':
    vessel = db.vessels.find(vesselId)
    vessel.qr_status = 'active'
    vessel.qr_generated_at = now()
    # QR now resolves publicly at moxieyacht.com/MXE-XXXXX
```

---

## 6. Sticker fulfillment (minimal for v1)

No carrier integration needed yet. A simple internal, admin-visible view is enough:

```
SELECT * FROM vessels
WHERE qr_status = 'active' AND sticker_order_status = 'not_ordered'
```

Ben manually manages print/ship from this list for now. Automate later once volume justifies it.

---

## 7. Explicitly out of scope for this build

- Marina operator role, auth, and dashboard
- Coast Guard role and auth
- Brokerage-as-customer, title/escrow, charter fleet distribution, craft beer/brand partnerships, dock box/marina enterprise — all paused per current strategy, not touched by this spec

---

## 8. Revised build priority

| Priority | Milestone | Notes |
|---|---|---|
| P0-A | Public profile render | Already spec'd in v1, no changes needed |
| P0-B | Account creation + vessel intake | Adapt existing intake form UI; add `storage_type` field per patch spec |
| P0-C | **Payment integration (Stripe)** | New — does not exist in any prior file. Critical path. |
| P0-D | QR generation + payment gating | Per §5 |
| P0-E | Owner dashboard | Adapt existing owner profile UI; this is also where the "keep checking the app" engagement surface lives (doc status, expiry reminders, promos) |
| P1 | Sticker fulfillment queue | Internal-only, simple list view |
| Deferred | Marina role, CG role, everything else | Not this phase |

---

## 9. Pre-build checklist — accounts & decisions Claude Code needs before it can start

Two different kinds of "missing" here. Some of this is Claude Code writing code against a placeholder and swapping it later — not a real blocker. Some of it is an actual account or credential that has to exist before certain pieces can even be written, let alone run. Sorted accordingly.

### A. Accounts/access — can't build against these until they exist

1. ~~Domain(s)~~ — **Resolved.** `moxie.sh` was never acquired. **`moxieyacht.com`** is the confirmed short domain for QR/scan URLs; **`moxieyachting.com`** is the confirmed primary/marketing domain (already owned, already in use for founder emails). Every scan URL in the schema, seed data, and acceptance tests has been updated accordingly — see `moxie_digital_schema.sql` and `moxie_digital_schema.sql`.
2. ~~Stripe account~~ — **Resolved for now.** No live Stripe account exists yet. Build and test everything against **Stripe test mode** (test-mode keys are free and instant to generate without the business/identity verification a live account needs). Wire the real live keys in as the very last step before actual launch — nothing in the code should need to change structurally when that swap happens, just the environment variables.
3. ~~Hosting/database~~ — **Resolved.** Next.js + Supabase + Vercel confirmed. Ben's brother will finalize the actual account/project setup.
4. **File storage** — following from #3, Supabase Storage (bundled in) rather than a separate S3 account. `moxie_digital_schema.sql` and `moxie_digital_schema.sql` already assume Supabase Storage paths.
5. **Transactional email** — auth no longer depends on this (B7: email+password stays for launch, magic link deferred). Still needed for Full-tier expiry reminder emails (§9-B8) and payment receipts, just not on the critical path for P0-E anymore. Still no provider chosen — Postmark, Resend, and SendGrid all remain reasonable options.

None of these are things Claude Code should create on your behalf unprompted — Stripe in particular requires real business/identity information to stand up even a test-mode account. These need to exist, or you need to explicitly hand off credentials, before that specific piece of the build can move past placeholder code.

### B. Quick decisions — fast to answer, but they shape specific code

6. ~~MXE ID format~~ — **Not actually resolved, flagging the discrepancy.** You mentioned this was decided as randomized previously — but every artifact reviewed so far says otherwise: the v1 handoff listed it as an open question, `moxie_seed.sql`'s own column comment says `-- MXE-00001 format (or future random)`, and the seed data's `qr_tokens` notes explicitly flag it as "TBD." If you find the original doc that settled this, it overrides everything below — but absent that, the honest state is "still open." Recommend randomized 6-character (avoids someone guessing `MXE-00003` exists and probing it before it's registered) if no other document surfaces.
7. ~~Auth method~~ — **Resolved: keeping email+password for launch.** Deliberate deferral, not an oversight — the existing email+password flow (Supabase auth) already works and ships the funnel faster; reworking to magic link is real effort (new endpoint, transactional email dependency, session/token handling changes) that doesn't block getting a stranger from scan to paid account. Magic link stays a good idea and is revisitable post-launch, once a transactional email provider is picked for other reasons (e.g. Full-tier expiry reminders, §9-B8) — at that point the swap is auth-layer only, nothing else in the schema or UI depends on which method is used.
8. ~~Reminders tier question~~ — **Resolved:** Basic tier keeps reminders, but as **in-app only** (the existing doc-status-dot green/amber/red indicators — no new UI needed, this already exists). Full tier gets the same in-app indicators **plus** proactive email reminders before something expires. This is a clean split that reuses what's already built for Basic and reserves the "reach them outside the app" channel for Full — updated throughout the spec and the acceptance tests.

### C. Not blocking, but needed before real launch

9. **Exact pricing.** Already flagged — placeholders are fine for Claude Code to build against, but Stripe Products need real numbers before the checkout page can process a real charge.
10. **Sticker fulfillment vendor.** Real-world logistics, not code — the spec assumes you're manually managing print/ship from the internal queue (§6), but that assumes a print vendor relationship exists. Not something Claude Code needs to know about, just worth having lined up by the time the first vessel activates for real.

---

## 10. New source files (this round) — what's real, what needed correcting, what's flagged

Four files came in this round. Three are now merged into an updated, runnable foundation. One is a genuine scope question that isn't resolved by anything above.

**Merged and corrected — use these going forward:**
- `moxie_digital_schema.sql` — real, runnable Postgres schema + seed data (supersedes `moxie_seed.sql`). Added storage_type, qr_status/payment gating fields, `vessel_payments` table, corrected domain throughout.
- `moxie_digital_schema.sql` — same corrections applied to the JSON companion (supersedes `moxie_seed_data.json`).
- `moxie_digital_acceptance_tests.md` — supersedes `moxie_acceptance_tests.md`. Added a full Payment/Stripe test section, marked Marina and Coast Guard sections deferred, corrected the intake-flow tests to match the actual v2 steps, corrected auth tests to magic-link, corrected domain throughout, and turned the MXE ID discrepancy into an explicit flagged test rather than silently picking one scheme.

**Not merged — needs your call first: `moxie_app.jsx`**

This one's a different animal from everything else reviewed so far. It's not a web page — it's a self-contained React prototype simulating a **native iOS app**: five-tab shell (Profile/Docs/Scan/Fleet/Account) with an iOS status bar, an in-app camera-based QR scanner (for scanning *other* boats' stickers, not just viewing your own), and an "AppDownloadSheet" component that prompts **"Download on the App Store."**

That last part matters. Everything we've built this entire conversation — the intake form, payment page, owner dashboard — is a responsive web app meant to run in a browser. A real "Download on the App Store" flow is a materially different engineering effort: native Swift/SwiftUI (or React Native, which is a different build than a Next.js web app) and an actual App Store submission and review process, not something that falls out of the current Next.js/Supabase/Vercel build as a byproduct.

I don't want to guess at the relationship between this and the current build, since guessing wrong wastes real effort either direction — building toward App Store distribution when you only meant this as a future-vision mockup, or ignoring it if you actually meant it as this phase's owner-dashboard direction instead of the HTML/web version we've been patching. Worth a direct answer before this goes anywhere near Claude Code:
- Is this a **future-phase concept** (post-launch, once there's real volume to justify a native app), unrelated to what Claude Code should build right now?
- Or does it represent a **direction change for the owner-facing side** — i.e., should Claude Code be building toward this native-feeling experience (likely as a PWA rather than literally an App Store submission) instead of continuing to extend `moxie_digital_profile_owner.html`?

Nothing else in this spec assumes either answer — the current build priority (§8) stays entirely web-based either way until you say otherwise.

---

## 11. Patent alignment & extensibility hooks

`moxie_provisional_patent_spec_v8_FINAL.pdf` — filed May 4, 2026, USPTO provisional under 35 U.S.C. §111(b), inventor Benjamin Eves. Reviewed against everything built so far.

### The good news: the core mechanism is already what we're building

Claim 1 of the patent — the independent claim everything else hangs off — describes exactly the architecture already in place: a single physical identifier resolving through server-side role detection to a field-visibility filter that renders different data subsets from one underlying vessel record, such that "an identical scan of the same machine-readable identifier by different users with different access roles results in different information views being rendered from the same underlying vessel data record." That's precisely what the v1 tech handoff's field-to-role visibility map already specifies, and what `moxie_digital_schema.sql`'s schema and role-tier structure already implement. Pausing Marina and Coast Guard for this build phase doesn't abandon that architecture — the filtering mechanism generalizes to all four roles by design, we're just not building the Marina/CG-specific auth and UI yet. Nothing about the payment pivot or the current build priority is in tension with the patent. Good to build with confidence on the current foundation.

### One factual note, not legal advice

The patent's "preferred embodiment" section repeatedly uses `moxie.sh` as the example domain (§[0015], §[0055], and others), consistent with what everyone believed at filing time. The claims themselves are written generically ("a short-form domain name," claim 12) rather than naming a specific domain, so this most likely doesn't affect claim scope or validity — but it's worth flagging to whoever's managing the filing, since you'd know better than I would whether a specification amendment or any other action is warranted. Nothing in the current build needs to reflect the patent's example domain either way — the code should just use the real one (`moxieyacht.com`), regardless of what string the patent's specification happens to use as an illustration.

### What the patent covers that the current build doesn't (and shouldn't, yet)

The patent's scope is considerably larger than the self-serve funnel we're building first. Rather than silently building toward all of it or silently ignoring it, here's the honest map:

| Patent feature | Current v2 build | Recommendation |
|---|---|---|
| Role-differentiated rendering (claim 1) | ✅ Built (2 of 4 roles active) | Already aligned, no action |
| Pre-provisioned identifiers / vessel stubs before an owner exists (claim 2, §[0033]–[0040]) | ❌ Not built — current flow always creates vessel + owner together via intake | Defer. This is a marina-bulk-deployment feature; doesn't matter until marina role reactivates |
| Claim eligibility controls — claim tokens, approval workflow, transaction-linked, designated claimant (claims 16–19, §[0041]–[0048]) | ❌ Not built | Defer, same reason as above — meaningless without pre-provisioning |
| Batch identifier generation for a whole marina (claim 10, §[0049]) | ❌ Not built | Defer — marina-admin feature, paused along with the marina role |
| Dual physical deployment — hull sticker + dock box sticker, same URL (claim 9, §[0052]) | ✅ **Already free** — needs zero schema or code change. Two stickers pointing at the same `mxe_id` just works with what's already spec'd. Worth remembering as a talking point (patent-protected, zero-cost feature) whenever marina conversations resume | No action needed now, but don't forget it exists |
| Portable/printable identifier formats — wallet card, laminated doc, PDF (claim 6, §[0053]) | ⚠️ Partially free — the existing `qr.pdf` endpoint (P1-B) already generates a printable format. Additional form factors (wallet card sizing, etc.) are just additional export templates against the same QR data, not new architecture | Low-cost future addition once P1-B ships — not needed for launch |
| Ownership transfer — data selection, transfer channels, atomic swap, ownership history chain, document archival, guided re-onboarding (claim 20, §[0056]–[0069]) | ❌ Not built — this is the single largest feature area in the entire patent and isn't represented anywhere in the current schema, spec, or acceptance tests | **Defer as a real, separate build phase.** This is not a small addition — it touches the schema (ownership history table, document archival-with-attribution), the UI (seller-side data-selection flow, buyer-side acceptance flow), and business process (which channel — direct/escrow/broker — actually gets used first). Worth its own spec pass when it's actually prioritized, not bolted onto the payment funnel build |

### Recommended schema hooks — cheap now, expensive to retrofit later

Two additions worth making even though the features themselves are deferred, because adding them now is nearly free and adding them after real data exists is not:

```sql
-- On vessels — supports future pre-provisioning/claim flow without building it now.
-- Every vessel created through the current intake flow sets this to 'claimed'
-- immediately (owner exists at creation time), so this has zero effect on the
-- current build — it only matters once pre-provisioned stubs exist.
ALTER TABLE vessels ADD COLUMN claim_status TEXT DEFAULT 'claimed'; -- 'unclaimed' | 'claimed'

-- New table — not populated by anything in the current build, but having the
-- table exist means a future ownership-transfer feature append-only-inserts
-- into it rather than needing a schema migration alongside that feature's launch.
CREATE TABLE IF NOT EXISTS ownership_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id         UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  owner_name        TEXT NOT NULL,      -- denormalized, per patent §[0067]
  ownership_start   DATE NOT NULL,
  ownership_end     DATE,               -- NULL for current owner
  transfer_type     TEXT,               -- 'initial_claim' | 'private_sale' | 'escrow_sale' | 'broker_sale' | 'gift' | 'estate' | 'other'
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
```

Not added to `moxie_digital_schema.sql` directly — intentionally, to keep the current schema lean and avoid unused columns cluttering the file Claude Code is building against right now. This is the exact migration to run when ownership transfer actually gets prioritized. Everything else in the table above (batch provisioning, claim tokens, dual deployment, portable formats) needs no schema changes at all until it's actually being built — genuinely free to defer.

---

## 12. Boater card — tier-exempt, always available regardless of Basic/Full

Resolved: `vessel_documents` rows where `doc_type='boater_card'` are exempt from the tier document-count limit entirely — available to upload/store in both Basic and Full, not gated behind an upgrade. This is a business-logic rule enforced in the document-count check, not a schema change.

**Why:** the CA Boater Card became mandatory for all motorized-vessel operators regardless of age as of January 1, 2025, doesn't expire once issued (unlike insurance/registration), and is exactly the kind of "need it right now" item that drives someone to actually open the app — a more immediate trigger than a scheduled expiry reminder. Giving it away in Basic doesn't touch Full's actual differentiation (breadth of other documents, email reminders, priority production).

**Role-visibility is unaffected** — the boater card was already correctly grouped under the general "compliance documents" category in the field-visibility map (Public: no, Owner: yes, Marina/CG: yes once reactivated). Nothing to change there.

**UI update needed:** the payment page's Basic tier copy ("1 document on file") should be updated to make the exemption explicit rather than implying the boater card competes for that one slot — see `moxie_digital_payment_checkout.html`, updated.

**Future, low-cost, orthogonal feature:** Apple Wallet **Pass** (not the November 2025 "Digital ID" feature, which is locked to passport/state-driver's-license credentials and can't host a third-party document). Passes are addable straight from a web page, no native app required — a cheap future addition to the owner dashboard ("Add Boater Card to Apple Wallet") that doesn't depend on resolving the native-app-vs-PWA question in `moxie_digital_app_future_reference.md` at all. Not built now, worth not forgetting.

---

## 13. Patch status — what's already applied to the HTML files

Both former standalone patch documents have been **applied directly** to the design files. They are retired as separate documents; this section is the record of what changed, so nothing is lost and nobody re-applies a patch twice.

**Applied to `moxie_digital_intake_form.html`:**
- Step 2 header changed from "Where is she docked?" → "Where does she live?"
- Storage-type pill selector added (marina / mooring / trailer / home / yard) with `setStorageType()` toggle logic, `#marina-fields` and `#non-marina-fields` conditional containers, `storage_description` text field, and `.storage-pill` CSS
- `updatePreview()` extended to render storage type correctly for non-marina vessels
- Optional vessel photo upload added to Step 3 (`#uz-photo`), explicitly marked optional and non-blocking
- Boater card upload caption updated to note it's included on every plan and never counts against the document limit
- Final submit button changed from `showCompletion()` → `submitIntakeAndGoToPayment()`, which redirects to the payment page. `showCompletion()` still exists and is unchanged — it is now reached only after payment succeeds

**Applied to `moxie_digital_profile_owner.html`:**
- Account nav tab wired to `openAccountPanel()` (was a dead link)
- Account & Billing bottom sheet added, reusing the existing Fleet panel pattern — tier, renewal state, payment history, Manage Billing CTA
- "Add a photo" nudge added, shown on the Polaris tab (no `photo_url` in seed data), correctly absent on Discovery One (has a photo)
- `openPhotoUpload()` stub added

**Nothing further to apply.** Claude Code should treat all `moxie_digital_*.html` files as the current, correct design reference.

---

## 14. API endpoints the UI depends on

Consolidated from the retired patch doc, so every endpoint the front-end calls is listed in one place.

| Endpoint | Purpose | Notes |
|---|---|---|
| `POST /api/auth/signup` / `POST /api/auth/login` | Email+password sign-up/sign-in | Per §9-B7: email+password stays for launch, handled via Supabase auth session/JWT — no separate magic-link endpoint this phase |
| `GET /api/vessels/:mxeId?role=public` | Public profile render | Must return "not yet active" for `qr_status='pending_payment'` |
| `GET /api/vessels/:mxeId?role=owner` | Owner profile render | Requires JWT; 403 if JWT belongs to a different user |
| `GET /api/vessels/:mxeId/preview` | Scan animation data | 5 public fields only, no auth required |
| `POST /api/vessels` | Create vessel from intake | Accepts `storage_type`, optional photo; sets `qr_status='pending_payment'`; returns `mxe_id` for the payment redirect |
| `PATCH /api/vessels/:mxeId` | Owner edits | Owner JWT only |
| `POST /api/vessels/:mxeId/documents` | Document + photo upload | `doc_type='vessel_photo'` must also set `vessels.photo_url`, not just create a drawer entry. `doc_type='boater_card'` is exempt from tier document limits (§12) |
| `GET /api/vessels/:mxeId/documents/:docId` | Signed URL for a document | 15-min TTL; role-gated |
| `GET /api/vessels/:mxeId/qr.pdf` | Printable sticker PDF | Owner JWT; **must error** if `qr_status='pending_payment'` — this is where the payment gate is actually enforced |
| `GET /api/users/:userId/fleet` | My Fleet list | Owner JWT |
| `GET /api/users/:userId/billing` | Account & Billing panel data | Tier, renewal date, payment history |
| `POST /api/waitlist` | Marketing site email capture | Rate-limited, idempotent |
| **Stripe webhook receiver** | Payment + subscription events | Must verify Stripe's signature before trusting any payload. Handles: setup_fee paid → `qr_status='active'`; subscription active → `subscription_tier='full'`; subscription `past_due`/`canceled` after dunning → `subscription_tier='basic'` **without** touching `qr_status` |

---

## 15. QR code generation spec

Supabase stores the generated image; it does not generate it. Generation is a standard QR library call, then image composition for the printable sticker.

**QR encoding:**
- Encoded URL format: `moxieyacht.com/{MXE_ID}?scan=1`
- Error correction: **Level H** (~30% damage tolerance — non-negotiable for the marine environment)
- Dark cell color: `#071020` (navy-deep)
- Light cells: transparent (sticker background shows through)
- One aqua module at bottom-right: `#17C3B2` — mirrors the Pixel M's signal pixel. Subtle enough not to disrupt scan integrity

**Printable sticker composition:**
- Size: 3" × 3" minimum, 600 DPI minimum
- Substrate (for the print vendor, not the code): 3M IJ180Cv3 with 8518 gloss overlaminate
- Corner radius: 10–14px
- Wordmark "Moxie" in Cormorant Garamond italic above the QR grid
- Caption below: "REGISTERED VESSEL" + `SCAN · MXE-XXXXX` in DM Sans Medium, uppercase
- Gold rule `#C9A84C` at 0.4pt divides QR from caption
- All branded elements must sit **outside the QR quiet zone**

**Colorways:** Navy+Gold (`bg #0d1f35`, `cells #c9a84c`) is primary for hull stickers. White+Navy for print/light surfaces. Gold+Navy for premium.

---

## 16. Supabase Storage bucket structure

Create these before running the schema seed.

| Bucket | Access | Paths |
|---|---|---|
| `vessels` | **Public-read** (hero photos are public profile content) | `vessels/mxe-00001/hero.jpg`, `vessels/mxe-00001/gallery/` |
| `documents` | **Private** — signed URLs only, 15-minute expiry | `documents/mxe-00001/` |

The distinction matters: vessel photos appear on the public profile and should load without auth. Compliance documents must never be publicly reachable, even by direct URL.

---

## 17. Design tokens (for backend-generated content)

Full token set lives in the brand guide and in every HTML file's `:root` block. This subset is what backend-generated artifacts (QR PDFs, transactional emails, OG images) need:

```
navy         #0d1f35     navy2        #132943
navy-deep    #071020     gold         #c9a84c
gold-lt      #dfc06a     cream        #f5f2ec
aqua-bright  #17C3B2     aqua-lagoon  #1FA394

Headings: Cormorant Garamond (serif, italic for display/vessel names)
Body:     DM Sans (300/400/500)
```
