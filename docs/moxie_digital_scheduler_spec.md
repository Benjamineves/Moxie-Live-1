# Moxie — scheduler spec

**Status: phase 1 built (report-only), 2026-09-15.** Decisions recorded
the same day (§12). Phase 1 is the whole pipeline in report-only mode: it
records what each step would do and changes nothing. No acting path exists
yet; §13 lists what phase 1 is and isn't. Nothing in this document exists in the code yet; where it states a fact about the
current system, that fact was checked against the code, the live database
(read-only) or vendor documentation on that date, and says so.

**Related:** dormant identity spec §8 (tier reconciliation constraints),
`web/src/lib/billing-exempt.ts`, `web/src/lib/subscription-tier.ts`,
`web/src/lib/email/expiry-reminder.ts`, roadmap "Tier 3".

---

## 0. Summary

One cron route, run once a day at 17:00 UTC. It works **account by
account**: for each account, four steps run in a fixed order, and a step
that fails stops the later steps *for that account only*. Every action and
every failure is written to an append-only events table. Any run that
changed something, or failed, emails every admin a digest.

The order differs from the one proposed, by one swap:

1. Tier reconciliation
2. **Transfer-buyer window** (moved up)
3. Dormancy reconciliation
4. Expiry reminders

Everything ships **report-only first**: the job records what it *would* do,
without writing or sending, until each step is switched on deliberately.

The §12 decisions were answered on 2026-09-15 and are folded into the
sections below.

---

## 1. What exists today (observed)

| Deferred work | Where it runs now | Problem |
|---|---|---|
| Past-due grace → lapse (7 days) | `reconcile_owner_dormancy` on the public vessel page (`[mxeId]/page.tsx`) and the owner dashboard; `reconcile_all_dormancy` on `/admin` | Only runs when someone loads a page. An anonymous badge scan writes vessel state and sends the owner email. An owner nobody visits never lapses. |
| Downgrade grace → lock (14 days) | Same calls (`apply_overflow_fallback`) | Same. |
| Stored tier vs Stripe | Nothing | Recorded in dormant identity spec §8. |
| Transfer buyer with no plan | Nothing | `complete_ownership_transfer` moves the vessel with `lifecycle_status` still `active` and never checks the buyer's plan. Lapse logic runs only on Stripe subscription events, which a never-subscribed account never gets. **Live example:** account `b6cac9fa…`, `subscription_status = 'none'`, received `MXE-01024` by transfer on 2026-09-11 and holds it active. |
| Expiry reminders | Nothing | `lib/email/expiry-reminder.ts` is built and wired to nothing. No opt-out exists (`users.expiry_reminders_opt_out` → `42703`). |

`reconcile_all_dormancy` is also unsuitable as the scheduler's primitive:
it loops every owner **inside one database call**, so one owner hitting the
functions' 5-second `lock_timeout` rolls back every other owner's pause,
and none of them is notified.

Live scale on 2026-09-15: 7 accounts (4 active, 3 `none`), 4 with a Stripe
customer, 10 active vessels, 2 dated documents (none within 60 days), 0
past-due accounts, 0 running grace clocks, 2 completed transfers.

---

## 2. Shape: one route, per-account pipeline

### Why one route, not four

The steps depend on each other, and the dependency is about **state at the
moment a step reads it**, not about which day it runs:

