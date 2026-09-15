# Moxie — roadmap

Open items and what depends on what. Update as items close; add what
turns up. Where this disagrees with the code, the code wins.

_Last updated 14 September 2026_

---

## Tier 1 — Blocks taking money at all

### Vercel Pro upgrade
**Blocks:** legal operation, the scheduler, cron frequency
Hobby prohibits commercial use, so this is required the moment a real
payment is taken — not just a scheduler dependency. Hobby also caps cron
at one run per day.

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

### Expiry reminder scheduler
**Depends on:** Vercel Pro
**Releases:** the reminder copy constraint
Daily cron, idempotent sends, owner opt-out. Templates are built and
unwired. Dormancy reconciliation should move into the same job — it
currently runs lazily on page loads, including a stranger's badge scan.

### DMARC tightening
**Depends on:** a few weeks of consistent sending
Currently `p=none`. Moving to `quarantine` makes spoofing harder.

---

## Correctness — open

### App copy promises email reminders that nothing sends
The Full plan list and badge checkout both mention email reminders. The
template exists; nothing sends it. Direct violation of the standing copy
rule. Either remove the claims or wait for the scheduler.

### Basic → Full upgrade doesn't follow checkout conventions
`upgradeToFullAccess` swaps the subscription item to the Full price,
invoices the proration and mints its PaymentIntent when the owner clicks
"See my upgrade total" — before any payment. Elements mounts on that
intent's client secret (not deferred), Link is not turned off, and the
intent's methods follow the subscription's `payment_settings`, which are
unset on all three active subscriptions.

**Likely grants Full without paying.** The swap is sent without
`payment_behavior: "pending_if_incomplete"`; Stripe's docs say only that
mode holds a change until payment, and the code comment claiming
otherwise is wrong. Observed on `sub_1UBJeT…` (test mode): Full price,
`pending_update` null, the two proration items still uninvoiced, only the
Basic signup invoice ever paid. That run predates the current three-call
version, but step 1 is the same call. `customer.subscription.updated` then
writes `subscription_tier = full`. Not demonstrated against current code
— that needs a Stripe write.

A deferred version needs the amount before the swap:
`invoices.createPreview` (a read) on load, then swap + invoice at the Pay
click, with `pending_if_incomplete`.

### Upgrading to Full doesn't restore locked vessels
`clear_vessels_lapsed` only restores `dormant_cause = 'lapsed'`. An owner
who pays for Full keeps cap-locked vessels until they find manage-fleet.
Billing correctness, not notifications.

### Transfer buyer never has to subscribe
Neither acceptance nor completion checks subscription status, and lapse
logic only runs on Stripe events a never-subscribed account never gets.
A seller can pay a transfer fee and hand someone indefinite free service.
**Decision needed:** require a plan at acceptance, or allow a window
before the vessel lapses. A window needs the scheduler to close it.

### Document limit can never trigger
`BASIC_DOCUMENT_LIMIT` is 3 and exactly three slots count, so the locked
count is always zero. Either Basic allows 2 — making document access a
real upgrade reason — or drop the concept from the tier story. Decide
with pricing.

### Stored tier disagreeing with Stripe
If they diverge with no tier event to correct it, the grace clock is
never announced and the fallback locks vessels against the wrong tier.
Wants a scheduled reconciliation. Recorded in dormant identity spec §8.

---

## Smaller, independent

- **FAQ page.** Question set drafted, awaiting a pass. Footer placement,
  anchor per question. Some answers need pricing; one needs the badge
  replacement process.
- **Buyer decline action on transfers.** A buyer can only let the link
  lapse, leaving the seller believing a sale is in progress.
- **Public/owner view toggle.** Owners have no way to see what a stranger
  sees on their own badge.
- **`--text3` contrast sweep.** Below AA at 12px on light surfaces. Same
  class as the gold sweep.
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
- **Account `2255a040…` is active/Full with no Stripe subscription.** Has a
  customer id, no subscription on it, `stripe_subscription_id` null. Seen
  while auditing checkouts; not investigated.

---

## Spec drift

Recorded in START_HERE, specs not yet edited. Badge provisioning, PWA and
sharing specs all say "not built" and are built. Build spec is stale on
pricing, MXE ID format and email provider. Acceptance tests reference
fixture vessels that don't exist. `docs/moxie_digital_schema.sql` is
headed "CURRENT" but predates 36 migrations — don't run it.

---

## Done

Email stages 1–3 (Resend, `notifyOwner`, transfers) · scan-success on the
badge · PWA dead ends · document viewing, metadata, expiry badges · photo
and document stale-cache fixes · gold contrast sweep · vessel cap bypass
· webhook log-and-succeed failures · `choose_active_vessels` constraints ·
payment/title records RESTRICT · card-only checkout · owner delete path ·
all dormancy notifications · plan picker on `/dashboard/upgrade` card-only,
created at the Pay click
