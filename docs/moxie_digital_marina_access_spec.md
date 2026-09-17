# Moxie Digital — Marina operator role-gated access

**Status: specified, not built (2026-09-17).** Design settled; three items
inside are proposals awaiting a decision and are marked as such.

Related: [`moxie_digital_marina_registry_spec.md`](moxie_digital_marina_registry_spec.md)
is a *different* feature — marina records as a CRM seed, for internal
sales use. This spec is the customer-facing role view. They meet at one
table (`marinas`) and nowhere else.

---

## 1. What this is

A marina account accumulates a roster of the vessels berthed there, built
**entirely from owners opting in**. When a signed-in marina user scans the
badge of a vessel that has shared with them, the profile renders the
marina view.

Same badge, different view, decided by who is holding the phone. That is
the patent claim doing real work rather than being asserted on a marketing
page, and it is the reason to build this one before other role views.

**The dashboard roster is the by-product, not the product.** It exists
because access has to be listable and revocable; the moment that matters
is the scan at the end of a dock.

---

## 2. Decisions already made

Recorded with the reasoning, because the reasoning is the part that gets
lost. Not open for re-litigation during the build.

### 2.1 Verification is dissolved, not solved

There is **no credential check and no verified-marina registry**. The
owner decides who their harbormaster is.

Every "verify the marina" design ends in the same place: someone has to
adjudicate who really runs a marina, on what evidence, with what appeal.
That is an operations department, not a feature. Dissolving it costs
almost nothing, because the blast radius of a mistake is bounded: **if an
owner shares with the wrong party, they have exposed one boat — their
own.** Compare a verified registry, where being wrong once exposes every
vessel at that marina.

This is also why the field set is fixed (§2.2). A fixed set is what keeps
the worst case to "the wrong person learned my phone number and insurance
expiry", which is roughly what handing over a business card at the dock
office already does.

### 2.2 Fixed field set, not owner-configurable

The marina view always shows exactly:

- **owner contact** — name, phone, email
- **emergency contact** — name, phone, relationship
- **insurance status** — carrier and expiry
- **registration status** — number and expiry

One decision for the owner ("share with my marina: yes"), one known answer
for the harbormaster ("this is what a shared boat shows me"). A
configurable set means the harbormaster never knows whether a missing
field is absent or withheld, which makes the whole view untrustworthy at
exactly the moment it is needed.

**The existing marina share preset does not match this. See §3 — this is
the largest single piece of work in the build, and it is not wiring.**

### 2.3 Account per marina, not per person

Access is granted to a **marina**, and staff attach to that marina
(§6.2).

Larger marinas have several staff and real turnover. A personal login
would mean a departing harbormaster walks away with a populated directory
of every tenant's contact details and insurance dates, and the owners who
granted it have no way to see that, let alone stop it. Per-marina
revocation is also what an owner expects the control to mean: they think
they are sharing with *the marina*.

### 2.4 No expiry — revocation only

Marina access **never expires**. It ends when the owner revokes it, and
at ownership transfer (§5.1).

An expiring roster decays invisibly. The harbormaster cannot tell which
boats dropped off — absence looks identical to "never shared" — and the
owner has nothing prompting them to re-share, because nothing happened to
them. The directory becomes quietly wrong, which is worse than not having
one: a wrong directory is still trusted.

**Instead, prompt at the moment the relationship actually ends.** When an
owner changes the vessel's `marina_name` (or its `marina_id`) and marina
access is active, ask whether to revoke the old marina's access. That is
the real signal — a boat that moved berth — and it arrives exactly when
the owner is already thinking about it.

### 2.5 Revocation is silent

No notification to the marina. The roster simply refreshes and the vessel
is gone.

The marina is not a paying customer and did not ask for the row. Per-tenant
churn notifications would be noise arriving weekly at a busy marina, and
the only action they could prompt — "ask the owner why" — is a
conversation the marina can have at the dock without our help. The owner
is not informing a counterparty; they are withdrawing their own data.

---

## 3. The field set does not exist yet

**Checked against the code, 2026-09-17.** Neither existing definition
matches §2.2, and the gaps are not cosmetic.