| Step reads… | …which the earlier step makes true |
|---|---|
| Transfer window reads "does this account have a live plan?" | Tier reconciliation (stored status may be stale) |
| Dormancy reads `subscription_status`, `past_due_since`, `subscription_tier` | Tier reconciliation. A stale `past_due` that Stripe has since recovered would lapse a paying account; a stale tier locks against the wrong limit. |
| Reminders read `lifecycle_status` | Dormancy (don't remind about a vessel paused in this run) |

Separate cron routes can only order these by the clock — tier at 17:00,
dormancy at 17:10. If tier reconciliation fails, runs long, or Vercel
skips its delivery (Vercel documents delivery as best-effort), dormancy
still fires at 17:10 against unreconciled state. That is exactly the
violation the order exists to prevent. Separate routes would buy
independent time limits, but at this scale a whole run takes seconds (§6).

### Why per account, not per step

The dependencies are **per account**. Dormancy for owner A doesn't depend
on tier reconciliation for owner B. Running step 1 for everyone, then
step 2 for everyone, forces a bad choice when step 1 fails for one
account: skip step 2 for everyone (one Stripe hiccup blocks all lapses),
or run it for everyone (violates the dependency for that one account).

Running the four steps per account gives both properties:
- a failure skips only that account's dependent steps;
- the time-limit boundary falls cleanly **between accounts**, never
  between two steps of one account.

### Why the transfer window moves before dormancy

Both pause vessels, but with different causes. `apply_overflow_fallback`
locks vessels beyond the plan limit (`dormant_cause = 'locked'`), and
`set_vessels_lapsed` pauses the rest (`'lapsed'`).
`clear_vessels_lapsed` — what runs when an owner subscribes — restores
only `'lapsed'` (roadmap: "Upgrading to Full doesn't restore locked
vessels").

A no-plan buyer can have a grace clock running: the webhook calls
`reconcileVesselOverflow` for the buyer when a transfer completes (checked). If dormancy runs first, it can lock some
of their vessels, and then the window lapses the rest. When they
subscribe, they get back only part of their fleet. Running the window
first lapses everything under one cause, and subscribing restores all of it.

---

## 3. The steps

Each step returns `changed`, `would_change` (report-only), `no_change`,
`exempt`, `skipped` (with the reason, e.g. "tier reconciliation failed"),
or `failed` (with the error). Every result except `no_change` is written
as an event (§7).

**Which accounts a run visits:** the union of accounts with a
`stripe_customer_id`, accounts holding an active vessel, accounts that are
`past_due` or have `downgrade_grace_until` set, and accounts with a dated
document in reminder range. Ordered by `users.scheduler_checked_at`
ascending, nulls first, so a run cut short resumes with the accounts it
didn't reach (§6).

### 3.1 Tier reconciliation

**Skips** every account for which `isTierReconciliationExempt(owner_id)`
is true (today: `2255a040…`, admin@). Recorded as `exempt`.

**No Stripe customer:** nothing to compare. If such an account is `active`
or `past_due` and not on the exempt list, it's an **anomaly** (a hand-set
plan nobody listed). Report it and alert; never change it.

**A customer Stripe can't find is an anomaly, never "no plan".** A
`resource_missing` on the customer (deleted, or a test-mode id read with
live keys) says nothing about whether the owner pays. Treating it as
"no subscriptions" would lapse the account. It's recorded `anomaly`,
alerted, and nothing changes. This matters on the switch to live Stripe
keys: every `stripe_customer_id` in the database today is a test-mode
id, and a live-key run would hit this for all of them.

**Reads per account** (all reads):
1. `subscriptions.list({ customer, status: 'all' })`
2. The live subscription's latest invoice, with its lines
3. Paid `tier_upgrade` invoices for that subscription created after that
   invoice (`invoices.list({ customer, status: 'paid', created: { gte } })`)

**Stripe's answer:**
- **Status** follows the same rules as the webhook (`decideSubscriptionSync`).
  A live subscription gives its status. No live one but a cancelled or
  unpaid one gives `canceled`. No subscriptions at all gives `none`.
- **Tier**, only when a subscription is live, is the most recent **paid**
  of:
  - (a) the latest plan invoice's tier via `tierForPaidInvoice`;
  - (b) a paid `tier_upgrade` invoice newer than (a), which means `full`.

  If neither decides, the tier is *undetermined*: leave it alone and
  report it. **Never read the subscription's price** (dormant identity spec §8, constraint b).

  Case (b) is required, not optional. After a Basic → Full upgrade, the
  subscription's latest invoice is still the Basic one, and the Full
  payment is a standalone invoice. Reading only (a) would downgrade every
  account that has ever upgraded.

**Corrections**, applied through functions extracted from the webhook
(`lib/account-sync.ts`) so the webhook and the job share one definition of
"active", "lapse" and "tier write":

| Drift | Action | When |
|---|---|---|
| Stripe active, stored not | Status active, `clear_vessels_lapsed`, restore notification | Immediately |
| Stripe past_due, stored active | Status past_due; `past_due_since = now()` only if null (a late detection never shortens the grace) | Immediately |
| Stored basic, paid full | Write `full`, `reconcile_vessel_overflow` | Immediately |
| Stripe no live plan, stored active/past_due | Webhook lapse branch (status canceled, tier basic, `set_vessels_lapsed`, notification) | **Only if the previous completed run recorded the same drift for this account** |
| Stored full, paid basic | Write `basic`, `reconcile_vessel_overflow` (may start the 14-day clock) | **Same two-run rule** |

**Why two runs for the downward corrections.** A webhook that's failing is
redelivered by Stripe for up to about three days, so drift can be real
and still resolving. Corrections that give access apply at once. Ones that
take it away wait 24 hours, and a genuine missed cancellation is still
fixed the next day.

**First-run effects, known today:**
- `90806ee6…` (`sub_1UBJeT…`) is **your own account**, with test-mode
  data left by the upgrade bug from before the 2 Sept fix: stored `full`,
  Stripe price Full, paid only for Basic. Reconciliation must not
  downgrade it and record that as a correction. **Gate: the tier step
  can't be switched to acting while this account shows drift.** Resolve it
  first, in one of two ways:
  1. **Correct the test data (recommended):** swap the subscription item
     back to Basic with `proration_behavior: "none"`, delete the two
     pending proration items, and set the stored tier to match whichever
     plan you want the account on. These are Stripe and database writes,
     asked for when the time comes. It keeps the exempt list meaning "plan
     set by hand, no Stripe subscription".
  2. **Add it to `lib/billing-exempt.ts`** with the reason. That's quicker,
     but the account would never be reconciled again, and the list would
     stop meaning one thing.
- `2255a040…` (admin): exempt, so untouched.

**Stripe read budget.** About 3 reads per subscribed account per run. Stripe
allows 500 reads per transaction over 30 days, with a floor of 10,000 a
month (docs, 2026-09-15). Today that's about 360 a month. At 1,000
subscribed accounts, about 90,000 a month, which needs roughly 180
transactions a month to stay inside. Worth watching, not yet a constraint.

### 3.2 Transfer-buyer window

**Window: 30 days** (decided 2026-09-15). Long enough that a buyer
sorting out a boat purchase isn't rushed, short enough that free service
doesn't accrue. Revisit once there's real data.

**Condition.** After step 1, the account:
- is not exempt,
- holds at least one vessel with `qr_status = 'active'` and
  `lifecycle_status = 'active'`,
- and has `subscription_status` not in (`active`, `past_due`, `trialing`).

It's written generally, not as "received a transfer": a cancelled owner
who later receives a vessel, or any future path that grants an active
vessel without a plan, is the same gap.

**Clock:** new column `users.no_plan_since`.
- Set to `now()` the first time a run sees the condition (guarded
  `IS NULL`, so only that call starts it, and only that call notifies).
- Cleared when the condition ends: they subscribe, or hold no active vessels.

**Why not derive it from `ownership_transfers.completed_at`.** For existing
holders the transfer is already in the past. `b6cac9fa…` completed on
2026-09-11; a derived clock would lapse them 30 days after that, possibly
on the first run and with no warning. A stored clock gives everyone the
full 30 days from the day they're first told. **The clock starts at the
first acting run**, not a report-only one, which writes nothing. As
proposed; not contradicted in review.

**Expiry:** new SQL function `apply_no_plan_window(p_owner_id, p_window_days)`
→ `UUID[]`.
- Takes the owner's advisory lock and re-checks the condition and the
  clock inside the function.
- Calls `set_vessels_lapsed` and returns the ids only to the call that
  lapsed them (the 20261002/20261003 pattern).
- Subscribing restores them through the existing `clear_vessels_lapsed`
  in the webhook's active branch.

**Duration:** `NO_PLAN_WINDOW_DAYS = 30` in `lib/tier-config.ts`, passed
as the function's argument (the number lives in one place, so SQL doesn't
mirror a literal).

