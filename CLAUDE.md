# Moxie — project instructions

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

## Migrations: prepare, never run

Every schema change is prepared as a `.sql` file under
`supabase/migrations/` for the user to run themselves in the Supabase
SQL Editor. Never execute a migration — "migration on my hand" is a
standing instruction, not a per-request one.

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
