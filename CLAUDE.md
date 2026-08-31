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
