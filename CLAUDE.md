# Moxie — project instructions

Read `docs/moxie_digital_START_HERE.md` for what the project is, where
things live, and which specs are current. This file is how to work in it.

`docs/moxie_roadmap.md` is the running list of open work and what blocks
what. Keep it current in the same commit as the work: when an item closes,
move it to Done; when a new open item or dependency turns up, add it; bump
the "Last updated" date. Where it disagrees with the code, the code wins —
fix the roadmap.

## Standing rules

When a prompt says **"Standing rules apply"**, it means all of these. They
apply whether or not the prompt says so.

- **No migrations executed.** Prepare them as files; the user runs them.
- **No destructive operations.** No deleting data, dropping tables, force
  pushes, or history rewrites unless explicitly asked, and even then say
  what will be destroyed first.
- **No writes to Stripe or other external services** (Resend, Supabase
  Auth, any third-party API) without asking first — reads are fine.
- **Commit and push when done**, report the hash, and point at the live
  site.

And how the user expects work to be done:

- **Report before building when asked** ("report back before building",
  "don't build yet", "show me before/after first"). Stop at the report.
  Don't start the build in the same turn.
- **When a decision is forced, tell rather than pick.** If a constraint
  forces a choice the prompt didn't make ("if the foreign key forces a
  choice, tell me rather than picking one"), lay out the options and stop.
- **Respect stated out-of-scope items.** Note related problems you find;
  don't fix them in passing.
- **Say things plainly.** If something is derived rather than stored,
  unverified, or a guess, say so in those words. If an earlier statement
  of yours was wrong, correct it up front, especially when the user's
  decision rested on it.
- **Diagnose before fixing; fix the cause, not the symptom.** When the user
  offers a hypothesis, test it — and say so if the evidence rules it out.
- **Demonstrate, don't assert.** "I'd rather see it refuse than be told it
  would." A guard that blocks something should be shown blocking it.
- **Tests must fail on the real defect.** After writing a regression test,
  confirm it fails against the old code (revert, run, restore). Test the
  shipped code path, not a replica of it: scripts import production modules.
- **Fixtures, not real people's data.** A branch that touches a customer's
  files or payments runs against a fixture first.
- **Audit logs are append-only.** Never edit or delete a log row, including
  probe rows written while testing. "An audit log you edit isn't one."
- **Live sends are exact.** When asked for a live email or similar, send
  exactly what was asked, to exactly the address given, once.
- **Stripe dashboard work goes to the user as click-through steps**, not a
  script — same principle as migrations.

## Verify by observation, not inference

Several wrong answers this project had came from estimating instead of
checking. Before stating a fact about the system, observe it:

- **Contrast:** compute the ratio from the actual token values and the
  actual (composited) background. Don't eyeball screenshots.