### 3.1 `PRESET_FLAGS.marina` in `lib/share-filter.ts`

```
marina: { location: true, contact: true, docs: false, ownership: false, access: true, service: false }
```

Resolved through `filterVesselForShare`, that yields: marina name/city,
storage type and description, slip number, marina phone, **owner name and
phone**, and the share's `access_note`.

| §2.2 requires | preset gives | gap |
|---|---|---|
| owner contact | name, phone | **no email** |
| emergency contact | — | **no flag exposes `emg_*` at all** |
| insurance status | — | **no flag exposes `ins_carrier` / `ins_expiry` at all** |
| registration status | — | needs `ownership: true`, which also discloses HIN, USCG doc number and official number |

It also *adds* `access_note` — the lockbox or gate code — which is not in
the fixed set and should not be.

The insurance gap is structural, not an oversight. `filterVesselForShare`
deliberately excludes the structured insurance fields under every flag:
`docs` releases the uploaded *files*, and a comment in that function
records that `ins_carrier`/`ins_policy` "stay excluded regardless of this
flag". Marina access needs insurance **status** — carrier and expiry, not
the policy document. That is a field group share links have never had.

### 3.2 `filterVesselForRole("marina")` in `lib/vessel-service.ts`

Closer, and the roadmap has been treating it as the definition of the
marina view. It gives owner name/phone/email, `ins_carrier`, `ins_expiry`,
`reg_number`, `reg_expiry`, plus slip number, marina phone, `is_liveaboard`
and `slip_notes`.

Still wrong in both directions: **no emergency contact**, and it adds
`slip_notes` and `is_liveaboard`, which are the owner's private notes
about their own berth.

### 3.3 What the build must do

Introduce the marina field set as **its own definition**, not a preset on
the share flags. Recommended: a `MARINA_VIEW_FIELDS` projection beside
`filterVesselForRole`, with `filterVesselForRole("marina")` reduced to
calling it, so there is exactly one answer to "what does a marina see".

Then update the marketing copy's planned bullets, which currently promise
what `filterVesselForRole` shows — they will be right about insurance and
registration and silent about emergency contact.

---

## 4. What exists, and what is new

Asked directly, so: **most of the auth and data scaffolding exists; the
relationship object does not.**

### 4.1 Already in place

| | |
|---|---|
| `marinas` table | id, name, city, state, region, phone — seeded with real Bay Area marinas |
| `user_role` enum | already includes `marina_operator` |
| `users.marina_id` | FK to `marinas`, commented "set if marina_operator" |
| a demo operator | `demo-marina@moxieyachting.com`, role `marina_operator`, attached to Emery Cove |
| `vessels.marina_id` | the join `filterVesselForRole` already reads for marina name |
| `ProfileRole` | `"public" \| "owner" \| "marina" \| "coastguard"`, accepted by `/api/vessels/[mxeId]` |
| the scan branch | `[mxeId]/page.tsx` already resolves a role at scan time and renders accordingly |

So the plumbing for "signed-in user with a role sees a different view" is
built and unused. Not vapour — but also never exercised, so expect it to
be wrong in small ways on first contact.

### 4.2 What is new

**Today a share is an anonymous token.** `vessel_shares` holds a
`token_hash`, field flags, an optional expiry and `revoked_at`. There is
no account on the other end — whoever holds the link is the audience, and
the row cannot answer "who is this shared with" beyond a free-text label.

A marina roster needs the opposite: a **named, persistent relationship
between two accounts**, with no token and no link.

Proposed new table:

```
marina_vessel_access
  id           UUID PK
  marina_id    UUID NOT NULL REFERENCES marinas(id)
  vessel_id    UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE
  granted_by   UUID NOT NULL REFERENCES users(id)   -- the owner at grant time
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  revoked_at   TIMESTAMPTZ                          -- NULL = active
  revoked_by   UUID REFERENCES users(id)
  revoked_reason TEXT                               -- 'owner' | 'transfer' | 'marina_changed'
  UNIQUE (marina_id, vessel_id) WHERE revoked_at IS NULL
```

