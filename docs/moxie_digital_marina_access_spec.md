# Moxie Digital — Marina operator role-gated access (v1)

**Status: built (v1, 2026-09-18), in five stages.** Migrations `20261007`
and `20261008` are run. §9's two proposals were approved (trigger on
`vessels.owner_id`; membership by `users.marina_id`). Slip number joined
the field set during stage 5 (§2.2). The marketing card is still future
tense — that flip is an open copy decision.

Related: [`moxie_digital_marina_registry_spec.md`](moxie_digital_marina_registry_spec.md)
is a *different* feature — marina records as a CRM seed for internal
sales. This spec is the customer-facing role view. They share the
`marinas` table and nothing else.

### What changed from the 2026-09-17 draft

- **Insurance and registration *status* are gone.** The marina sees the
  documents themselves, where the owner chose to include them (§2.2).
- **A marina join code replaces marina matching.** No dependency on
  `vessels.marina_id` or the free-text `marina_name` (§3).
- **The three open questions are settled:** unilateral grant; dormant
  vessels keep the roster row and lose the detail view *except emergency
  contact*; granting lives with join-code entry, not the share sheet.
- **There is no "not on Moxie" scan state.** A scanned badge is a
  registered vessel (§6.3).
- **Two claims in the draft were wrong.** It said the scan branch "already
  resolves a role": it resolves owner vs public only — `?role=marina` is
  never read and falls through to the public profile. It said `marinas`
  was "seeded with real Bay Area marinas": the live table has **3 rows**.

---

## 1. What this is

A marina account accumulates a roster of the vessels berthed there, built
entirely from owners opting in. When a signed-in marina user scans the
badge of a vessel that has shared with them, the profile renders the
marina view. Same badge, different view, decided by who is holding the
phone.

The roster is the by-product. The moment that matters is the scan.

---

## 2. Decisions

### 2.1 Verification is dissolved, not solved

No credential check, no verified-marina registry. The owner decides who
their harbormaster is. If they share with the wrong party they have
exposed one boat — their own. A verified registry that is wrong once
exposes every vessel at that marina.

### 2.2 Field set: contact, emergency contact, and documents — not status

The marina view shows:

| row | source | if empty |
|---|---|---|
| **Owner contact** — name, phone, email | same sources as `filterVesselForRole`'s owner fields | each missing item says "Not provided" |
| **Emergency contact** — name, phone, relationship | `emg_name`, `emg_phone`, `emg_relationship` | **"No emergency contact on file"** — the row is never hidden |
| **Slip number** | `slip_number`, as the owner entered it | "No slip number given" |
| **Registration document** | `doc_registration_url`, if the owner included it | see below |
| **Insurance document** | `doc_insurance_url`, if the owner included it | see below |

**Why documents, not status.** A typed expiry date is a self-attested
claim the harbormaster can't verify; an owner whose cover has lapsed can
type whatever the marina requires. Harbormasters want the certificate on
file. Status is a tool for the owner managing their own renewals; evidence
is what a third party needs.

**Each document row has three states, all stated plainly:**

- *Included and on file* — "View" opens the document. If the owner entered
  an expiry (`reg_expiry` / `ins_expiry`) it shows beside it, **labelled
  "Expiry entered by owner"** — same principle as `logged_at` on service
  records: we can't verify the claim, but we can be honest about its
  source.
- *Included, nothing uploaded* — "No insurance document on file." That is
  the nudge, delivered by the harbormaster rather than by us.