- **Emails:** read headers back where possible; if the API key can't
  (Resend's key is send-only), say it's unverified.
- **Schema and data:** query the live database (read-only) rather than
  reading migration files. Useful read-only techniques:
  - `select` via the service-role client for rows and columns — a missing
    column returns `42703`.
  - PostgREST `GET /rest/v1/rpc/<fn>?args` runs inside a **READ ONLY**
    transaction, so it shows whether a function or overload exists (and its
    result shape) without being able to write.
  - The OpenAPI document at `/rest/v1/` lists RPCs and their parameters.
  - `pg_get_functiondef(p.oid)` gives a function's **deployed body**, which
    is the only valid source when replacing one (see the migrations
    section). It needs the SQL editor, so ask for it.
- **Library APIs:** check the installed type definitions in `node_modules`
  (e.g. `stripe@22`, `@stripe/stripe-js`) rather than assuming field names.
- **What the browser renders:** if a dev-server result contradicts the
  source, suspect Turbopack's cache before the code — delete `web/.next/dev`
  and restart. It has served stale CSS and stale chunks.

## Git workflow: auto-commit and push after every change

After every change made in a session (code, docs, migrations — anything),
commit and push to GitHub immediately, without waiting to be asked:

1. Stage the change (`git add`), write a clear, descriptive commit
   message that summarizes *what* changed and *why*, and commit.
2. Push to `origin main` right away — don't leave commits sitting local
   and unpushed.
3. After a successful push, confirm the commit hash and tell the user
   the push went through. The user reviews changes on the live site
   (moxieyacht.com / moxieyachting.com), not localhost — tell them to
   check there in a minute or two, not to expect it instantly.
4. **If the push fails for any reason — especially an auth/credentials
   error — stop immediately and tell the user directly.** Do not leave
   the repo in a committed-but-unpushed state without flagging it. A
   silent failure here means the user is looking at a stale live site
   without knowing something's stuck.

This standing instruction means routine commits/pushes to this repo's
`origin` don't need separate confirmation each time — the user
pre-authorized it. It does not extend to force-pushes, history rewrites,
or any other destructive git operation, or to any repo other than this
one's configured `origin`.

Pushing deploys to Vercel immediately. **Migrations are run later, by
hand.** So application code must work against the schema as it is *before*
its migration runs: tolerate a missing column (`42703` / `PGRST204`) and an
old function return shape without throwing — a throw in the Stripe webhook
fails every event until the migration lands. State the deploy order in the
migration's header.

## Migrations: prepare, never run

Every schema change is prepared as a `.sql` file under
`supabase/migrations/` for the user to run themselves in the Supabase
SQL Editor. Never execute a migration — "migration on my hand" is a
standing instruction, not a per-request one.

- **Paste the full SQL in the report**, not just the filename — the user
  pastes it into the SQL editor. A filename pasted there is a syntax error.
- **Check it parses** before reporting (e.g. `pglast` in a scratch venv,
  which uses the real Postgres parser and can parse plpgsql bodies).
- **Say what changes for existing rows** and whether it can run before or
  after the deploy.

### Replacing a function body: copy it, don't recall it

A function body is rebuilt **from `pg_get_functiondef` against the live
database**, or from the migration file *after confirming that file matches
live* — never from memory. Ask for the live definition if you can't read it
yourself; it is one query and the user can paste it.

**If you haven't read the source you're copying, say so** rather than
describing the result as a copy. A false claim of equivalence is worse than
an acknowledged guess, because it removes the reader's reason to check.

This is not hypothetical. `20261005` shipped a `complete_ownership_transfer`
body written from memory and labelled "identical to 20260920's except one
UPDATE". It was identical to nothing: it returned JSONB instead of void and
dropped the completed-status early return (webhook idempotency), the whole
`ownership_history` block, the vessel existence check and the `- 'owner_id'`
on the frozen snapshot. Only the return-type mismatch would have stopped it
— had the types matched, `CREATE OR REPLACE` would have replaced the live
function silently, and no guard, test or review of the file would have
caught it. The first diagnosis then blamed a stale migration file; that was
also wrong, and blaming a working process is its own cost.

### Dropping a function reopens EXECUTE to PUBLIC

`CREATE OR REPLACE` cannot change a return type, so changing one means
`DROP FUNCTION` + `CREATE FUNCTION`. **A newly created function is
executable by `PUBLIC`** — which is how `anon` could call `next_mxe_id()`
before `20260923_lock_rpc_execute_grants.sql` closed it. Every migration
that drops and recreates a function must, in the same file and transaction:

1. `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` and
   `GRANT EXECUTE ... TO service_role` for the exact signature, and
2. end with a guard `DO` block that raises (rolling the file back) unless
   each function has exactly one overload, the expected signature and return
   type, is not executable by `anon` or `authenticated`, and is executable by
   `service_role`.

Copy the pattern from `20261003_past_due_lapse_reports_changes.sql` or
`20261002_dormancy_functions_report_changes.sql`.

The same risk exists without a DROP: `CREATE OR REPLACE` with a signature
that differs from the live one by a single parameter type silently creates
a **second overload** with default grants. Confirm the live signature first
and keep the overload check in the guard (see `20260929`). That is also how
a stale `delete_unactivated_vessel(uuid, uuid)` survived for weeks.

New functions (not replacements) get the same revoke/grant in their own file.

### The base schema is not in `migrations/`

The tables that predate the migrations — `users`, `vessels`, `marinas`,
`vessel_documents`, `qr_tokens`, `waitlist` — and the `update_updated_at`
triggers (`vessels_updated_at`, `vessel_documents_updated_at`) are defined
in **`supabase/seed.sql`**. Searching only `supabase/migrations/` gives
wrong answers about what exists: that is how a "nothing bumps
`vessels.updated_at`" claim got made when a trigger does it on every
update. `docs/moxie_digital_schema.sql` is an older copy of `seed.sql` plus
what `20260825` adds; it is not a third source and is out of date. When in
doubt, query the live database.

## Stripe (and other external services holding real state): ask before writing

Reading is fine anytime — retrieving objects, listing invoices,
inspecting a subscription's state, previewing a proration, querying logs.
No confirmation needed for any of that, in test mode or live.

**Writing is different: ask first, every time, even in test mode.**
Creating, updating, or canceling a Stripe object (or the equivalent in
any other external service that holds real state — a payment processor,
a mailer, a third-party API) is a side effect on state Claude doesn't
fully own, separate from this repo's own git history. This applies to
diagnostic/reproduction calls too, not just user-facing app behavior:
running the actual mutating call to see what Stripe does is a write,
even if the intent is purely investigative. Reverting a side effect
afterward does not retroactively make causing it fine — the ask has to
come before, not after. Once real customers exist, an unannounced
mutation to live payment state is not acceptable at all, so build the
habit now: describe the write being considered and its purpose, and wait
for a yes before running it.

Clicking Pay in a checkout creates a PaymentIntent or subscription — that
is a Stripe write too. Rendering a checkout form in deferred mode is not.

## Code conventions

### Enforcement lives in the function or a shared helper, never one caller

A check in one caller is not enforcement, and a page restricting the
choices it offers is not authorization. Server actions receive whatever
arguments a client sends.

- Constraints belong in the SQL function that performs the write (every
  mutating RPC re-verifies its own preconditions, with a distinct custom
  SQLSTATE per refusal — `MX0xx` — so each refusal is testable).
- A check that can't live in SQL (it needs a network call, e.g. Stripe)
  goes in a shared helper that is **the only path** to the write, with a
  test that fails if anything else calls it. Example:
  `lib/unpaid-vessel-delete.ts` is the only caller of
  `delete_unactivated_vessel`, enforced by its test.
- **A configuration failure is a 500, decided once.** Use
  `requireSupabaseServiceClient()` / `requireSupabaseServerClient()`, never
  a `create…` factory plus a local null branch —
  `lib/supabase/service.guard.test.mts` fails if anything outside its
  allow-list (routes that already return their own 5xx) calls the factory.
  Handled locally it stops looking like a failure at all: 22 pages
  redirected, so a missing service role read as "you are not an admin" or
  "you have been signed out"; four skipped their work silently, one showing
  an owner an empty fleet; 34 actions returned a tidy inline error. Vercel
  reported success and nothing alerted. **A broken deploy must not be
  reported as a fact about the visitor** — not as a permission, a session,
  an expired link, or an empty state.
- A check at one moment doesn't cover a grant at a later one. The vessel cap
  is checked at the Pay click (a courtesy), and **enforced** by
  `reconcile_vessel_overflow` after activation and transfer completion.

### `src/lib` uses relative imports with extensions

`@/lib/...` path aliases only resolve inside Next. Tests
(`node --test "src/**/*.test.mts"`, using Node's type stripping) and
scripts in `web/scripts/` can't resolve them. Inside `web/src/lib`, import
siblings relatively **with the `.ts` extension** (`./tier-config.ts`,
`./stripe/server.ts`); `tsconfig` allows it. Anything a test or script
imports must follow this, transitively. App code under `src/app` and
`src/components` may keep `@/`. Keep modules a test needs free of Next-only
imports (`next/headers`, `server-only`) — split pure logic into its own
file if necessary (e.g. `dormancy-notifications.ts` vs
`dormancy-notify.ts`).

### Colour tokens are surface-specific

A token is defined against a background. Moving a component to a different
surface means changing its tokens, not just its container.

| Purpose | On a dark surface | On a light surface |
|---|---|---|
| Gold text, links, triggers | `--gold` | `--gold-deep` |
| Danger text and controls | `--danger-on-dark` | `--red-fg` |

`--gold` fails even the large-text floor on every light surface; `--gold-deep`
fails on navy. A translucent tint (`--gold-dim`) takes the colour of what's
behind it, so the same class can need opposite text tokens in two places.
Check hover states too — they have been worse than the resting state. A
shared class used on both kinds of surface needs two variants named for the
surface (`editTriggerClass` / `editTriggerOnDarkClass`). Measured ratios and
the full reasoning: **`docs/moxie_digital_brand_addendum_integration.md` §6b**.

### Copy never promises what doesn't send

No app or marketing copy may promise reminders, notifications, alerts, or
emails that the app does not actually send. Check the sender exists before
writing the sentence. What sends today: the notification types in
`lib/notification-policy.ts` (via `notifyOwner`), the transfer invitation
(via `notifyEmailAddress`), Supabase's password reset, and the scheduler's
admin digest (`lib/scheduler/digest.ts`, to `role = 'admin'` accounts only). The expiry
reminder has a template (`lib/email/expiry-reminder.ts`) and **no sender**.

### Notifications

- `notifyOwner` for account holders, `notifyEmailAddress` for people who
  never signed up (e.g. a transfer buyer). Grep for each to find every
  message of that kind.
- The in-app row is the record and is always written; email is best-effort
  on top. Per-type email and dedupe policy lives in
  `lib/notification-policy.ts`, with the reasoning for each type.
- A notification needs a moment to fire at. Functions that change state
  return what that call changed, guarded on the "before" state, so only the
  changing call gets a result — that is what makes notifying from a page
  render or a redelivered webhook safe.
- One notification per account per event, naming the count.

### Stripe webhook

- **Throw on failure when a retry is safe**, so POST returns 500 and Stripe
  redelivers. Establish retry safety per handler — it is not symmetric.
- **The tier follows what was paid, never the subscription's price.** Stripe
  applies a price swap when it is requested, before any invoice is paid.
  `invoice.paid` writes the tier the latest paid invoice charged for
  (`lib/subscription-tier.ts`); status events never write a tier.
- **Accounts set by hand are not Stripe's to change.** Anything that syncs
  tier or status from Stripe checks `lib/billing-exempt.ts` first.
- **Act on current Stripe state, not the event's snapshot**, for anything
  whose status moves back and forth (subscriptions). Retries arrive up to
  ~3 days late and out of order. See `lib/subscription-sync.ts`.
- **Record the payment before delivering the service**, so a charge whose
  service can never succeed is still on file for a refund.
- Payment-record inserts treat `23505` (unique violation) as "already
  recorded", not as a failure.

### Checkout

- PaymentIntents and subscriptions are created **at the Pay click**, never
  on page load (Elements mounts in deferred mode with the real Stripe Price
  amount). Checks made on load can be defeated by opening several pages.
- Checkouts accept **card only** (`IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES`
  in `lib/stripe/payment-methods.ts`), with Link turned off on the Payment
  Element. Delayed-settlement methods let state change under a processing
  payment. The form and the intent must use the same list, and
  `lib/stripe/payment-methods.test.mts` checks each checkout it lists.
- A checkout that creates a plan subscription stores its id before the
  first invoice is paid, so the next Pay click has to deal with the one on
  file. Both do it through `lib/stripe/abandoned-subscription.ts`.
- **Never change a subscription before it is paid for.** Stripe applies an
  item swap when requested. The Basic → Full upgrade charges a standalone
  invoice and the webhook swaps the item after `invoice.paid`
  (`lib/stripe/tier-upgrade.ts`). A subscription invoice's PaymentIntent
  carries `setup_future_usage: off_session`; a standalone invoice's doesn't
  (read in test mode) — the deferred form must match whichever it confirms.
- Tier numbers and prices live in `lib/tier-config.ts`. Several are mirrored
  by hand as literals in SQL functions (vessel limits, the 7- and 14-day grace
  periods) — change both.

## Testing and verification in this repo

- `cd web && npm test` (Node test runner), `npx tsc --noEmit`,
  `npm run build`. `npx eslint src` has a known baseline of 8 errors, all in
  `src/lib/supabase/schema-stub.ts`; anything beyond that is new.
- Dev servers are defined in `.claude/launch.json`: `moxie-web` (dev, 3010)
  and `moxie-web-prod` (`next start`, 3012, run `npm run build` first).
- Temporary render harnesses: put them at a route like `src/app/zzharness/`
  and delete them before committing. Folders starting with `_` are private
  in the App Router and won't route. A harness route that doesn't render
  may be falling through to the `[mxeId]` catch-all's not-found page.
- Local `web/.env.local` points at Stripe test mode, but its
  `STRIPE_PRICE_ID_BADGE` doesn't resolve under the local key and
  `STRIPE_PRICE_ID_BASIC_SUBSCRIPTION` isn't set — real checkout amounts
  can't be read locally.