**Notifications** (new types):
- `no_plan_window_started` (email): "choose a plan by {date}", where the
  date is `no_plan_since + 30 days` read from the stored clock, never a
  restated day count (the same rule as the downgrade email).
- `vessel_lapsed_no_plan` (email). The existing `vessel_lapsed` copy
  covers two causes and would be false for a third.

**If the product decision is "require a plan at acceptance" instead:** this
step is still needed for existing no-plan holders and for non-transfer
paths. The acceptance check would be a separate change to
`accept_ownership_transfer`.

### 3.3 Dormancy reconciliation

**Candidates:**
- `subscription_status = 'past_due'` and `past_due_since + 7 days ≤ now()`,
  or
- `downgrade_grace_until ≤ now()`,
- plus accounts with a running clock, for the grace-started notification.

**Per account:**
1. `reconcile_owner_dormancy(owner)`, in its own transaction.
2. `notifyOwnerDormancyResult`, which already exists and relies on ids
   returned only to the changing call.
3. `notifyDowngradeGraceIfDue`, which already exists and claims the send
   in the database.

**Never** `reconcile_all_dormancy`, for the reason in §1.

**The page-load callers are removed**, not kept as a fallback.
- **Dependency:** a page-load call applies dormancy against a stored tier
  and status that nothing has reconciled. That's the ordering this spec
  exists to enforce, run on whatever schedule visitors happen to set.
- **Surface:** on the public vessel page it is an anonymous GET that writes
  state and sends email.
- **Cost of removing:** a pause lands up to 24 hours after the grace
  deadline, not at the moment someone loads a page. On 7- and 14-day
  windows that's the lenient direction. The downgrade email quotes the
  deadline date, and pausing a day after it contradicts nothing.

**Removal order:**
1. Enable the dormancy step.
2. After three consecutive clean acting runs, remove `reconcile_owner_dormancy`
   from `[mxeId]/page.tsx` and `dashboard/page.tsx`, and replace `/admin`'s
   `reconcile_all_dormancy` call with the scheduler panel (§7).
3. Drop `reconcile_all_dormancy` in a later migration, once unused.

While both paths exist it is safe: the SQL returns paused ids only to the
call that paused them, so nothing notifies twice.

### 3.4 Expiry reminders

**Scope:**
- Vessels with `qr_status = 'active'` and `lifecycle_status = 'active'` as
  of after step 3.
