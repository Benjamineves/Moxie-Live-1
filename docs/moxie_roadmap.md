# Moxie — roadmap

Open items and what depends on what. Update as items close; add what
turns up. Where this disagrees with the code, the code wins.

_Last updated 15 September 2026_

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

**Existing data, not this gap:** `90806ee6…` (`sub_1UBJeT…`) is Full in
both Stripe and the app, having paid only for Basic; its two pending
proration items (net $89.99) will go on its 2027-09-02 renewal.

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
subscription's price · admin account exempt from Stripe tier sync
