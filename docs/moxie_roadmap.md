# Moxie — roadmap

Open items and what depends on what. Update as items close; add what
turns up. Where this disagrees with the code, the code wins.

_Last updated 24 September 2026_

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

### Service records and miscellaneous documents (Full Access)
**Built and deployed 2026-09-16; migration `20261005` is run** (confirmed by querying the table, which holds real entries). `20261006` clears the seller's document filenames on transfer and is **not yet run**. The design below
is as shipped. Still open: the three questions in the build report
(editing after creation, a deleted entry's file, and whether a buyer
sees the seller's logged-at dates), plus the copy pass on `/pricing` and
the marketing home, which this build deliberately did not touch.

**Attachments are viewable by the owner** (2026-09-16): until then an
upload stored a path and a name and the bytes were unreachable by anyone,
including the owner — `ServiceHistory`'s comment described a download
control that was never built. Now an owner-only route
(`/api/vessels/[mxeId]/service-records/[recordId]`) in the same shape as
the documents route, and a modal on the owner's page only. Readers are
unchanged.

**Share links carry it** (2026-09-16), which is the pre-sale case the
feature exists for: a seller shows a prospective buyer the maintenance
record during evaluation, rather than the buyer first seeing it after the
transfer. A sixth `service` flag, optional in the type so the five-key
flags on existing links keep resolving with the history off — absent reads
as false, because those owners agreed to five choices. On by default for
the escrow preset only. Entries and dates travel; file paths are stripped
server-side before the payload leaves.

**The live claim.** `/pricing` lists "Documents per vessel — Basic: 3,
Full: Unlimited†", with the footnote qualifying only the storage cap
(`MoxiePricing.tsx:38`). Checked against the code: documents are **four
fixed columns** on `vessels` — `doc_registration_url`, `doc_insurance_url`,
`doc_boater_card_url`, `doc_fishing_license_url` — and there is no path to
upload anything else. So the ceiling is four on *every* plan and
"Unlimited" is not a stretch, it is false; the storage cap it is
footnoted against can never bind. Same standing-copy-rule violation as the
email reminders below, and the same fix options: remove the claim or build
the thing. **The marketing home promises it twice more** —
"Insurance docs, registration, maintenance logs — always with the boat,
always current" (`MoxieMarketingHome.tsx:211`) and "Insurance,
registration, maintenance — always current" (`:349`) — which name
maintenance history specifically, so they are closer to promising this
feature than the pricing table is. This also subsumes **"Document limit
can never trigger"** below: with fixed slots, `BASIC_DOCUMENT_LIMIT = 3`
against exactly three countable slots is arithmetic, not a policy.

**Design direction.**
- **Primary documents stay as they are.** Registration, insurance, boater
  card and fishing licence remain fixed slots with expiry tracking. They
  are identity papers with renewal dates, and the expiry machinery
  (`document-expiry.ts`, the reminder thresholds, the dashboard badges)
  is built around exactly that. Nothing here changes them.
- **Service records are a separate collection**, not more document slots:
  their own table, one row per record, with **date, category, description
  and an optional attached file**. A record is meaningful without a file;
  the file is evidence, not the record.
- **Display as a service history grouped by category**, not a flat
  document list. The value is *cadence* — when the engine was last
  serviced, how regularly the bottom is cleaned — which a list of files
  cannot show. This is also what a buyer is actually reading.

**Transfer: settled 2026-09-16.** **Entries transfer with the vessel
automatically. Attached files are the seller's choice and do not transfer
by default.** So the table hangs off the vessel, not the owner, and
`complete_ownership_transfer` carries the rows while nulling or detaching
the file references — the same line it already draws for documents (what
describes the boat carries; what describes you doesn't).

The history belongs to the boat and is most of what makes it worth having
at sale. A scanned invoice is different: it can carry a name, an address,
a price, sometimes a signature — things the seller may not intend to hand
over with the hull.

**A buyer asks the seller directly, and Moxie doesn't broker it.** No
request flow, no queue, no mediation — the page says so plainly in a short
blurb rather than leaving the buyer to discover it. Two reasons worth
keeping: building a request flow means holding a conversation between two
parties about documents we've deliberately not taken custody of, and the
people involved are already talking to each other, because they are in the
middle of selling a boat.

**Two things that make a seller-authored record credible.** The problem
with any history its own seller writes is that a buyer has no reason to
believe it. Neither of these verifies a claim — nothing can,
short of contacting the yard — but both make the *shape* of an honest
record visible and the shape of a fabricated one obvious.

- **A system-set, immutable `logged_at` alongside the owner-entered
  service date, and both display.** A seller can invent an entry, but not
  invent having entered it two years ago. A history logged steadily over
  six seasons reads differently from one where all 22 entries appeared the
  week before listing — and a buyer can see which they are looking at
  without being told. Immutable in the same sense as HIN and year: set
  once by the database, never editable, for the same reason those are
  locked (`#locked-fields` on the FAQ makes this promise to owners
  already). The owner-entered service date stays freely editable — it's a
  claim about the world, and people do log things late.

- **The history shows which entries have a file attached, without
  exposing the file.** A buyer sees "14 of 22 entries have documents" and
  can ask about the three that matter rather than making a blanket
  request. It also makes the seller's choice legible: withholding
  everything looks different from withholding one invoice, and both look
  different from having nothing to show.

**Why this is a product argument, not just a design one.** Both features
reward *logging as you go* and give bulk import at sale time visibly less
value. That ordering is deliberate. An owner who enters a service the week
it happens builds something a buyer will pay attention to; an owner who
dumps six years of receipts into the app the day before listing builds
something that looks exactly like what it is. The feature is worth more to
Moxie the earlier in ownership it is used, which means the reason to keep
the record current is intrinsic rather than a nag — the record's value to
*you* accrues from your own diligence, and it is the part of the product a
seller cannot recreate retroactively.

Related: the transfer flow already leaves documents behind with the seller
(see the `vessel_transferred` email copy).

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

### Grants / RLS / storage audit (2026-09-25, against live) — open findings
Snapshot from `supabase/audit/security_snapshot.sql`; each item checked live
where it could be done read-only. Ranked; none fixed yet.

1. **High — `vessel-photos` INSERT/UPDATE are `auth.uid() IS NOT NULL`** on a
   public bucket with no size or type limit: any signed-in account can
   replace any vessel's public photo, or host arbitrary files there.
   **Done 2026-09-25** (`20261012` run, also #4 size/type and #5). Shown
   with two accounts: before, B overwrote A's fixture photo and stored a
   publicly served SVG, and anon listed the bucket; after, B's overwrite and
   plant get RLS 403s, SVG/HTML and >10 MB are refused in both buckets, anon
   lists nothing, B's own uploads work, real photo URLs still load. Probe
   files deleted.
2. **Medium — default privileges** — **Done 2026-09-25** with #6–#8
   (`20261013` run): postgres's defaults no longer grant anon/authenticated
   anything on new tables, sequences or functions (the guard created one of
   each to prove it). After: all 26 public tables refuse anon with 42501,
   B's signed-in session gets 42501 on all 9 tables probed, anon RPC to
   `next_mxe_id` refused; scan page, public API, dashboard, pricing and the
   waitlist route unchanged.
3. **Medium (correctness) — homepage waitlist has never stored anyone**:
   RLS on, no INSERT policy, 0 rows ever; every submit returns 500. Missing
   config returns `ok: true` ("stored locally only") — a false success.
   **Fixed 2026-09-25** (service-role write, config failure is a 500, DB
   errors no longer echoed to visitors). One live probe submission stored
   (`waitlist-probe@example.com`, left in the table). **Still open:** the homepage says "we'll follow up", but
   nothing shows the list anywhere — no admin page, unlike commercial interest.
4. **Medium — no size/type limits on `vessel-docs`**; direct uploads bypass
   the app's storage cap (`checkStorageCapacity` is only called by the client).
   Size/type part in `20261012`. **Per-user quota enforcement deferred**
   (decided 2026-09-25): a signed-in user can still exceed the plan's storage
   figure (Basic/Full "500MB") by uploading straight to their own folder,
   10 MB at a time. Needs a server-side quota check or a Storage hook — its
   own design.
5. **Low — anon can list `vessel-photos`** (owner auth uids, MXE folders).
6. **Low (done 2026-09-25, `20261013`) — three policies now error** (`ownership_history`,
   `vessel_documents`, `vessel_payments` subquery `vessels`, revoked in
   20261010): signed-in reads get 42501. Nothing in the app uses them.
7. **Low (done 2026-09-25, `20261013`) — TRUNCATE/TRIGGER/REFERENCES and write grants** on 18 public tables
   to anon/authenticated; RLS doesn't cover TRUNCATE, but no API path issues it.
8. **Low (done 2026-09-25, `20261013`) — `mxe_id_seq` USAGE/UPDATE to anon/authenticated**; not reachable
   through any API today.

### App authorization + Auth settings audit (2026-09-25) — open findings
Every route handler (17) and server action (46) read; ownership/role checks
traced into their helpers. None fixed yet.

1. **High — stored-path IDOR: any signed-in account can download any
   owner's documents through our own routes.** `updateVesselDocument`,
   `createVessel` and `addServiceRecord` store a client-supplied storage path
   after checking only vessel ownership; the documents and service-record
   routes then sign whatever path is stored, with the service role — the
   bucket's folder policies never apply. Inputs are public: every photo URL
   on a scan page carries the owner's auth id and MXE ID, and document names
   are fixed (`insurance.pdf`). Signup is open and a pending vessel is free,
   so this reaches any stranger. Derived from code; not yet demonstrated.
   Live data 2026-09-25: all 9 stored document/attachment/evidence paths sit
   in their owner's folder — no sign it has been used.
   **Fixed in code 2026-09-25** (with #5): `lib/storage-path.ts` — every
   action that stores a client path or photo URL requires it to be in the
   caller's own auth-id folder, before the write; guard test fails if a new
   action stores a path without it.
2. **Medium — open redirect after sign-in.** `/login` and `/signup` accept
   any `next` starting with `/` (so `//evil.example`); `/auth/callback`
   rejects `//` but not `/\evil.example`, which the URL parser resolves to
   `https://evil.example/` (checked with the same parser).
3. **Medium (correctness) — "Sign in with Apple" is live on /login and
   /signup; Apple is not enabled** in Supabase Auth (authorize returns
   "provider is not enabled").
4. **Low (correctness) — `getOwnerEmailByUserId`** builds its own service
   client and falls back to anon on any failure, so a broken deploy reads as
   "Forbidden — sign in as the vessel owner"; it also sits outside the
   service-client guard test.
5. **Low — correction-request `documentPath` unvalidated**: an owner can
   make the admin review page show another owner's file as evidence
   (admin-only). Same fix as #1.

Auth settings read from `/auth/v1/settings`: signup open, email
confirmation required, email provider only. Rate limits, password policy,
leaked-password check and redirect allow-list need reading from the
dashboard. Email confirmation is load-bearing: transfer acceptance trusts
the session email.

### Geography rebuild on a required storage ZIP (staged)
The "Vessels by region" card reads 0 in every CA region because the
classifier never reads `storage_city`, the only city column new vessels fill.
Being replaced, not patched: required `storage_zip` → county (Census ZCTA
file, land-area tiebreak) → region config, on a new `/admin/geography`
page, counting `qr_status = 'active'` minus decommissioned (the overview
changes to match). Stages: 0.5 security (done 2026-09-24) · 1 ZIP + county (clears on
transfer; migration before the code that writes it; share-link location
group gains storage city/state) · 2 region config (FL/WA county lists need
approval) · 3 page · 4 inline backfill.

### Commercial interest list is collecting; nothing sends to it yet
`/pricing` now captures email + optional business type instead of opening a
mail client (2026-09-21). Migration `20261009_commercial_interest.sql` is
**written, not run** — until it is, a submission reports "something went
wrong at our end" rather than a false success, and nothing is recorded.

**When commercial launches, this list is the reason it exists:** export the
CSV from `/admin/commercial-interest` and email it once. Anyone who signed
up was told exactly that and nothing else, so a newsletter or a second
unrelated mail would be a promise broken.

**`admin@moxieyachting.com` is unverified.** Each new submission emails it
through Resend, best-effort. Nobody has confirmed that mailbox exists —
same gap as `support@moxieyacht.com` below. If it bounces, the row is
still recorded; the notification is the part that would be lost.

### Account rows are created on first meaningful action, not at signup
**Decided 2026-09-20 after a survey — don't redo it.** Signing up creates
an Auth account and nothing else. `public.users` gains a row when someone
registers a vessel (`dashboard/new/actions.ts`), accepts a transfer
(`transfer/accept/actions.ts`), is attached to a marina
(`admin/marinas/actions.ts`), or buys a plan (`lib/owner-account.ts`,
added with this decision).

**Creating it at signup instead was considered and rejected**, because four
things currently read meaning into the row's presence:

1. **`users.email` is UNIQUE, and at least one row's id deliberately differs
   from its Auth id** (`ben@moxieyachting.com`: auth `7f004b27…`, row
   `00000000…`). A signup insert keyed on the Auth id collides on email and
   fails the signup. This is the one that bites; `ensureOwnerAccount` looks
   up **by email first** for exactly this reason, and a test pins it.
2. **Vessel intake prefers an existing row's `full_name`** over the name
   typed on the intake form, so a signup-derived name would override what
   the owner types.
3. **`/admin` counts `users` with `role = 'owner'`** as "total owners",
   split Basic/Full. Every signup that never registered a boat would
   inflate it.
4. **`subscription_tier` defaults to `'basic'`**, so billing would report
   "Basic" for an account with no subscription instead of nulls.

Not affected either way: the scheduler (its `inScope` filter drops accounts
with no vessel, no Stripe customer and no grace clock), `requireAdmin`,
marina membership.

**Fixed at the same time:** the plan picker dead-ended on "Owner account
not found." for a rowless account — it now creates the row. `notifyOwner`
logged a failed insert and returned success; it throws now, because the
in-app row is the record. The Basic→Full upgrade still refuses without a
row, correctly: it needs an active subscription, which implies one.

**Today:** 7 Auth accounts, 7 rows. One Auth account has no row
(`matteves@me.com`, never signed in). One row has no Auth account
(`demo-marina@moxieyachting.com`) and therefore cannot sign in — worth
knowing before using it to test marina staff.

### Convert the provisional by **26 June 2027**, or take "patent pending" down
**Provisional filed 26 June 2026. It expires 26 June 2027** if it is not
converted to a non-provisional. That date is an action with consequences,
not a note: the day it lapses, every "patent pending" claim on the site
becomes inaccurate and must come down the same day.

Where the claim appears today (added 2026-09-20):
- How it Works step 03 — "The role-aware scan is patent pending."
- The marketing footer's standing line, on every marketing page.
- The printed badge (`lib/badge-layout.ts`), which has carried it all along
  — and which is on physical product, so a lapse means stock to scrap or
  over-label, not just a deploy.
- `docs/design/moxie_digital_homepage.html`, the design reference.

In the US, false marking is penalised (35 U.S.C. §292), and the claim is
accurate only while an application is genuinely on file. So: convert
before 26 June 2027, or remove all four. If it grants, "pending" becomes
the patent number.

Same discipline as the email-reminder and unlimited-documents copy: the
site may not say a thing the product — or the filing — doesn't support.

### App copy promises email reminders that nothing sends
The Full plan list and badge checkout both mention email reminders. The
template exists; nothing sends it. Direct violation of the standing copy
rule. Either remove the claims or wait for the scheduler.

**One of two live copy violations**, the other being unlimited documents
and maintenance history (Tier 3, above). Worth one pass over marketing and
plan copy rather than two, since both end the same way: remove the claim
or ship the feature.

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

**Probably decided by service records** (Tier 3, above) rather than on its
own: while documents are four fixed slots there is no quantity for a limit
to govern on either plan. If service records land as a separate
collection, the Basic/Full line is drawn there instead, and this item
becomes "drop the concept".

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

- **`support@moxieyacht.com` does not exist yet.** The FAQ (shipped
  2026-09-16) tells people to email it twice — for badge replacement and as
  the general fallback. Only `admin@moxieyachting.com` is set up. Raised in
  the mockup's own review notes; **create the mailbox before this page gets
  any traffic**, or the page's one promise of a human fails silently.
- **"You choose what it includes" on share links.** The FAQ's
  `#share-documents` answer says a share link's contents are selectable.
  Not verified against what the share sheet actually offers — flagged in
  the mockup's review notes and not checked, since copy was settled. If the
  sheet has no field selection, that sentence is the copy rule again.
- **Tailwind's dev CSS went stale on a new file.** Building the FAQ, the
  dev server emitted only utilities that already existed elsewhere in the
  codebase (`pt-32`, `pb-24`, `mt-14`, `scroll-mt-28` were all missing,
  `px-6` and `max-w-[760px]` were fine), so the page rendered with no top
  padding and its heading under the fixed nav. `rm -rf .next/dev` and a
  restart did not clear it; `npm run build` emitted every one of them
  correctly. **Verify new marketing pages against `moxie-web-prod`, not
  the dev server.** Worth understanding properly — it would silently
  mis-render any new page during development.
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
- **Six sizes under 10px remain on the marketing home** — I said four
  before, which was an undercount from grepping only 7–9px. The badge card
  under the QR art is **8px**, and its "Patent Pending" line is **6px**;
  plus `:135` (8px hero badge), `:246` (9px card badges), `:367` and
  `:376` (9px contact labels). The phone mockup's own six were fixed
  2026-09-17 — nothing inside it is under 11px — but these sit elsewhere.
  No colour makes 6px readable.
- **The QR art's caption reads "Scan · MXE-00001".** That MXE ID does not
  exist; live vessels start at MXE-01006. Now that the page demos a real
  vessel a few sections down, an invented one in the artwork is a loose
  end — MXE-01016 would make both consistent.
- **The Polaris photo on the home page is 3572×3021, 2.2 MB.** It is the
  real photo already in the public bucket, shown in a 320×200 box, so the
  marketing home downloads roughly fifteen times the pixels it displays.
  Lazy-loaded, so it does not block first paint, but a resized copy is
  worth having — dimensions asked for in the 2026-09-17 build report.
- **`/[mxeId]`'s 404 can't tell a bad code from a bad URL.** Fixed as far
  as it goes (see Done), but that one boundary still shows conditional
  copy — "if you were looking for a vessel" — because a not-found boundary
  gets no params and `headers()` there carries no path (probed). The clean
  split needs middleware to set the pathname on the request, which means
  editing the Supabase session-refresh dance in `middleware.ts`; not worth
  the risk for copy, but that's the route if it's ever wanted.
- **Seller filenames no longer persist after a transfer** (fixed by
  `20261006`, run 2026-09-16): `complete_ownership_transfer` nulls
  `doc_insurance_filename`, `doc_boater_card_filename` and
  `doc_fishing_license_filename` alongside their URLs.
  `doc_registration_filename` is deliberately kept — the registration
  document carries to the buyer (badge provisioning spec §2.5).
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

**`vessel-docs` limited to the owner's own folder** (2026-09-24): live
policies were `auth.uid() IS NOT NULL`, so any signed-in account could list,
read and overwrite every owner's documents. `20261011` run (rollback in
`supabase/rollbacks/`). Demonstrated with two accounts on the live site:
before, B listed all 3 owner folders, read A's fixture and **overwrote it**
(confirmed on the stored object); after, B lists 0 folders, gets 404 on
read and 403 on overwrite/plant, while B's own folder and A's own folder
work for upload/replace/list/read/delete, and A's documents through the app
return the same bytes as before. The previously-owned page's links (always
404, raw path as href) go through a seller-checked route; verified refusing
non-sellers, bad ids and bad types — no snapshot on file holds a document,
so a file actually streaming there is not yet observed. ·

**Public key can no longer read `vessels`** (2026-09-24): anon and
authenticated had table SELECT with only an `is_public` row rule, so
`/rest/v1/vessels?select=*` with the browser's key returned every column
(mailing_zip included). Scan page and `/api/vessels/[mxeId]{,/preview}` read
with the service role, keeping `is_public = true` in the query;
`20261010_revoke_public_vessel_reads.sql` run. Verified after: anon gets
`42501` on the table and on a single column; live scan pages, preview and
public API still answer. `authenticated` is covered by the migration's guard
block, not by a probe (needs a signed-in JWT). ·

**Small-text and contrast sweep** (2026-09-20): 117 elements below 11px
across 35 files raised to an 11px floor — the three roadmap items (the grey
badge pair, the shares page's 9px labels, the marketing home's six) were
one problem in 117 places. `--gray-fg` `#888780` → `#666560` (3.13:1 →
5.08:1) fixed all nine uses at every size; ad-hoc white alphas on navy
replaced by `--text-on-dark` at 62% (2.25–4.36:1 → 6.4–7.4:1); the share
header's teal gradient takes solid white. Transient status text ("Saving…",
"Voiding…") no longer dims to 1.25:1; disabled controls keep their alpha.
Measured and recorded in the brand addendum §6b. ·

**Marina operator role-gated access** (2026-09-18, spec
[`moxie_digital_marina_access_spec.md`](moxie_digital_marina_access_spec.md)):
built in five stages and tested end to end. Owners grant a marina with its
join code (`/marina/join`); a marina scanning a shared vessel sees owner
contact, emergency contact, slip number and the documents the owner chose;
`/marina` roster with search and flags; `/admin/marinas`; print poster via
a Download poster button per marina on `/admin/marinas` (and `npm run
marina-poster` for batches). Migrations `20261007` and `20261008` run. A change
of owner revokes access (trigger on `vessels.owner_id`). The marketing
home's Marina Operator card moved to present tense the same day. Changing
a grant's documents re-grants through the marina's current join code; if a
code is ever cleared, the owner can still remove that marina but not
change its documents. ·

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
and `--danger` pairing wasn't needed. Ratios in brand addendum §6b ·
**404 copy made honest** (2026-09-15): the app-wide 404 no longer claims a
vessel code failed. Four boundaries now — generic at the root, and one each
next to the code that calls `notFound()` for vessels, badge scans and print
batches — so a message only names a thing where that thing genuinely was
what failed · **FAQ page** (2026-09-16): 24 questions across five sections
at `/faq`, from `docs/design/moxie_faq_page.html`, with stable anchors
pinned by a test, linked from the marketing footer, signup and the public
vessel profile · `/dashboard/<mxeId>` redirects to `/<mxeId>?role=owner`
instead of 404ing (307, case-normalised; sub-routes unaffected) · a badge
scan with no service role returns 500 and its own error screen instead of
telling a scanner the badge doesn't exist · **a missing service role is a
500 everywhere** (2026-09-15): 65 call sites in 54 files now go through
`requireSupabaseServiceClient()`, which throws, replacing 22 redirects,
4 silent skips and 34 inline errors. The seven routes that already return
their own 5xx keep the raw factory, held to it by
`lib/supabase/service.guard.test.mts`. Signed-out paths are byte-identical
with and without the key — verified by removing it · **the anon client too**
(2026-09-16): 42 sites now use `requireSupabaseServerClient()`,
`fetchVesselByMxeId` no longer serves demo data at a real MXE ID, and
`share-resolve` no longer reports a failed query as an expired link