- The owner has an email and hasn't opted out.
- Documents: `reg_expiry`, `ins_expiry`, and `fishing_license_expiry`
  unless `fishing_license_lifetime`. The boater card has no expiry.
- **Full Access only** (decided 2026-09-15): `subscription_tier = 'full'`
  as of after step 1, so the tier has been checked against Stripe.
  Reminders are the concrete thing Full delivers and the copy sells them
  that way. Basic owners keep the in-app expiry badges; the email is the
  upgrade reason.
  - A `past_due` Full owner still gets them: they're still on Full, and
    their vessels are active until dormancy says otherwise.
  - An owner who drops to Basic mid-window gets no further reminders. One
    who upgrades gets the thresholds still ahead.
  - The admin account (exempt, Full by hand) is included like any Full
    owner. Its vessels are test vessels, so expect reminders to
    admin@moxieyachting.com for them.

**"Days remaining" is computed from calendar dates in `America/Los_Angeles`.**
Vercel functions run in UTC, and `document-expiry.ts` uses the process's
local date. Unpinned, a document would read a day short for owners west of
UTC.

**Thresholds: 30, 7 and 0 days before expiry** (decided 2026-09-15). Sixty
days is too early to act on an insurance renewal and trains people to
ignore the sender; three emails per document is the ceiling before it
reads as nagging. **Nothing after expiry.**
- Each run sends **at most one** reminder per document: the most urgent
  threshold crossed that hasn't been sent.
- If a missed run means a document jumps from 8 days to 6, it gets the
  7-day reminder. If it jumps from 31 days to 6, it gets the 7-day
  reminder only, not 30 and 7 together.
- A document gets **3** emails at most per expiry date, not 30.
- A document first dated inside a window is reminded for the window it's in.
  Added with 12 days left, it gets the 30-day reminder, which says "expires in
  12 days". **Correction, 2026-09-15:** an earlier version of this line said
  it would start at 7. Nothing records when an expiry date was entered, so a
  late entry can't be told apart from a missed run, and both follow the same
  window rule.

**Idempotency:** new table `expiry_reminder_sends`, unique on
`(vessel_id, owner_id, doc_type, expiry_date, threshold_days)`.
1. **Claim:** insert the row as `claimed`. A `23505` means already claimed
   or sent, so skip.
2. **Send** with Resend's `idempotencyKey` set to the row id.
3. **Record:** mark the row `sent` (with the Resend id) or `failed`.

The key parts cover these edge cases:
- **Owner renews:** a new `expiry_date` means a new key, so reminders
  start again for the new date.
- **Vessel transferred:** a new `owner_id` means a new key, and
  completion clears the dates anyway.
- **Run dies between claim and record:** a later run finds a row still
  `claimed`.
  - Claimed under 23 hours ago: resend with the same key. Resend remembers
    keys for 24 hours (docs) and won't send twice.
  - Older than that: mark it `failed` and alert, and don't resend. A
    possible single miss beats a possible duplicate outside the key window.

**Rate:** Resend allows 10 requests per second per team (docs), shared with
webhook notifications. The job sends at most 5 per second and honours
`retry-after` on a 429.

**Opt-out, per owner** (decided 2026-09-15: one toggle, one link; someone
who wants these off wants all of them off). Doesn't exist yet; this spec
adds it:
- **Column:** `users.expiry_reminders_opt_out_at`; null means reminders are on.
- **Link:** every reminder's footer links to `/email/unsubscribe` with
  `owner` and `token` query parameters.
  - `token` is an HMAC-SHA256 of the owner id and `"expiry_reminders"`,
    keyed by a new secret `EMAIL_UNSUBSCRIBE_SECRET`. No sign-in needed.
  - GET shows a confirm button, so mail scanners that follow links don't
    unsubscribe anyone.
  - POST applies it.
  - The URL carries the opaque user id and an HMAC, no email address or name.