- *Not included* — "Not shared with you." Shown rather than hidden, so the
  harbormaster never has to guess whether a missing row is absent or
  withheld. (The draft's §2.2 reasoning, kept.)

**Slip number added 2026-09-18**, for the roster's first job — finding one
boat on a dock by name or slip. It is the marina's own assignment, entered
by the owner. No grant existed when it was added, so no owner agreed to a
set without it; every "what they'll see" line (join page, owner panel,
poster) says slip number.

**Nothing else.** Not slip notes, not liveaboard status, not the lockbox
`access_note`, not HIN or USCG numbers, not the structured insurance
fields. This is **its own projection** (`lib/marina-view.ts`), not the
share filter and not `filterVesselForRole("marina")`, which is wrong in
both directions (no emergency contact; leaks `slip_notes`,
`is_liveaboard`, `ins_carrier`). That branch is reduced to calling the new
projection so there is one answer to "what does a marina see".

### 2.3 Account per marina, not per person

Access is granted to a marina; staff attach to it (§5.2). A departing
harbormaster must not walk away with a tenant directory.

### 2.4 No expiry — revocation only

Access ends when the owner revokes it, or when the vessel changes owner
(§4.1). No expiry: an expiring roster decays invisibly and a wrong
directory is still trusted.

**Marina-change prompt.** When an owner edits `marina_name` on a vessel
with active marina access, the save offers: *"You've changed Polaris's
marina. Remove Emery Cove Marina's access?"* A prompt, not an automatic
revocation — a typo fix must not silently cut access.

### 2.5 Unilateral grant, silent revocation

No accept step and no notification either way. The owner's confirmation
copy carries the honesty: **"Emery Cove Marina will see these details when
their staff scan your badge. They are not notified."** Revocation simply
removes the vessel from the roster.

---

## 3. The join code

Each marina account gets a code. Ben creates the account when he signs a
marina up and leaves a poster for the office; a tenant enters the code to
grant access. **The code resolves directly to one `marinas` row**, so there
is nothing to match, and vessels whose `marina_id` is null (nearly all of
them) are not blocked.

### 3.1 Shape

- `marinas.join_code` — 8 characters from an alphabet without look-alikes
  (no `0 O 1 I L`), shown as `XXXX-XXXX`, case-insensitive on entry,
  unique, **stored in plain text**.
- Plain text, unlike the transfer link's `token_hash`, because the
  property is different. A transfer token is a secret that moves a boat;
  a join code is printed on a poster in a public office. Hashing it would
  only stop us re-printing the poster. What protects the owner is §3.3.
- Regenerating a code (a poster went somewhere odd) changes the code only.
  Existing grants are keyed on `marina_id` and are unaffected.

### 3.2 Flow — following the transfer-link pattern

`/transfer/accept?token=` is the model: resolve server-side, preview
before any write, round-trip through sign-in, confirm with a button, and
let the RPC re-verify everything.

1. **Entry.** `/marina/join` — a code field. The poster also carries a QR
   to `/marina/join?code=XXXX-XXXX`, which pre-fills it.
2. **Resolve and preview.** An unknown code gets a plain terminal message
   ("That code doesn't match a marina on Moxie. Check the poster, or ask
   the marina office."). A known one shows **the marina's name and city
   before anything else**.
3. **Sign in** if needed, returning to the same URL (`next=`), as the
   transfer page does.
4. **Choose.** The owner's active vessels, and for each chosen vessel two
   checkboxes: *Include registration document*, *Include insurance
   document* — each noting whether a document is actually on file, so the
   owner sees the harbormaster's "No insurance document on file" before
   the harbormaster does. Contact and emergency contact are always
   included; that is what the grant is.
5. **Confirm** with the §2.5 copy. Server action → `grant_marina_access`
   RPC, which re-verifies ownership, that the vessel is active, and that
   the code still resolves.

Re-entering a code for a vessel that already has active access **updates
the two document choices** rather than creating a second row (the
partial unique index enforces one active row per marina–vessel pair).

### 3.3 What a wrong or guessed code can do

Grant one owner's own data to a marina they didn't intend. Step 2's name
preview is what stops that; it is the whole defence and it is enough,
because the blast radius is the owner's own boat (§2.1). A guessed code
reveals a marina's name and city — public facts about a business.

---

## 4. Interactions

### 4.1 A change of owner revokes marina access — required

Marina access carries the **previous owner's** contact, emergency contact
and documents. It must not survive a transfer.

`complete_ownership_transfer` is one path that changes `vessels.owner_id`;
the admin reversal is another. See §9.1 for how this is enforced.

### 4.2 Dormant vessels (lapsed, locked)

The roster row stays, shown as **"Access paused"**. The detail view is
withheld **except emergency contact**, which stays visible. A marina's
need to reach someone is highest when the owner has disengaged; gating a
phone number behind billing is wrong for a safety-adjacent product.

Owner contact and documents are withheld while dormant — documents
already are for the owner too (dormant identity spec §3, enforced in the
documents route).

On scan, a marina user with access sees the existing dormant screen plus
an emergency-contact block. Everyone else sees the dormant screen as now.

### 4.3 Decommissioned vessels

Excluded from the roster and the marina view by reading
`lifecycle_status`. **No revocation write** — this avoids touching the
decommission function, and a decommissioned vessel cannot come back to a
berth.

### 4.4 Pending activation

Unchanged: the existing "Not yet active" screen. A grant can't exist —
`grant_marina_access` refuses vessels whose `qr_status` isn't active.

### 4.5 The existing `marina` share preset

Left alone. It is a share-link preset producing a URL, not this feature,
and it is not a route to marina access. Its name will confuse; renaming it
is out of scope for v1.

---

## 5. The marina side

### 5.1 Creating a marina account — `/admin/marinas`, built 2026-09-18

Create + issue code in one form; reissue with a confirm; attach staff by
email (if they have no `users` row yet — signing up doesn't make one — the
Auth account is looked up, a read, and the row created).

**Poster:** a **Download poster** button on each marina (2026-09-21), for
signing one up in person — a terminal command on a Mac is no use in a
marina office. `npm run marina-poster -- <CODE>` (or `--all`) remains for
batches. Both call `lib/marina-poster-pdf.ts`, so both produce the same
file: a US Letter vector PDF drawn with pdf-lib, brand faces embedded from
base64 (no browser, which is what let it move to Vercel). The script
refuses a file unless it is one page at 612x792, DM Sans and Cormorant
Garamond are embedded, and the QR decoded from a rendering of the PDF is
the join URL; the tests check the same three.

By Ben, by hand, on request. No self-serve signup. An admin page
(`/admin/marinas`) lists marinas, creates one, and generates or
regenerates its join code, with a printable poster (code, QR, one line of
instruction).

### 5.2 Attaching staff

A staff member signs up for an ordinary Moxie account; an admin attaches
it to the marina by setting `users.marina_id`. All staff see the same
roster; no per-staff permissions. A leaver is detached by clearing
`marina_id`. **No Supabase Auth writes** — accounts are created by the
people who use them. Staff-managed invitations are not in v1.

### 5.3 The roster (`/marina`) — built 2026-09-18

As built: search first (vessel name or slip, forgiving "B-12"/"b12"), two
flag filters — **no emergency contact** (no phone on file) and **no
documents** (none the marina can open) — alphabetical with numbers in
order, paused rows kept. The empty state is the day-one screen: how boats
arrive, the code to hand out, what the marina will have. No pagination:
the whole list filters client-side, which is what makes search instant
on a weak dock signal; revisit past ~500 rows.

The original plan below is kept for the reasoning.

- Search by vessel name, MXE ID or owner name.
- One row per vessel: name, MXE ID, owner name, and three plain markers —
  emergency contact, registration, insurance — each *on file*, *missing*
  or *not shared*. "Access paused" for dormant vessels.
- Default sort: rows with something missing first, then alphabetical.
- Filter by marker ("every vessel with no insurance document").
- Paginated past 100.
- No map, no occupancy. The marina's slip system is theirs, not ours.

### 5.4 Document viewing

The owner's documents route, `/api/vessels/[mxeId]/documents/[docType]`,
gains a **second audience**: a signed-in user whose `marina_id` has an
active `marina_vessel_access` row for the vessel, with that document
included, for `registration` or `insurance` only. The owner path is
unchanged. The dormant suspension and the tier lock apply to both
audiences in the same place. The decision lives in a shared helper
(`lib/marina-access.ts`), not in the route. Viewed in the existing
`DocumentViewerModal`.

---

## 6. The scan

### 6.1 Resolving the viewer

The scan branch in `[mxeId]/page.tsx` today resolves `owner` or `public`.
It gains `marina`: a signed-in user with a `marina_id` whose marina has
active access to this vessel. `ScanSuccess` then lands on `?role=marina`.

`?role=marina` is **not authorization** — the page re-derives it on every
render, exactly as `?role=owner` does. Without active access it renders
the public profile.

### 6.2 What renders

| scanned vessel | marina user with access | marina user without access | anyone else |
|---|---|---|---|
| pending activation | "Not yet active" | "Not yet active" | "Not yet active" |
| dormant (lapsed / locked) | dormant screen **+ emergency contact** | dormant screen | dormant screen |
| decommissioned | decommissioned screen | decommissioned screen | decommissioned screen |
| active | **marina view** | **public profile + banner** | public profile |

### 6.3 Not shared with this marina

There is no "not on Moxie" state: if a badge was scanned, the vessel is
registered. The only distinction is shared with this marina or not. The
banner, shown only to a signed-in marina user:

> **Not shared with Emery Cove Marina.** The owner hasn't shared their
> contact details with you. Ask them to enter your marina's code.

It discloses one fact the public profile doesn't: that *this* marina has
no access — a fact about the marina's own relationships. It says "not
you", never anything about other marinas.

---

## 7. Data

```
marinas.join_code         TEXT UNIQUE          -- null until generated

marina_vessel_access
  id                 UUID PK
  marina_id          UUID NOT NULL REFERENCES marinas(id)
  vessel_id          UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE
  granted_by         UUID NOT NULL REFERENCES users(id)
  share_registration BOOLEAN NOT NULL
  share_insurance    BOOLEAN NOT NULL
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  revoked_at         TIMESTAMPTZ               -- NULL = active
  revoked_reason     TEXT CHECK (revoked_reason IN ('owner', 'owner_changed'))

UNIQUE INDEX (marina_id, vessel_id) WHERE revoked_at IS NULL
```

RLS on, no policies: every read and write goes through the service role
behind the checks in §5.4 and the RPCs. Revoked rows are kept, not
deleted — they are the history of who had access.

Functions (new, each with the revoke-from-`PUBLIC`/grant-to-`service_role`
pattern and a guard block, per CLAUDE.md):

- `grant_marina_access(p_owner_id, p_vessel_id, p_join_code, p_share_registration, p_share_insurance)`
  — refuses with distinct `MX0xx` codes for: unknown code, not the owner,
  vessel not active. Inserts or updates the active row.
- `revoke_marina_access(p_owner_id, p_access_id)` — refuses if not the
  owner; guarded on `revoked_at IS NULL`, so only the changing call
  reports a change.

---

## 8. Build order

1. Migration file (not executed): `join_code`, table, index, two RPCs, the
   §9.1 revocation.
2. `lib/marina-view.ts` projection and `lib/marina-access.ts` helper, with
   tests. The app tolerates the table not existing yet (`PGRST205` /
   `42P01`) as "no marina access" — a missing table must not 500 a public
   scan.
3. Documents route second audience.
4. Scan resolution, `?role=marina` branch, banner, dormant emergency
   contact.
5. `/marina/join` and the grant action.
6. Owner's vessel page: marinas with access, change documents, revoke;
   marina-change prompt.
7. `/marina` roster.
8. `/admin/marinas` and the poster.

---

## 9. Proposals for review

### 9.1 Enforce the transfer revocation with a trigger, not by editing `complete_ownership_transfer`

A trigger on `vessels` — `AFTER UPDATE OF owner_id`, when the value
actually changes — revokes the vessel's active marina access with
`revoked_reason = 'owner_changed'`.

It covers every path that changes an owner: `complete_ownership_transfer`,
the admin reversal, and anything added later. Adding a statement to
`complete_ownership_transfer` covers one. It also means **no function body
is replaced**, which removes the risk CLAUDE.md records from `20261005`.

If you'd rather it live in the function: I'd need its `pg_get_functiondef`
**after `20261006` has run**, because that migration replaces the body and
this one must be built from whatever is live when it runs.

### 9.2 Staff membership is `users.marina_id`, not `role = 'marina_operator'`

`users.role` is a single value. A harbormaster who also owns a boat —
likely common — can't be both `owner` and `marina_operator`. Deciding
membership by `marina_id IS NOT NULL` lets one account be both, and leaves
`role` meaning what it means now. The live demo account
(`demo-marina@moxieyachting.com`) has both set, so it works either way.

---

## 10. Noticed, out of scope

- `coastguard` is still in `ProfileRole` and `user_role`; the audience left
  the marketing home 2026-09-17.
- `demo-marina@moxieyachting.com` has a placeholder `users.id`
  (`…0010`) — the owner-id mismatch in project memory. Check before using
  it as the test account.
- Granting could fill `vessels.marina_id` as a side effect, gradually
  fixing the free-text `marina_name` problem. Not in v1: it changes what
  the public profile shows.
- **The live marketing home now plans something this spec dropped.**
  `MoxieMarketingHome.tsx:242–243` says marina staff will see "insurance
  and registration status" and lists "Planned: insurance and registration
  status". Its "today, an owner can share those details with their marina
  through a Trusted Contact link" was already an overclaim: no share flag
  exposes insurance status (`filterVesselForShare` excludes it under every
  flag). Needs a copy decision; not changed here.
