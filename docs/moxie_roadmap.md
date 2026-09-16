# Moxie — roadmap

Open items and what depends on what. Update as items close; add what
turns up. Where this disagrees with the code, the code wins.

_Last updated 15 September 2026_

---

## Tier 1 — Blocks taking money at all

### Vercel Pro upgrade
**Done** (live by 2026-09-15). Cron is available; see the scheduler spec.

### Stripe live keys
**Blocks:** real payments, first customer
**Depends on:** pricing decided
Test mode today. Switching means live keys in Vercel and re-pointing the
webhook at the apex.

### Pricing numbers
**Blocks:** Stripe live, FAQ content, upgrade CTAs
Basic setup fee, Full annual price, transfer fee. Also settles the
document-limit question below.

---

## Tier 2 — Blocks shipping a physical product

### Select a badge supplier
**Blocks:** print exporter (§5.3), first print run, everything physical
**Needs from them:** sheet size, bleed, crop marks vs. die-line
Enquiry out to a local vendor. The exporter is deliberately unbuilt until
those three values exist; N-up, sheet size and bleed are already config.

### First print run — batch 1
**Depends on:** supplier, exporter
100 identities, 200 badges. Confirm the badge scans cleanly at 3 inches
before committing to the full run.

### Badge replacement process
Doesn't exist. Damaged or lost badge has no defined path. Blocks one FAQ
question.

### Two-badge mailer packaging
**Depends on:** badges in hand

---

## Tier 3 — Unblocked once Tier 1 lands