- **Headers:** `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) point at
  the POST endpoint. `lib/email/send.ts` gains `headers` and
  `idempotencyKey` pass-through; the installed `resend@6.27.0` accepts
  `idempotencyKey`.
- **Turning back on:** a toggle in the dashboard's account panel.
- **Template:** the "Manage reminders" footer line goes back into
  `expiry-reminder.ts`, as its header comment anticipates.

**The copy rule unlocks when this step is switched on**, not before. Only
then may app copy mention reminders, and CLAUDE.md's "what sends today"
list gains them.

---

## 4. Authentication

Vercel calls `GET` on the production deployment with
`Authorization: Bearer <CRON_SECRET>` and user agent `vercel-cron/1.0`
(docs, 2026-09-15). The route:

- **Refuses to run if `CRON_SECRET` is unset** (500, logged). Missing
  configuration never means "open".
- **Compares the header with `crypto.timingSafeEqual`** against
  `Bearer ${CRON_SECRET}` (lengths checked first), and returns 401 on
  mismatch, having done nothing.
- **Trusts nothing else.** `x-vercel-cron-schedule` and the user agent
  are informational; anyone can send them.
- **Lives under `/api/`.** `middleware.ts` skips its domain redirects for
  `/api/` paths (checked), and Vercel cron doesn't follow redirects: a 3xx
  would end the invocation without running anything.

**Generate the secret:**

```bash
openssl rand -hex 32
```

That's 64 hex characters; Vercel recommends at least 16.

**Where it goes:**
- **Vercel:** Project → Settings → Environment Variables → `CRON_SECRET`,
  **Production** environment, marked Sensitive. Vercel only runs crons
  against production, so Preview doesn't need it.
- **Locally:** `web/.env.local`, to call the route with `curl` during
  development.
- **Rotating** it means changing the variable and redeploying.

Generate `EMAIL_UNSUBSCRIBE_SECRET` the same way and put it in Production
and `.env.local`. Rotating it invalidates every unsubscribe link already
sent.

**Manual runs** don't go through the route. `/admin` gets a "Run now"
server action, checked by `requireAdmin()`, that calls the same
`runScheduler({ trigger: 'manual' })`. The cron secret never reaches a
browser.

---

## 5. Failure isolation

**Three levels:**
1. **An account's step fails** (a Stripe 5xx, an RPC error, a 5-second lock
   timeout). The step is recorded `failed` with the error. That account's
   later steps are recorded `skipped: depends on <step>`. The run continues
   with the next account.
2. **The run can't proceed** (database unreachable, required env missing,
   lease can't be taken). The run is recorded `failed` and ends.
3. **Vercel kills the function** (504 at the time limit). The run row stays
   `running`. The next run marks it `timed_out` (§6) and alerts.

**Run status:**
- `succeeded`: every visited account completed.
- `partial`: some accounts failed, or weren't reached before the time budget.
- `failed`
- `timed_out`

**Nothing is swallowed.**
- Every failure and skip is an event row.
- The route returns **500** for `partial` and `failed`, so the invocation
  shows red in Vercel's cron log. Vercel doesn't retry cron invocations
  (docs), so a 500 has no retry side effect; it is purely a visible signal.
- **Who finds out:** every `role = 'admin'` account gets one email for
  any run that isn't `succeeded`, listing failed and skipped accounts with
  their errors. It goes through `notifyOwner`, keyed on the run id. The
  `/admin` scheduler panel shows the same.
- **If that alert can't send** (Resend down), the run row still records it,
  and the next run's start-up check ("previous run not succeeded and not
  alerted") sends it then.

**Circuit breaker.** A bug in reconciliation that mass-downgrades paying
customers is the worst failure this job can have, and it should stop and
ask.

**Principle: it trips on a proportion, not a count** (decided 2026-09-15).
Ten accounts locking in one run is alarming at seven accounts and routine
at a thousand. A fixed number is either too tight later or meaningless
now.

**What counts, against what:**

| Measure | Counts | Denominator (fixed at run start) | Trips above |
|---|---|---|---|
| Accounts losing access | Tier downgrades, lapses (tier step or no-plan window) and accounts with vessels locked | Accounts holding an active vessel or a live plan | **5%**, but never below **2 accounts** |
| Vessels paused | Vessels locked or lapsed | Active vessels | **5%**, but never below **5 vessels** |
| Reminder emails | Reminders sent | Full owners' dated documents in scope | **50%**, but never below **10 emails** |

**Why a floor.** A pure proportion trips on every ordinary event while
the business is small: at 7 accounts, one missed cancellation is 14%. The
floor only stops a single routine event tripping it. Above a few dozen
accounts the proportion is what binds. At 1,000 accounts the account
breaker trips above 50, so ten locking is routine.

**What tripping does.**
- **When:** checked before each access-removing action and each send. The
  breaker is measured as the run goes, so at most the threshold is acted
  on before it trips.
- **Then:** those actions switch to report-only for the rest of the run.
  Other steps carry on, and the run ends `partial`.
- **Alert:** the admin email says which breaker tripped, with the counts.
- **Resuming:** nothing more is removed or sent until an admin reruns it
  from `/admin` with an explicit "confirm above threshold".

---

## 6. Idempotency, partial runs and time limits

**Every write is safe to repeat:**
- **Existing SQL** (`set_vessels_lapsed`, `apply_overflow_fallback`,
  `clear_vessels_lapsed`, `reconcile_vessel_overflow`) is guarded on the
  before-state and returns ids only to the call that changed them.
- **New SQL** (`apply_no_plan_window`) follows the same pattern.
- **Tier and status writes** set values, so repeating them writes the same.
- **Reminders** are claimed by a unique row.
- **Notifications** either key on the event or fire only from a
  changing call.

A run that dies halfway leaves some accounts done and some not. Repeating
it does nothing further to the first set and completes the second.

**Duplicate delivery and overlap.** Vercel documents that a scheduled run
can be delivered more than once, and that a long run can overlap the next.
The job takes a **lease**:
1. Mark any `scheduler_runs` row still `running` and older than
   `maxDuration + 60s` as `timed_out`.
2. Insert a new row as `running`. A partial unique index on `status` where
   `status = 'running'` makes a second concurrent insert fail with `23505`.
3. The loser records nothing, logs "overlapping run, skipped" and returns
   200.

The lease saves duplicate Stripe reads; correctness doesn't depend on it,
because of the idempotency above.

**Time limit.**
- **Vercel's limit:** Pro functions default to 300 seconds, with 800
  seconds generally available (docs, 2026-09-15). The route sets
  `maxDuration = 800`.
- **Internal budget:** stop *starting* new accounts at 600 seconds, finish
  the current account's pipeline, and record the rest `not_reached`
  (status `partial`).
- **Progress:** `users.scheduler_checked_at` is stamped when an account's
  pipeline completes, and accounts are visited oldest-first. A cut-short
  run's leftovers go first the next day, so no account can starve.

**Does any step need batching?** Not at current scale, and the design
doesn't have to change when it does.
- **Cost per account:** roughly 3 Stripe reads (about 0.5 seconds) plus a
  few database calls. The 600-second budget covers about 1,000 subscribed
  accounts per run.
- **Reminders:** at 10,000 vessels × 3 documents × 4 thresholds a year,
  that's about 330 sends a day at 5 per second, roughly 66 seconds.
- **Past about 1,000 accounts:** move the cron from daily to hourly and
  visit only accounts with `scheduler_checked_at` older than 23 hours.
  Same code, a different schedule and one filter.

**Missed runs** (best-effort delivery). Every step reconciles current
state, so the next run catches up.
- **Grace deadlines:** land a day later.
- **Reminders:** a skipped threshold gives way to the most urgent one.
- **Nobody noticing:** see absence detection in §7.

---

## 7. Observability

**`scheduler_runs`**: one row per run.
- Fields: `id`, `trigger` (`cron` | `manual`), `started_at`, `finished_at`,
  `status`, and `mode`, which steps were acting and which report-only.
- `summary` (JSONB) holds per-step counts: accounts visited, changed,
  would change, exempt, failed, skipped, not reached.
- `alerted_at`

**`scheduler_events`**: one row per thing that happened. **Append-only**:
a trigger raises on UPDATE or DELETE, so no role can edit history, not
even `service_role` (CLAUDE.md: audit logs are append-only).
- Fields: `run_id`, `owner_id`, `vessel_id` (nullable), `step`, `kind`,
  `detail` (JSONB), `created_at`.
- `kind` is one of `changed`, `would_change`, `exempt`, `skipped`,
  `failed` or `anomaly`.
- `detail` examples: `{ "from": "full", "to": "basic", "invoice": "in_…" }`;
  `{ "locked_ids": [...] }`; `{ "doc": "insurance", "threshold": 7,
  "resend_id": "…" }`.

**When a run locks vessels or sends 40 emails, you find out three ways:**
1. **Admin digest email** for any run that changed or would change
   something, or wasn't clean. For example: "Tier: 1 corrected
   (`90806ee6…` full → basic). Dormancy: 3 vessels locked for 1 account.
   Reminders: 40 sent, 0 failed." It links to the run. **A no-op
   successful run sends nothing**, so the email means something happened.
2. **`/admin/scheduler`**: the last 30 runs with status and counts, and
   each run's event list, filterable by account and step. It replaces the
   dormancy side effect on `/admin`'s load.
3. **Owners' own notifications**, already recorded in `owner_notifications`
   with their emails.

Vercel's runtime logs get one structured line per step and account. They
are not the record; the tables are. (I haven't checked Vercel Pro's log
retention.)

**Absence detection.** A run that never happens can't report itself, and a
job that silently stops is the failure that matters. Decided 2026-09-15:
an external uptime monitor polls a health endpoint.

**`GET /api/health/scheduler`**
- **Healthy (200):** the most recent *finished* run ended `succeeded` or
  `partial` within the last **26 hours**. That's the daily interval plus
  two hours of slack for a slow run.
- **Unhealthy (503):** otherwise, meaning no finished run in 26 hours, or
  the latest ended `failed` or `timed_out`. Also 503 if the table can't
  be read (`PGRST205` before the migration, or the database is down). A
  monitor that can't tell is an alert.
- **`partial` counts as healthy:** the job ran, and failed accounts already
  produce the admin email. The monitor answers "is it running", not "was
  every account clean".
- **Unauthenticated** (most free monitors can't send headers), so the body
  says as little as possible: `ok` or `stale`, plus the last finished
  run's time. No counts, account ids or errors.
- One indexed read per poll, `Cache-Control: no-store`.

**Monitor setup** (yours, about fifteen minutes, after the first run so it
doesn't start red):
1. In a free uptime monitor (UptimeRobot, Better Stack or similar; check
   its free plan's check interval), add an HTTP(S) monitor for
   `https://moxieyacht.com/api/health/scheduler`.