This is deliberately **not** a `vessel_shares` row with a marina column
bolted on. The two objects differ in every property that matters: no
secret, no expiry, no view counting, revocation semantics that differ
(§2.4, §2.5), and a field set that is fixed rather than per-share.
Overloading `vessel_shares` would mean every existing share code path
grows a "but not if it's a marina" branch.

**How much of this is wiring?** The scan path, the role resolution and the
marina user account are wiring. The field set (§3), this table, the
dashboard (§6.3) and the transfer interaction (§5.1) are new.

### 4.3 Is there an "accept" step? — **decision needed**

The prompt frames this as the marina *accepting* a share. Two shapes:

- **Unilateral grant (recommended).** The owner shares; the row is
  created active; the vessel appears in the marina's roster. There is
  nothing for the marina to decide — they cannot meaningfully decline a
  tenant's contact details, and an unaccepted queue is just a second
  inbox for a party who is not a customer.
- **Grant then accept.** The row starts `pending`; the marina confirms.
  Buys one thing: proof the marina actually uses Moxie before the owner
  believes they are covered. Costs a state, a queue and a way for an
  owner's share to sit unnoticed forever.

Recommendation: unilateral, with the owner's confirmation copy carrying
the honesty instead — "This marina will see your details next time they
scan your badge. They are not notified."

---

## 5. Interactions with things that already exist

### 5.1 Ownership transfer must revoke marina access — **required**

`complete_ownership_transfer` clears the seller's insurance, boater card,
fishing licence, contact details and mailing address, and revokes every
`vessel_shares` row. Marina access is exactly the same class of data: the
**previous owner's** contact and emergency details.

It must revoke `marina_vessel_access` for the vessel in the same
statement, with `revoked_reason = 'transfer'`. The buyer re-grants if they
want to, which is correct — the buyer may not even berth there.

⚠️ **Build note.** That function's body must be taken from
`pg_get_functiondef` against the live database, never from a migration
file or from memory. Rebuilding it from a file is how `20261005` shipped a
body that silently dropped the webhook-idempotency guard and the whole
`ownership_history` block. See CLAUDE.md, "Replacing a function body".

### 5.2 Dormant and lapsed vessels — **decision needed**

A vessel goes dormant when the owner's subscription lapses or their vessel
count exceeds the plan. Two defensible answers:

- **Suspend the marina view**, matching how document access is suspended
  for dormant vessels (dormant identity spec §3). Consistent, and keeps
  a lapsed account from continuing to deliver value.
- **Keep it**, on the grounds that a marina's need to reach an owner is
  *highest* when that owner has stopped paying attention — an unpaid slip
  and an unpaid subscription tend to be the same boat.

Recommendation: **suspend the detail view, keep the roster row**, shown as
"Access paused". The marina learns there is something to chase without
being handed data from a lapsed account, and the owner has a reason to
come back. Flagged rather than settled because it trades a real safety
argument against a consistency one.

### 5.3 Decommissioned vessels

Drop out of the roster entirely. A decommissioned vessel is retired, its
identity preserved but its berth gone; leaving it in a slip directory is
simply wrong. Revoke with `revoked_reason = 'decommissioned'` so the
history is legible.

### 5.4 The marina-change prompt (§2.4)

Where `marina_name` / `marina_id` is edited on a vessel with active marina
access, the save path offers: *"You've moved Polaris to Marina Plaza
Harbor. Revoke Emery Cove Marina's access?"* Default is **revoke**; the
owner can decline.

This is a prompt, not an automatic revocation — a marina name can be
corrected for a typo, and silently cutting access on a spelling fix is the
invisible-decay failure §2.4 exists to avoid, pointed the other way.

---

## 6. The marina side

### 6.1 Creating a marina account

**By us, by hand, on request.** No self-serve marina signup.

There is no verification step (§2.1), so a self-serve flow would let
anyone create "Emery Cove Marina" and wait for a tenant to mis-click. Us
creating the account is not verification either — but it puts a person in
the loop at the only moment where a mistake is cheap to catch, and the
volume is low enough for a long time that this is not a bottleneck.