### Scheduler (tier reconciliation, transfer window, dormancy, reminders)
**Phase 1 built: report-only** (2026-09-15; spec §13). Migration `20261004`
**is run** (confirmed by reading the four tables and the two new `users`
columns), and `90806ee6…`'s tier drift **is corrected** (see Done). What's
left before the first scheduled run: **set `CRON_SECRET` in Vercel
Production** — without it the route refuses to run — then set up the uptime
monitor after the first run. Then a week of digests, and switch steps on one
at a time. **Spec:**
`docs/moxie_digital_scheduler_spec.md`. Decisions recorded 2026-09-15 in
its §12: 30-day transfer window, reminders Full-only at 30/7/0 days,
per-owner opt-out, proportional circuit breaker, external uptime monitor.
One daily cron route running a per-account pipeline: tier reconciliation →
transfer-buyer window → dormancy → expiry reminders. Replaces the
page-load dormancy calls (including a stranger's badge scan) and closes
the transfer-buyer and stored-tier items below once built.

### DMARC tightening
**Depends on:** a few weeks of consistent sending
Currently `p=none`. Moving to `quarantine` makes spoofing harder.

---

## Correctness — open

### App copy promises email reminders that nothing sends
The Full plan list and badge checkout both mention email reminders. The
template exists; nothing sends it. Direct violation of the standing copy
rule. Either remove the claims or wait for the scheduler.

### Abandoned Basic → Full upgrades: Stripe on Full, app on Basic
**The gap.** Until `2026-09-15`'s checkout conversion deploys, the live
upgrade swaps the subscription to the Full price when the owner clicks
"See my upgrade total". An owner who then walks away is left **on the
Full price in Stripe while the app shows Basic** (the webhook no longer
writes Full from the price, since `924b294`). Their next renewal charges
the Full price — plus the proration items the swap left pending — for a
plan they declined. Before `924b294` the same click granted Full outright.

**Closed for new clicks** by the conversion (see Done): the subscription
is not touched until the upgrade invoice is paid.

**Anyone already in it stays in it** — the conversion doesn't undo a swap.
Checked read-only on 2026-09-15: no account is (the one Basic account,
`0a5267af…`, is on the Basic price in Stripe; no open or abandoned upgrade
invoices anywhere). If one appears from the window before deploy, the sign
is `users.subscription_tier = 'basic'` with the live subscription's item on
`STRIPE_PRICE_ID_FULL`. Fixing one is a Stripe write: swap the item back
with `proration_behavior: "none"` and delete its pending proration items —
ask first.

**Existing data, not this gap:** `90806ee6…` (`sub_1UBJeT…`) was Full in
both Stripe and the app, having paid only for Basic, with two pending
proration items (net $89.99) queued for its 2027-09-02 renewal.
**Corrected 2026-09-15** — see Done. No account is in this state now.

### Upgrading to Full doesn't restore locked vessels
`clear_vessels_lapsed` only restores `dormant_cause = 'lapsed'`. An owner
who pays for Full keeps cap-locked vessels until they find manage-fleet.
Billing correctness, not notifications.

### Transfer buyer never has to subscribe
Neither acceptance nor completion checks subscription status, and lapse
logic only runs on Stripe events a never-subscribed account never gets.
A seller can pay a transfer fee and hand someone indefinite free service.
**Decided 2026-09-15:** a 30-day window, enforced by the scheduler
(spec §3.2); revisit with real data. Live example: `b6cac9fa…` holds
`MXE-01024` with no plan.

### Document limit can never trigger
`BASIC_DOCUMENT_LIMIT` is 3 and exactly three slots count, so the locked
count is always zero. Either Basic allows 2 — making document access a
real upgrade reason — or drop the concept from the tier story. Decide
with pricing.

### Stored tier disagreeing with Stripe
If they diverge with no tier event to correct it, the grace clock is
never announced and the fallback locks vessels against the wrong tier.
Wants a scheduled reconciliation. Recorded in dormant identity spec §8.
**The job must skip `lib/billing-exempt.ts`** — the admin account
`2255a040…` is Full by hand with no Stripe subscription, and would be
downgraded on the first run. It must also compare against what was paid
(`lib/subscription-tier.ts`), not the subscription's price.

---

## Smaller, independent

- **FAQ page.** Question set drafted, awaiting a pass. Footer placement,
  anchor per question. Some answers need pricing; one needs the badge
  replacement process.
- **Buyer decline action on transfers.** A buyer can only let the link
  lapse, leaving the seller believing a sale is in progress.
- **Public/owner view toggle.** Owners have no way to see what a stranger
  sees on their own badge.
- **Inactive states drawn with `opacity` are unreadable.** Six places wrap
  content in `opacity-50/60/70` to mean "inactive": the dormant-vessel edit
  block (`VesselOwnerProfile:462,536`, `VesselDocuments:138`), a used
  document slot (`DocumentsEdit:692`), a revoked share
  (`shares/page:193`) and a shipped batch (`badges/[batchId]:394`). The
  opacity composites the text toward the background: 2.00–2.44:1 before
  the `--text3` sweep, 2.38–2.99:1 after it. **No token fixes these** —
  the state needs showing another way (a label, a border, or a muted
  token at full opacity). State-dependent, so they look fine until the
  vessel is dormant or the share revoked.
- **`--gold` as a hover border on a light surface.** `/pricing`'s "Get in
  touch" CTA (`MoxiePricing:209`) hovers `border-[var(--gold)]`, 2.05:1
  on cream, under the 3:1 that 1.4.11 asks of a control boundary. Its
  resting `--divider` border is 1.22:1, so the hover is an improvement
  and this is really about `--divider` as a control boundary generally.
  Found during the `--text3` sweep; out of its scope.
- **`ScanSuccess` hardcodes a colour instead of using a token.** Lines 91,
  111 and 179 use the literal `#6b8299` — `--text3`'s value before the
  2026-09-15 sweep — as 14px text on `--navy-deep`. It measures 4.78:1 and
  passes, and it only still passes because being a literal kept it out of
  the sweep (the corrected token is 3.39:1 there). It wants a named
  dark-surface token rather than a literal, so the next sweep sees it.
  Found by grepping the hex, not the token name.
- **Marketing mock card renders text at 7–8px.** `MoxieMarketingHome:296,
  311, 325` — the fake vessel metadata inside the product mock. A sizing
  and design question, not a contrast one; no colour makes 7px readable.
  Decided 2026-09-15 to leave the size alone for now.
- **Misleading 404 copy.** Every miss reads "That vessel code does not
  exist," including route errors unrelated to vessels. Cost real
  diagnosis time.
- **`shipped_at` / `received_at` renames** + per-identity despatch
  timestamp. From the provisioning build; do together.
- **Confirm `ben@` removed from `ADMIN_EMAILS`** in Vercel.
- **No vessel cap check on the plan picker.** A cancelled owner
  resubscribing to Basic with more lapsed vessels than Basic allows isn't
  warned at the Pay click; `reconcile_vessel_overflow` still enforces it
  after payment.

---

## Spec drift

Recorded in START_HERE, specs not yet edited. Badge provisioning, PWA and
sharing specs all say "not built" and are built. Build spec is stale on
pricing, MXE ID format and email provider. Acceptance tests reference
fixture vessels that don't exist. `docs/moxie_digital_schema.sql` is
headed "CURRENT" but predates 36 migrations — don't run it.

---

## Decided, no action

### Saved-card edit button on the upgrade form (accepted 2026-09-15)
The Payment Element shows an edit (pencil) action on each saved card it
lists. **It can't be turned off:** no Customer Session feature controls
it (the API reference's full `payment_element.features` list is redisplay,
redisplay filter, redisplay limit, remove, save, save usage), and no
Payment Element option in the installed `@stripe/stripe-js` does either.

**What it can reach.** It edits the saved card in place — same
PaymentMethod id, which is the card the subscription renews on. Stripe
doesn't document the edit form itself. Stripe.js's
`savedpaymentmethodupdate` event returns the card's billing details, so
those are editable; the PaymentMethod update API bounds anything more to
expiry month and year and preferred network for co-branded cards. It
cannot change the card number or detach the card (removal is disabled).
Whether the form exposes expiry wasn't observed.

**Why accepted.** A mistyped billing address or expiry could decline the
next renewal, which lands in the existing past-due grace and Stripe's
dunning. And it's a narrower version of something owners can already do:
the Billing Portal's default configuration has `payment_method_update`
enabled (read in test mode), which lets an owner replace the renewal card
outright. Offering the saved card removes re-entry friction on the upgrade
path; the edit button adds no capability the portal doesn't already give.

## Done

Email stages 1–3 (Resend, `notifyOwner`, transfers) · scan-success on the
badge · PWA dead ends · document viewing, metadata, expiry badges · photo
and document stale-cache fixes · gold contrast sweep · vessel cap bypass
· webhook log-and-succeed failures · `choose_active_vessels` constraints ·
payment/title records RESTRICT · card-only checkout · owner delete path ·
all dormancy notifications · plan picker on `/dashboard/upgrade` card-only,
created at the Pay click · Basic → Full upgrade converted: quoted by
a read, standalone card-only invoice at the Pay click, subscription
swapped by the webhook only after payment · saved cards offered on the
upgrade form (seen rendering; the upgrade invoice's intent has no
`setup_future_usage` with or without a saved card — both read in test mode) · a paid upgrade that can't be applied alerts every admin and
the owner, and retries while the subscription could recover · tier follows the paid invoice, not the
subscription's price · admin account exempt from Stripe tier sync ·
scheduler phase 1 report-only, digest and admin page written as plain
sentences · **`90806ee6…`'s tier drift corrected** (2026-09-15): the
subscription item swapped back to the Basic price with
`proration_behavior: "none"`, both pending proration items deleted, stored
tier set to `basic`, and `reconcile_vessel_overflow` run — it holds 3
active vessels on a 2-vessel plan, so a 14-day clock runs to 2026-09-30.
Its renewal is now $59.00 instead of $238.99, a dry run shows no tier
findings, and its `REVIEW_NOTES` entry is gone so the next finding there
reads as new · **`--text3` contrast sweep** (2026-09-15): `#6b8299` failed
AA on all nine surfaces it lands on, not only at 12px — 215 elements, 73 of
them under 12px. Now `#566a7b`: 5.61:1 on white, 5.02:1 on cream, 4.55:1 on
its worst surface. One token change, no call-site splits, because the
parent chain of every instance resolves to a light surface — the `--gold`
and `--danger` pairing wasn't needed. Ratios in brand addendum §6b