2. Alert on non-200, to your email.
3. Check every 5–15 minutes, whatever the free plan allows.
   The 26-hour window, not the check interval, decides how late you hear.
4. Stop the cron (or point the monitor at a path that returns 503) once,
   to confirm the alert reaches you.

**Also:** `/admin` shows a warning banner when the last healthy run is
older than 26 hours.
- **Not chosen:** a push heartbeat, where the job pings the monitor's
  URL on success. It works too, but it's an outbound call to a third party
  on every run, and polling needs nothing from the job.

---

## 8. Schedule

**`0 17 * * *` (17:00 UTC), once a day.**

- **Time zone:** Vercel evaluates schedules **only in UTC** (docs), with no
  daylight saving, so one UTC time moves by an hour locally twice a year.
  17:00 UTC is **09:00 PST in winter, 10:00 PDT in summer**, and never
  before 9 a.m. Pacific.
- **Owners:** mostly California by mailing and storage state (live data:
  CA, plus CT, FL, AL, CO). 17:00 UTC is 12:00–13:00 Eastern. Reminders
  land mid-morning on the West Coast and around lunch on the East Coast.
  They never land overnight, which would read as automated.
- **Timing:** Pro runs within the specified minute (docs).
- **Why daily:** grace windows are measured in days, reminders have day
  granularity, and a daily run keeps Stripe reads at their minimum. Nothing
  here gets meaningfully better at hourly until the account count forces it
  (§6).