Concretely: an admin creates the `marinas` row (many already exist) and a
`users` row with `role = 'marina_operator'` and `marina_id` set. That is
two inserts and no new mechanism.

### 6.2 Attaching staff

Additional staff are additional `users` rows with the same `marina_id`.
They all see the same roster; there are no per-staff permissions.

Removing a leaver is deleting or demoting their user row, which is exactly
the behaviour §2.3 is protecting: access belongs to the marina, so it
survives the person and ends with the account.

**Not in v1:** marina-managed staff invitations. Adding a colleague means
asking us. This will be the first thing a real marina asks for, and it is
the right thing to defer until one has actually used the roster.

### 6.3 The dashboard at 100+ vessels

A roster is a list, and the failure mode is a wall of boats. At 100+:

- **Search first**, by vessel name, MXE ID or owner name. The harbormaster
  almost always arrives knowing which boat they mean.
- **One row per vessel**: name, MXE ID, slip number, owner name, and two
  status chips — insurance and registration — each *current*, *expiring*,
  or *expired*. The chips are the reason to open the page at all rather
  than the phone book.
- **Default sort: attention first** — expired, then expiring, then the
  rest alphabetically. A flat alphabetical list at 300 boats tells a
  harbormaster nothing.
- **Filter by status**, so "show me every expired insurance" is one click.
  That is the marina's actual recurring job.
- **Pagination or virtualisation past ~100 rows.**
- **No map, no occupancy view.** Slip occupancy was cut from the marketing
  copy for being in no spec and no code; it stays cut here. The marina
  knows who is in which slip — that is their system of record, not ours.

### 6.4 What a marina user sees scanning a vessel that has not shared

Four outcomes, and the point is that **three and four are distinguishable**
so every scan becomes a prompt to ask the tenant.

| scan | what renders |
|---|---|
| not a Moxie badge / unknown token | the existing badge-not-recognised 404 |
| Moxie badge, vessel not yet activated or decommissioned | the existing pending / no-longer-active states |
| **Moxie badge, active, not shared with this marina** | **the public profile, plus a marina-only banner** |
| Moxie badge, active, shared with this marina | the marina view |

The banner, shown only to a signed-in marina user:

> **Not shared with Emery Cove Marina.** This vessel is registered with
> Moxie, but its owner hasn't shared their contact and insurance details
> with you. Ask them to add you from their dashboard.

**Leak analysis.** It discloses two things. First, that the vessel is
registered with Moxie — which the badge physically on the hull already
tells anyone who looks, and which the public profile already confirms.
Second, that this owner has not shared with *this marina* — a fact about
the marina's own relationships, not about the owner's data. Nothing in the
banner is unavailable to an anonymous scanner except the second fact,
which is the marina's own.

What it deliberately does **not** do is tell the marina anything about
*other* marinas the vessel has shared with, or that the vessel's owner
exists as a named person. It says "not you", never "not anyone".

---

## 7. Open questions for the build

1. **Accept step or unilateral grant** (§4.3). Recommendation: unilateral.
2. **Dormant vessels: suspend or keep** (§5.2). Recommendation: suspend
   the detail view, keep the roster row as "Access paused".
3. **Where the owner grants it.** The share sheet is the obvious home, but
   marina access is not a share link — no token, no expiry, different
   revocation. It may belong as its own control on the vessel page
   ("Share with your marina") rather than a fifth preset in a sheet whose
   every other option produces a URL.
4. **Which marina.** Granting requires picking a `marinas` row. Vessels
   today mostly carry free-text `marina_name` with `marina_id` null — the
   marina registry spec §5 flags the same migration problem. If an owner's
   marina has no account, the control should say so plainly rather than
   offering a grant that goes nowhere.

---

## 8. Noticed, out of scope

- **`coastguard` is still in `ProfileRole` and `user_role`.** The audience
  was removed from the marketing home 2026-09-17. Harmless, but nothing in
  the code will now tell you it is unused.
- **`demo-marina@moxieyachting.com` has a placeholder `users.id`** (the
  owner-id mismatch noted in the project memory). It is the natural first
  test account for this feature and will need checking before it is used
  as one.