- **Weekends:** runs every day, not suppressed. A grace deadline that falls
  on a Saturday pauses on Saturday.

`vercel.json` gets `{ "crons": [{ "path": "/api/cron/daily", "schedule": "0 17 * * *" }] }`.
It has to sit in the directory Vercel builds from. If the project's Root
Directory setting is `web`, that's `web/vercel.json`. I haven't seen that
setting, so check it before building.

---

## 9. Schema changes (outline; migrations prepared at build time)

**Tables:**
- `scheduler_runs`, with the partial unique index on `status = 'running'`.
- `scheduler_events`, with the append-only trigger.
- `expiry_reminder_sends`, with the unique claim key.

**Columns on `users`:**
- `no_plan_since TIMESTAMPTZ`
- `expiry_reminders_opt_out_at TIMESTAMPTZ`
- `scheduler_checked_at TIMESTAMPTZ`

**Functions:** `apply_no_plan_window(UUID, INTEGER) RETURNS UUID[]`, with
the REVOKE/GRANT and guard block from CLAUDE.md. Scheduler tables get RLS
on and no policies, so service role only.

**Before a migration runs, the code must not throw.** A step whose table or
column is missing (`42703` / `PGRST204` for a column; `PGRST205` for a table, observed 2026-09-15) records
`skipped: migration <name> not run`, and the run carries on. Each migration
header states its deploy order. All of them can run before the deploy: they
are additive, and existing rows get nulls.

---

## 10. Rollout

1. **Migrations** (§9). You run them.
2. **`CRON_SECRET` and `EMAIL_UNSUBSCRIBE_SECRET`** in Vercel Production (§4).
3. **Deploy the route and the health endpoint with every step
   report-only.** Modes live in `lib/scheduler-config.ts`, so switching a
   step on is a reviewed commit, not a dashboard toggle.
4. **After the first run, set up the uptime monitor** (§7) and test its alert once.
5. **About a week of daily digests.** Review what each step would do,
   especially tier drift.
6. **Resolve `90806ee6…`** (§3.1). The tier step can't be switched on while
   it shows drift.
7. **Switch steps on one at a time,** in pipeline order:
   1. tier;
   2. the transfer window (30 days; `b6cac9fa…`'s clock starts here);
   3. dormancy;
   4. reminders, after the opt-out ships.
8. **Three clean acting runs of dormancy,** then remove the page-load
   callers (§3.3).
9. **Reminders on,** then update the app copy, CLAUDE.md's "what sends"
   list and the roadmap.

---

## 11. Noticed, out of scope

- **Transfer links expire lazily too.** `transfer/accept/page.tsx` marks a
  pending transfer expired only when the buyer opens the link, so a link
  the buyer ignores never expires and the seller's dashboard banner never
  resolves. It's a natural fifth step (independent of the other four);
  not proposed here.
- **Downgrade-grace notifier reads Stripe's price.**
  `notifyDowngradeGraceIfDue` takes the tier from the subscription's price.
  Since the upgrade conversion, price and paid state agree for new upgrades,
  but it's the same class of read dormant identity spec §8 (constraint b) forbids.
- **Upgrading doesn't restore locked vessels.** An existing roadmap item;
  §2's ordering avoids making it worse but doesn't fix it.
- **Expiry dates in the UI.** `document-expiry.ts` may show a day short when
  rendered server-side in UTC (§3.4). Not verified in the UI.

---

## 12. Decisions (recorded 2026-09-15)

| # | Question | Decision |
|---|---|---|
| 1 | Step order and shape | **Per account**: tier → transfer window → dormancy → reminders (§2). |
| 2 | `90806ee6…` | Your own account; test-mode data from the pre-fix upgrade bug. **Exempt or correct it before the first acting run**, never "corrected" by a downgrade. Spec recommends correcting it, with the writes asked for at the time (§3.1). |
| 3 | Transfer window | **30 days**; revisit with real data. The clock starts at the first acting run, including for `b6cac9fa…` (§3.2). |
| 4 | Reminder eligibility | **Full Access only.** Basic keeps the in-app badges (§3.4). |
| 5 | Thresholds | **30, 7, 0 days**; nothing after expiry; at most 3 per document per expiry date (§3.4). |
| 6 | Opt-out | **Per owner**: one toggle, one link (§3.4). |
| 7 | Circuit breaker | **Trips on a proportion**, with a small floor: 5% of accounts (at least 2), 5% of active vessels (at least 5), 50% of reminder-eligible documents (at least 10) (§5). |
| 8 | Absence detection | **External uptime monitor** polling `/api/health/scheduler` (§7). |
| 9 | Page-load dormancy | **Removed** after three clean acting runs of the dormancy step (§3.3). |

**Still to settle when building, not now:**
- How to resolve `90806ee6…` (item 2), and approving its writes.
- The copy for `no_plan_window_started` and `vessel_lapsed_no_plan`.

---

## 13. Phase 1 as built (2026-09-15)

**What runs.** `GET /api/cron/daily` (`web/vercel.json`, `0 17 * * *`) runs
the full per-account pipeline in **report-only** mode, and records findings
in `scheduler_runs` and `scheduler_events`. Any run that finds something or
doesn't finish cleanly emails a digest to every admin.
`GET /api/health/scheduler` is for the uptime monitor. `/admin/scheduler`
shows runs and events and has **Run now**; `/admin` shows a banner when the
scheduler isn't healthy.

**Why report-only is structural, not a flag.**
- **Store:** `lib/scheduler/store.ts` offers reads, plus writes to the
  scheduler's own three tables. It has no method that writes users, vessels
  or reminder sends.
- **Stripe:** `lib/scheduler/stripe-reads.ts` wraps exactly four Stripe
  reads, and the scheduler never sees the client.
- **Refusal:** `runScheduler` won't start if any step in
  `lib/scheduler/config.ts` is set to `act`.
- **Tests:** checks fail if the store writes another table, or if any
  scheduler file calls a Stripe write, a SQL function or a notifier.

**Not built yet** (each comes with switching its step on):
- the acting paths and `lib/account-sync.ts`;
- `apply_no_plan_window`;
- sending and claiming reminders;
- the opt-out link, headers and toggle;
- the no-plan notification copy;
- incremental breaker enforcement (phase 1 only measures and reports);
- removing the page-load dormancy calls.

**Dormancy and reminder findings are previews** computed from reads, mirroring
the SQL. When those steps act, the SQL is the enforcement.

**Two-run rule as built:** a downward correction applies only if the same
finding was recorded by the latest run that finished **at least 20 hours
earlier**. A manual run an hour after the cron doesn't count as the second
sighting.

**Migration:** `supabase/migrations/20261004_scheduler_phase1.sql`.
- Creates the four tables and the two `users` columns.
- Makes `scheduler_events` append-only: a trigger refuses UPDATE and
  DELETE, and UPDATE/DELETE/TRUNCATE are revoked from `service_role`.
- Before it runs, the cron route returns 500 naming the migration, and
  health returns 503.

**Tier findings need `STRIPE_PRICE_ID_BASIC_SUBSCRIPTION`.** Without it a
Basic invoice line maps to no tier, and the run reports `tier:undetermined`
(an anomaly, never a change). That's what a local dry run did, since the
variable is only commented out in `.env.local`. Production's value hasn't
been read. If the first digest shows `tier:undetermined` for accounts on a
paid Basic plan, that variable is the cause.

**How findings read (2026-09-15).** The digest and `/admin/scheduler` lead
with one line: whether anything needs a person. Then two lists, **Needs
you** and **No action needed**, in plain sentences
(`lib/scheduler/describe.ts`). Accounts are named by email and vessels by
MXE ID, both copied onto the event when it's recorded.
- **Needs you:** failures, anomalies (a customer Stripe can't find, no
  paid invoice naming a plan, two live subscriptions, a plan with no
  customer), a stored plan that disagrees with what was paid on an
  unexplained account, and a breaker that would trip.
- **No action needed:** policy doing its job, plus findings on accounts
  in `REVIEW_NOTES`.
- **Grouping:** one cause on several accounts, such as a missing price id,
  is one line listing the accounts.

**Dry run:** `node --env-file=.env.local scripts/scheduler-dry-run.mts [--html file]` runs
the shipped pipeline against live data with in-memory bookkeeping, and prints
the findings and the digest. It writes nothing.

