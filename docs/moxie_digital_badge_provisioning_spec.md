# Moxie Digital — Badge Provisioning & Pre-Minted Inventory

### Build spec · moving from per-order badge generation to pre-printed stock

**Status:** Planned, not built. No code or migration written.
**Revision:** Amended after first review. §1 and §2 approved as written. Amendments: two physical badges per identity (§1.6, threaded through §3/§5); re-binding prohibited (§4.1); scan-at-pack deferred (§4.1); pool-exhaustion behaviour decided (§3.2); print-shop export explicitly blocked (§5.3); `/s/<token>` → ScanSuccess wiring specified (§1.7); transfer/decommission behaviour specified (§2.5).
**Touches:** `lib/qr-render.ts`, `lib/badge-layout.ts`, `lib/mxe-id.ts`, `dashboard/new/actions.ts`, `admin/stickers`, the public `[mxeId]` route, and a new `/s/<token>` route.
**Related:** `docs/moxie_digital_dormant_identity_spec.md` (identity permanence), `docs/moxie_digital_acceptance_tests.md` (QR print math).

---

## 0. What already exists

Read before proposing anything, per the brief. This is the current state, not a proposal.

### 0.1 MXE ID allocation — already correct for this change

`20260904_mxe_id_sequence.sql` replaced a `MAX(mxe_id)`-derived ID with a real Postgres sequence (`mxe_id_seq`), explicitly so that **an ID is never reused, including after a delete**. Its own header states the reason in exactly the terms this spec needs: *"a badge already in circulation could come to point at a different boat."*

- `next_mxe_id()` calls `nextval()` — atomic, non-reusing, doesn't roll back.
- Sequence starts at **1001**. Anything below `MXE-01000` is test-era; `MXE-01001`+ is real.
- Raises if it would exceed 5 digits (99,999 ceiling).
- The JS `MAX(mxe_id)` fallback was deliberately removed — it throws instead.

**Implication:** the minting mechanism this spec needs already exists and is already concurrency-safe. Pre-minting a block of 100 is 100 `nextval()` calls. Nothing about the allocator needs to change.

**Also already true:** the brief's constraint that `MXE 00001–01000` stays the admin-assignable block is already enforced by the sequence's start value. Minting must never `setval()` backwards into that range.

### 0.2 Badge rendering

| Piece | File | Notes |
|---|---|---|
| Layout fractions | `lib/badge-layout.ts` | Single source of truth. `qrSize: 0.62`, 3″ at 600 DPI = 1800px. |
| Badge text | `lib/badge-layout.ts` | `BADGE_TEXT.scanLabel(mxeId)` → `"Scan · MXE-01015"` |
| SVG renderer | `lib/qr-render.ts` → `buildBadgeSvg` | On-screen + print view |
| PNG renderer | `QrDownload.tsx` | Canvas; shares layout numbers only |
| Version guard | `lib/qr-render.ts` → `assertBadgeQrVersionWithinBudget` | `MAX_BADGE_QR_VERSION = 5`, throws at render time |
| Quiet zone | `qrFragment` | `QR_QUIET_MARGIN = 2` module-units |

The version guard's own comment is the governing constraint for §1: *"badges are physical and permanent — there's no 'push a fix' once one is printed and stuck to a hull."*

**The badge face already carries no vessel-specific text.** Wordmark, QR, divider, `"Registered Vessel"`, `"Scan · MXE-XXXXX"`, `"Patent Pending"`. The only per-badge variable is the MXE ID and the QR itself — which is precisely what makes pre-minting viable. The brief's premise checks out against the code.

### 0.3 Current encoded URL

Assembled in exactly one place, `dashboard/[mxeId]/qr/page.tsx`:

```
https://moxieyacht.com/MXE-01015?scan=1        39 chars → version 5 → 37×37
```

`?scan=1` routes into `ScanSuccess`'s animation rather than landing silently on the public profile.

### 0.4 Existing status vocabulary — do not duplicate

| Column | Table | Values in use |
|---|---|---|
| `qr_status` | `vessels` | `pending_payment`, `active` |
| `lifecycle_status` | `vessels` | `active`, `dormant`, `decommissioned` |
| `dormant_cause` | `vessels` | `lapsed`, `locked` (+ decommissioned via lifecycle) |
| `sticker_order_status` | `vessels` | `not_ordered`, `ordered`, `printed`, `shipped` |

§2 reconciles against these rather than inventing parallels.

### 0.5 Existing fulfillment queue

`admin/stickers` — server component querying `vessels` where `qr_status = 'active'`, excluding `sticker_order_status = 'shipped'` by default. Columns: MXE ID, Vessel, Owner, Ship to, Owner email, Paid, Status. Status is an inline dropdown writing `sticker_order_status`.

**Structural limitation for this change:** the queue is driven entirely off `vessels`. Un-assigned inventory has no vessel row, so it is invisible to this screen by construction. §5 adds a sibling view rather than bending this one.

### 0.6 Identity permanence guarantees already committed to

From the dormant identity spec §1/§3, these are binding on anything below:

- An MXE ID is *"never reused, never revoked, and its public page always resolves."*
- A dormant vessel keeps its public profile at `moxieyacht.com/MXE-XXXXX`.
- Only `qr_status = 'active'` consumes a vessel-cap slot; dormant/decommissioned do not.

---

## 1. URL structure and QR capacity

### 1.1 Measured capacity, not estimated

Byte mode at ECC level H, measured directly against the `qrcode` library this repo uses:

| Version | Modules | Max chars @ H |
|---|---|---|
| 4 | 33×33 | **34** |
| 5 | 37×37 | **44** |
| 6 | 41×41 | 58 |

Physical module size at 3″ badge × `qrSize 0.62` × (modules + 2×2 quiet zone):

| Version | Units incl. quiet | Module size |
|---|---|---|
| 4 | 37 | **1.277 mm** |
| 5 | 41 | **1.152 mm** |
| 6 | 45 | **1.050 mm** |

### 1.2 Options evaluated

Token shown as a placeholder of the stated length. All measured, not calculated by hand.

| # | Encoded URL | Chars | Ver | Module | Verdict |
|---|---|---|---|---|---|
| — | `https://moxieyacht.com/MXE-01015?scan=1` | 39 | 5 | 1.152 mm | current |
| **A** | `https://moxieyacht.com/MXE-01015?scan=1&t=K7m2Qp9xRt` | 52 | **6** | 1.050 mm | ✗ bumps a version |
| **B** | `https://moxieyacht.com/s/K7m2Qp9xRt` | 35 | 5 | 1.152 mm | ✓ absorbs token, no change |
| **C** | `https://moxieyacht.com/s/K7m2Qp9x` | 33 | **4** | **1.277 mm** | ✓✓ *improves* density |
| **D** | `https://moxieyacht.com/s/01015K7m2Qp9xRt` | 40 | 5 | 1.152 mm | ✓ but token no longer opaque |
| **E** | `https://moxieyacht.com/01015?scan=1&t=K7m2Qp9xRt` | 48 | **6** | 1.050 mm | ✗ dropping `MXE-` isn't enough |
| **F** | `https://www.moxieyacht.com/s/K7m2Qp9xRt` | 39 | 5 | 1.152 mm | ✓ (shows `www.` headroom cost) |

### 1.3 Answering the three specific questions

**Does a dedicated `/s/<token>` route make `?scan=1` unnecessary?**
Yes, and this is where nearly all the savings come from. `?scan=1` costs 7 characters and exists only to tell the app *"this arrival is a physical scan."* A route that only a printed badge ever points at carries that signal in its own existence. Dropping `?scan=1` and `MXE-` together frees 12 characters — more than a 10-char token costs.

**Does dropping the `MXE-` prefix help on its own?**
Not enough. Option E keeps `?scan=1` and still lands at version 6. The prefix is worth 4 characters; the parameter is worth 7. Removing the prefix without removing the parameter solves nothing.

**Can the token alone resolve identity, making the MXE ID display-only?**
Yes, and it should. `/s/<token>` → look up `badge_identities.token` → resolve to vessel (or to an unclaimed state) → render. The MXE ID stays printed on the badge face via the existing `BADGE_TEXT.scanLabel`, where it does real work for humans: reading an ID over the phone to support, matching a physical badge to a queue row during pick-and-pack, and giving a scuffed unscannable badge a fallback the owner can type. It just stops being load-bearing for machine resolution.

This is also what makes unbound distribution possible at all — see §4.2. A pre-printed badge with no account cannot encode an MXE-ID-to-owner relationship that doesn't exist yet, but it can carry an opaque token that a claim later binds.

### 1.4 Recommendation

**Option C, with a 9-character token: `https://moxieyacht.com/s/<9-char-token>` = 34 chars = version 4 = 1.277 mm modules.**

Reasoning:

1. **It absorbs the token and still gets denser modules, not sparser.** 1.277 mm vs today's 1.152 mm is +10.8% per module. On a hull sticker that lives outdoors and gets scuffed, salted, and photographed at an angle from two feet away, larger modules are worth more than they cost.
2. **It removes the only remaining coupling between the printed artifact and the account.** The badge no longer encodes which vessel it belongs to, which is the entire precondition for holding stock.
3. **`/s` is free.** No route currently occupies it (`src/app/` has no `s/`), and `/[mxeId]` is a single-segment dynamic route, so `/s/<token>` cannot collide with it.

**Token format:** 9 characters, Crockford Base32 (excludes `I`, `L`, `O`, `U` to kill transcription ambiguity), stored canonical-uppercase, matched case-insensitively. 32⁹ ≈ 3.5 × 10¹³.

**On collision:** at 1 M badges the birthday probability is ~1.4% — not negligible, and deliberately not being hand-waved. It does not need to be: mint-time generation runs inside a transaction against a `UNIQUE` constraint and retries on conflict, so a collision costs one retry and can never produce a duplicate. The constraint is the guarantee; the entropy only controls how often the retry fires (essentially never).

**On guessability — a deliberate non-goal.** For a *bound* badge the token is not a secret and must not be treated as one. Guessing a valid token gets you a public vessel profile that is already public at `/MXE-XXXXX`. The token's jobs are uniqueness and *unlinkability* — it must not be derivable from the sequential MXE ID, or unsold inventory becomes enumerable. Random, not derived. The genuinely secret value for unbound claiming is a **separate** field; see §4.2, which is the most important boundary in this document.

**Headroom caveat, stated plainly.** 34 characters is exactly the version-4 ceiling. Any lengthening — a `www.` prefix, a longer domain, a 10th token character — pushes to version 5. That is a *graceful* degradation (version 5 is what today's badges already are, and remains within the current print spec), not a failure, but it means:

- `MAX_BADGE_QR_VERSION` should **stay at 5**, not tighten to 4. Version 4 is the design target; version 5 remains the hard ceiling that fails the build. Tightening to 4 buys nothing and turns a harmless future change into a hard stop.
- Each print batch must **record the QR version actually used** (§2), so density is auditable per batch and a mixed-version field population is a known fact rather than a discovery.

### 1.5 Backward compatibility — non-negotiable

`https://moxieyacht.com/MXE-XXXXX?scan=1` **must keep resolving forever.** Badges in that format are already printed, and two are already marked shipped (per the `20260904` migration's own note about test badges). `/s/<token>` is *added*, never a replacement. Both routes render the same page; only the arrival path differs.

---

### 1.6 Two physical badges per identity

**Each MXE ID is printed twice. Both copies carry the same token, resolve to the same vessel, and ship together — one to apply, one spare.**

This does not change anything in §1.1–§1.5. The token, the URL, the QR version and the module size are properties of the *identity*, and both copies are impressions of one artwork file. What it changes is arithmetic, and it changes it in enough places to be worth stating once here and referencing rather than re-deriving:

> **Identity count and physical badge count are not 1:1.** Batch 1 is **100 identities / 200 physical badges**. Anything counting stock levels counts identities; anything counting print output counts badges.

**The two copies are deliberately not individually identifiable.** They carry the same token and the same MXE ID, and nothing distinguishes them — not a serial, not a copy number. This is a design decision, not an oversight: making them distinguishable would mean either two tokens per identity (which defeats "any badge in stock can go to any customer" and doubles the QR-capacity problem) or a visible copy marker on the badge face (which makes the spare look like a lesser object). The consequence is that **the data model cannot and must not track individual physical copies.** `badge_identities` has exactly one row per identity, one `artwork_path`, and one `status`.

That has a specific implication for `void`: it is an **identity-level** state. A single damaged copy does not void the identity — the customer ships with one badge, or the copy is reprinted from the stored artwork (§5.1). Only an identity that can produce no usable badge at all is voided, and voiding still burns the MXE ID permanently.

**What this assumption breaks, flagged:**

| Area | Effect |
|---|---|
| §3.2 low-water thresholds | Count **identities**. 25 remaining = 50 physical badges. Labelling matters or the alarm reads 2× safe. |
| §5.1 artwork | One render, one stored file, per identity. Both copies print from it. No change to the model. |
| §5.3 N-up export | Emits **2 impressions per identity**. Pair layout is load-bearing — see §5.3. |
| §2.3 batch record | `minted_count` (identities) and `printed_count` (badges) are different numbers and must both be stored, plus the ratio that produced them. |
| §4.1 pick-and-pack | Failure surface roughly doubles: two objects per order to keep together, and a picker can now split a pair across two orders. |
| §4.2 unbound claiming | The spare is a second physical object carrying a publicly-scannable token. It changes no capability — the token is already public once the first copy is on a hull — but the **claim code ships once, with the package, never on either badge face**. |
| Packaging | Two 3″ badges per envelope rather than one. Out of scope here, but it is a mailer-spec change. |

### 1.7 How `/s/<token>` carries the scan signal

Dropping `?scan=1` is what buys the density (§1.3), so the route has to carry that signal itself. It does, by redirecting.

**`/s/[token]/page.tsx` resolves the token server-side, then redirects to `/<mxeId>?scan=1`.**

The parameter costs nothing here because it is produced *after* the scan, by the server, and never appears in anything physical. The density budget constrains only what is encoded in the QR.

```
badge QR  →  /s/K7M2QP9XR        (34 chars, version 4 — what's printed)
                    │
                    ├─ status = assigned  →  307 → /MXE-01042?scan=1  →  existing scan branch
                    ├─ status = in_stock  →  render "not registered yet" (200, no redirect)
                    ├─ status = void      →  render "no longer valid"   (200, no redirect)
                    └─ token unknown      →  404
```

**Why a redirect rather than rendering `ScanSuccess` directly at `/s/`:** the scan branch in `[mxeId]/page.tsx` is not just a component render. It sits *after* the payment gate and the dormant dispatch, and it performs its own auth lookup to decide `destinationRole` (owner vs public) and `exitHref`. Reproducing that at `/s/` would be a second implementation of an ordering-sensitive branch — precisely the drift this codebase has already been bitten by (the three divergent pixel-mark copies, the SVG/PNG badge renderers). Redirecting inherits all of it for free and leaves exactly one scan implementation.

**Two specific requirements, both easy to get wrong:**

1. **The redirect must be `307`, and must not be cached.** A `301`/`308` is cached by browsers and intermediaries effectively forever. If an identity is ever re-bound by the explicit admin action §4.1 permits, a cached permanent redirect would keep sending scanners to the old vessel with no way to fix it — on a device we don't control, for a badge that is glued to a hull. The token→vessel mapping is stable in practice but must not be declared immutable to the network.
2. **An unclaimed badge must render, not 404.** A 404 on a physical product reads as a broken product. `in_stock` is a normal state for a badge sitting in a warehouse or a print shop, and scanning one there must produce a calm "this badge hasn't been registered yet" page. It must also not disclose inventory scale — no counts, no batch, no MXE ID beyond what is already printed on the badge in the scanner's hand.

**Side benefit worth keeping:** after the redirect the visitor's address bar shows `/MXE-01042`, which is bookmarkable, shareable, and human-meaningful — better than an opaque token, and it puts the ID the owner will be asked for on screen.

## 2. Data model

### 2.1 A separate table, not pre-created vessel rows

**Recommendation: a new `badge_identities` table. Do not pre-create `vessels` rows for unsold stock.**

This is the single highest-consequence decision here, so the reasoning is concrete rather than aesthetic. Pre-creating 100 blank `vessels` rows would silently corrupt every existing query that counts or classifies vessels:

| Consumer | Breakage |
|---|---|
| `createVessel` cap check | Unsold inventory counts against a customer's 2-vessel Basic limit |
| `admin/page.tsx` totals | Total-vessels metric inflated by warehouse stock |
| `admin/page.tsx` geo breakdown | 100 rows with no storage data → "Unclassified" swamps the chart |
| `admin/stickers` queue | Filtered by `qr_status='active'`, so hidden — but only by accident |
| Owner dashboard | Requires `owner_id`; blank rows have none |

The brief's own note — *"only `qr_status='active'` consumes a slot"* — is satisfied automatically by a separate table, because inventory has no `qr_status` at all until it becomes a vessel.

### 2.2 Reconciling status with the existing vocabulary

The brief lists `pending / assigned / active / dormant`. Two of those already exist on `vessels` and **must not be duplicated**:

> **`badge_identities.status` covers the physical object up to the moment of assignment. `vessels.qr_status` and `vessels.lifecycle_status` cover the identity's service state from that moment on. There is exactly one handoff point and no overlap.**

| Brief's term | Where it actually lives | Notes |
|---|---|---|
| pending | `badge_identities.status` | split into `minted` → `printed` → `in_stock` |
| assigned | `badge_identities.status = 'assigned'` | terminal for this table |
| **active** | `vessels.qr_status = 'active'` | **already exists — do not add** |
| **dormant** | `vessels.lifecycle_status` + `dormant_cause` | **already exists — do not add** |

`badge_identities.status` lifecycle:

```
minted ──▶ printed ──▶ in_stock ──▶ assigned   (terminal)
   │           │           │
   └───────────┴───────────┴────▶ void         (misprint, damage, loss)
```

`void` is required and is not a nicety: badges get damaged in the print shop and lost in transit, and a voided ID must never be re-offered to the assignment query. Consistent with permanent-identity rules, a voided MXE ID is **burned, never recycled** — the sequence already tolerates gaps by design.

### 2.3 Illustrative schema

Illustrative only. Actual migration files are written at build time and run manually by Ben.

```sql
CREATE TABLE badge_identities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mxe_id          TEXT NOT NULL UNIQUE,            -- from next_mxe_id(), never reused
  token           TEXT NOT NULL UNIQUE,            -- 9-char Crockford Base32, canonical uppercase
  status          TEXT NOT NULL DEFAULT 'minted',  -- minted|printed|in_stock|assigned|void
  print_batch_id  UUID REFERENCES badge_print_batches(id),

  artwork_path    TEXT,        -- Storage path, written at mint; never regenerated (§5.1)
  qr_version      SMALLINT,    -- version actually encoded, per §1.4

  printed_at      TIMESTAMPTZ,
  shipped_at      TIMESTAMPTZ,
  assigned_at     TIMESTAMPTZ,
  vessel_id       UUID REFERENCES vessels(id),     -- set only at assignment

  -- Unbound distribution (§4.2). Modelled now, flow NOT built.
  distribution_channel TEXT NOT NULL DEFAULT 'direct',  -- direct|unbound
  claim_code_hash      TEXT,        -- hash only; plaintext exists solely on the physical card
  claim_code_issued_at TIMESTAMPTZ,
  claimed_at           TIMESTAMPTZ,
  claimed_by_user_id   UUID REFERENCES auth.users(id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at       TIMESTAMPTZ,
  void_reason     TEXT
);

-- Drives the assignment query in §3. Partial: only in_stock rows are ever picked.
CREATE INDEX ON badge_identities (mxe_id) WHERE status = 'in_stock';
CREATE UNIQUE INDEX ON badge_identities (lower(token));   -- case-insensitive lookup

CREATE TABLE badge_print_batches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label          TEXT NOT NULL,         -- e.g. "2026-10 run 1"

  -- Identity count and physical badge count are different numbers (§1.6).
  -- Storing the ratio per batch rather than assuming 2 globally, so a
  -- future single-copy or three-copy run is a data fact, not a code change.
  minted_count        INTEGER  NOT NULL,             -- identities.  Batch 1: 100
  copies_per_identity SMALLINT NOT NULL DEFAULT 2,   -- Batch 1: 2
  printed_count       INTEGER  NOT NULL,             -- physical badges. Batch 1: 200

  qr_version     SMALLINT NOT NULL,     -- density of record for this batch
  sheet_pdf_path TEXT,                  -- N-up export (§5.3)
  minted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_to_printer_at TIMESTAMPTZ,
  received_at    TIMESTAMPTZ,
  notes          TEXT
);
```

**`vessels` gains one column:** `badge_identity_id UUID UNIQUE REFERENCES badge_identities(id)`, nullable — null for every vessel created before this change, and for the print-on-demand fallback path in §3.3. The existing `vessels.mxe_id` stays exactly as it is; it is duplicated onto the vessel at assignment rather than being read through the join, so no existing query changes.

### 2.4 Vessel-cap interaction

Nothing to change. Inventory lives outside `vessels`, so it is invisible to every count. At assignment a vessel row is created with `qr_status = 'pending_payment'` — the existing value — and only becomes cap-consuming when the Stripe webhook flips it to `active`, exactly as today.

---

### 2.5 Transfer and decommission

Both are already built. Stating the intended behaviour explicitly rather than leaving it inferred, since both touch a vessel whose badge is physically on a hull.

**Ownership transfer — the `badge_identities` row is untouched.**

`complete_ownership_transfer` reassigns `owner_id` and nulls owner-specific fields, but the vessel row keeps its `id` and its `mxe_id`. The badge on the hull is still that vessel's badge; only the person responsible for it changed. Therefore:

- `badge_identities.vessel_id` still points at the same row and needs no update.
- `assigned_at` is not touched — it records when the badge left inventory, not who currently owns it.
- **No change to `complete_ownership_transfer` is required.** Stated positively because that function has already been re-declared twice in prepared migrations, and each re-declaration of a payment-path function is risk that should only be taken when something actually demands it. Nothing here does.

One field to document rather than change: `claimed_by_user_id` (§4.2, unbound path) records **who originally claimed the badge**, not who owns the vessel now. After a transfer it is history, not current state, and no query should read it as "the owner."

**Decommission — the row is also untouched, and never returns to stock.**

`apply_vessel_decommission` sets `lifecycle_status = 'decommissioned'` and revokes shares; the vessel row, its `mxe_id`, and its public page all persist, per the dormant identity spec §3. The badge keeps resolving, to a dormant page. So:

- `badge_identities.status` stays `assigned`. It does **not** revert to `in_stock`, and this is the important one: returning it to inventory would offer an MXE ID to a new customer while a physical badge bearing that ID is still glued to a hull somewhere. That is the exact failure `20260904_mxe_id_sequence.sql` exists to prevent, arriving by a different door.
- It does not become `void` either. `void` means "this identity never reached a customer." A decommissioned vessel's badge reached one and is still out there.
- The spare copy (§1.6) is dead alongside it. Nothing tracks it, and nothing needs to.

**Dormant (lapsed / locked) is not a badge event at all.** It is a `vessels` state that changes what the public page renders. `badge_identities` has no opinion about it.

---

## 3. Assignment

### 3.1 Concurrency-safe claim

```sql
UPDATE badge_identities
   SET status = 'assigned', assigned_at = now(), vessel_id = $1
 WHERE id = (
   SELECT id FROM badge_identities
    WHERE status = 'in_stock' AND distribution_channel = 'direct'
    ORDER BY mxe_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
 )
RETURNING mxe_id, token;
```

`FOR UPDATE SKIP LOCKED` is the mechanism. Two simultaneous signups take different rows rather than one blocking or both taking the same one; the subquery re-checks `status` under the lock, so the state transition is atomic with the selection. This is the standard Postgres work-queue pattern and needs no advisory lock — the same reasoning `20260904_mxe_id_sequence.sql` already applied when it deleted the advisory lock around ID minting.

**This must run inside the same transaction as the `vessels` insert**, so a failed insert releases the badge back to stock rather than stranding it as `assigned` with a null `vessel_id`. That implies assignment moves into a SQL function (`assign_badge_identity(...)`) called from `createVessel`, not two separate round-trips from the app.

**Ordering by `mxe_id`** means stock is consumed oldest-first, so physical inventory is FIFO and a batch drains before the next begins. This matters for pick-and-pack: the shelf can be worked front-to-back.

### 3.2 Pool exhaustion — decided

Fail closed at the data layer: the `UPDATE` returns zero rows. It must never silently fall through to "mint a new one" inside the same query — that would reintroduce per-order printing invisibly, which is the exact thing this change exists to eliminate.

**Decided: degrade explicitly, do not block signup.**

On zero rows, fall back to the existing mint-on-demand path — `next_mxe_id()`, create the vessel with `badge_identity_id = null` — and flag it loudly for individual printing. A stopped signup is a lost customer; one hand-printed badge is an afternoon's annoyance.

Two things this requires to not become an invisible regression:

1. **The fallback must be visible, not silent.** A `badge_identity_id IS NULL` vessel needs a distinct marker in the fulfillment queue — the same treatment `admin/stickers` already gives a missing shipping address (an amber "print individually" flag, not a blank cell). If it degrades quietly, the system slides back to per-order printing without anyone deciding to.
2. **A low-water alarm on the admin dashboard, before the first batch ships.** Thresholds count **identities**, not physical badges (§1.6) — amber at 25 identities remaining, red at 10. Against a 100-identity batch that is a quarter and a tenth. Label the number as identities on screen, or it reads as twice the safety it is.

`100` is the working batch size for these defaults. It is **not** a print-shop minimum — no supplier is selected yet (§5.3), so it is a planning figure that may move once one is.

---

## 4. Two claim paths

### 4.1 Direct signup — does the "no activation code needed" claim hold?

**Yes, with one real hole, which is now handled procedurally rather than in software.**

The claim holds logically: assignment happens server-side inside the signup transaction, so by the time anything is packed the DB already knows badge → vessel → owner. The customer never proves anything about the badge because they were never separated from it — the binding predates their possession. Mailer cards stay identical because there is nothing per-customer to print on them.

**The hole is physical, not logical: a pick-and-pack mismatch.**

Under per-order printing this failure mode could not exist — the badge was manufactured *for* that order, so the wrong badge was never in the room. With pre-minted stock, near-identical badges sit on a shelf differing only by a 5-digit number in small caption type, and §1.6 makes it two objects per order rather than one. If the badge physically pulled is not the one the database assigned:

- The customer sticks a badge on their hull whose token resolves to a different vessel, or to nothing.
- Nothing in the system detects it. Both look shipped. It surfaces weeks later as *"my badge shows someone else's boat"*, by which point it is on a hull under adhesive designed not to come off.

**Re-binding is prohibited.** An earlier draft proposed correcting a mismatch by re-pointing the assignment at whichever badge was actually scanned. That is wrong, and the reason is decisive: **assignment happens at signup, and the MXE ID is visible to the customer from that moment** — in the dashboard, on the QR page, in the profile URL. Silently re-binding would change an identifier the customer has already seen and may already have written down, quoted to support, or shared. "Never reused, never revoked" (dormant identity spec §1) is not only about recycling IDs between customers; it is about the ID being a fixed fact from the moment it is shown.

So the correction goes on the shelf, not in the database:

> **A badge is picked to match its assignment. A mismatch is a picking error, corrected by picking the right badge. It is never corrected by changing the assignment.**

Re-binding remains possible only as an **explicit, logged admin action with a recorded reason** — for genuinely exceptional cases such as a badge destroyed before shipping — and never as an automatic consequence of a scan. Any such action writes an audit row; it is not a silent `UPDATE`.

**Scan-at-pack is deferred for the first run.** Ben is picking and packing personally against the admin queue, matching MXE ID to shipping label by eye. That is a real control, and for a single operator handling one order at a time it is adequate — arguably better than a scanner, because the person doing it is the person who cares.

It stops being adequate at a specific, identifiable point, and it is worth naming it now rather than discovering it:

- **The trigger is not volume, it is concurrency.** The control fails the first time **two orders are open on the bench at once** — two envelopes, four badges, two labels. Eye-matching is reliable when there is one right answer in front of you and unreliable the moment there are two.
- Volume matters only because it produces that concurrency. Batching starts happening naturally somewhere around **10–20 orders a week**, and immediately the first time someone other than Ben packs an order.

At that point the mitigation is a scan-at-pack confirmation step: scan the badge being packed, confirm it matches the assignment, **refuse the pack if it does not** — a check, not a re-bind. Not specced further here, per scope.

**Second, smaller hole:** a token resolves the moment it is minted, long before assignment. `/s/<token>` must therefore render a safe unclaimed state for `in_stock` badges (§1.7) — *"This badge hasn't been registered yet"* — and must not 404. Anyone scanning stock in the print shop or warehouse sees the same neutral page, with no indication of inventory scale.

### 4.2 Unbound distribution (model now, do not build)

A badge sold through a dealer or retail shelf ships with no account attached. Whoever ends up holding it must be able to prove they are entitled to claim it.

**The secret cannot be the QR token.** This is the load-bearing constraint of this entire section. The token is encoded in a QR code that will be stuck to the outside of a boat, in public, permanently, and photographed by anyone who walks past. A secret that is printed on the hull is not a secret. Using it to authorise claiming would mean anyone who photographs a docked boat could claim its identity.

**Therefore: a separate claim code, physically concealed.**

- **What:** a second random value, distinct from the token, generated at mint time. Only its **hash** is stored (`claim_code_hash`); the plaintext exists nowhere in the database after printing.
- **Where it physically lives:** under a scratch-off panel on the backing card, or on a slip inside sealed packaging. It must be destroyed-on-open in a visible way, so a customer can see whether the package was opened before they bought it. It must *not* be printed anywhere on the badge face itself, since the badge face ends up outdoors and public.
- **Why it cannot be delivered by email:** at manufacture time there is no account and no email address — that is the definition of unbound distribution. There is nobody to send it to. And the whole trust model is *possession of the sealed physical package proves entitlement to claim*; emailing the code to a purchaser would require knowing who the purchaser is, which is exactly the information a retail sale doesn't produce. Substituting email would also break the chain of custody the sealed package provides: a dealer who opened boxes could claim inventory they hadn't sold.

**Model now:** the four columns in §2.3 (`distribution_channel`, `claim_code_hash`, `claim_code_issued_at`, `claimed_at`, `claimed_by_user_id`). Adding them now costs nothing and means the first unbound batch doesn't require re-printing.

**Do not build now:** the claim flow, the scratch-off artwork, rate limiting on claim attempts, or the dealer-inventory concept. Flagged for later design: claiming must not become a path to hijack an *active* vessel — the dormant identity spec §6 already raises exactly this concern for its own claim path, and the two designs should be resolved together rather than separately.

---

## 5. Fulfillment queue additions

Scoped to what the first print run actually requires. Deeper queue features are deliberately deferred.

### 5.1 Stored artwork per identity

**Generate the badge artwork at mint time and store it; never regenerate on demand.**

The reason is specific, not general tidiness: `badge-layout.ts` and `qr-render.ts` are live code that has already changed several times this year (the Level-H fix, the `?scan=1` addition, the pixel-mark consolidation). If a batch is printed in October and a replacement badge for that batch is regenerated in March after a layout change, the replacement will not match its siblings — and nobody will notice until two badges are side by side on a dock.

- Render **once per identity**, write to Storage (`badge-artwork/<batch_id>/<mxe_id>.png` at the existing 1800 px / 600 DPI spec), record `artwork_path` and `qr_version`.
- **Both physical copies (§1.6) print from that one file.** There is no second render and no second stored artifact — the copies are impressions of the same artwork, which is exactly why they are indistinguishable and why the model has one row and one path per identity.
- Reprints — whether replacing a damaged copy or re-running a whole batch — read the stored file. They never re-render.
- This also gives the print shop a byte-identical artifact to what was approved, which is what a print shop will ask for.

### 5.2 Batch grouping

`badge_print_batches` (§2.3) plus an admin view that is **separate from the existing `admin/stickers` queue**, because that queue is `vessels`-driven and inventory has no vessel (§0.5). Minimum viable: list batches, show counts by `status` per batch, drill into a batch's identities. The existing per-vessel queue stays exactly as it is.

### 5.3 N-up sheet PDF export — **BLOCKED, do not build**

> **Blocked on supplier selection.** Sheet size, bleed allowance, and crop-marks-vs-die-line are all print-shop-specific, and no supplier has been chosen. Building this against a guess is the category of rework that costs a whole print run. The section stays specced so it is ready to build the day those three answers exist; it is not ready now.

One file per batch, not per-badge downloads — individual downloads don't survive contact with a 100-identity run.

**Copies and layout — the one part that is a design decision, not a supplier answer.**

The export emits **two impressions per identity** (§1.6): 100 identities → 200 badges on the sheets.

**The two copies must be laid out adjacent — side by side, as a pair — not distributed across separate sheets.** The reason is §4.1: a pair that is guillotined together, stays together through finishing, and is handled as one object is a pair the picker grabs as one object. Splitting copies across sheets means matching two separate stacks at pack time, which doubles exactly the mismatch surface the manual eye-check is already carrying alone. Adjacency is a control, not a convenience.

This imposes one hard constraint on the otherwise-configurable grid: **the column count must be even**, so a pair never straddles a row boundary. A 3-across layout would split pairs; 2-across and 4-across do not.

**Everything else is a config value, not a constant** — explicitly so, because all three are supplier-dependent:

| Parameter | Status | Note |
|---|---|---|
| Sheet size | **config** | US Letter fits 2 × 3 = 6 badges (3 identities). A 12″ × 18″ press sheet fits 4 × 6 = 24 (12 identities). |
| Columns (must be even) | **config** | Constrained, not free — see above. |
| Bleed allowance | **config** | Supplier-specific. |
| Crop marks vs. die-line | **config** | Supplier-specific; some want one, some the other, some both. |

Each badge on the sheet carries its MXE ID in the existing caption position — that is what makes a printed sheet sortable and pickable afterwards. Store the generated file at `badge_print_batches.sheet_pdf_path` so the exact artifact sent to the printer is recoverable.

## 6. Anything that would invalidate already-printed badges

Flagged per the brief. Each of these is a permanent, un-pushable break.

| # | Change | Consequence |
|---|---|---|
| 1 | Removing or altering the `/[mxeId]?scan=1` route | Every currently-printed badge dies, including the **two test badges already marked shipped** per `20260904`'s note |
| 2 | Removing `/s/<token>` once a batch is printed | That entire batch dies |
| 3 | Changing the token alphabet or length **retroactively** | Fine going forward; old tokens must keep resolving unchanged, forever |
| 4 | Changing the domain in the encoded URL | Old badges encode `moxieyacht.com`. That origin must keep serving both routes, or 301 them, permanently |
| 5 | Reusing or re-issuing an MXE ID (incl. after `void`) | Violates the guarantee `20260904` was written to enforce, and the dormant spec §1 restates |
| 6 | Regenerating artwork for a reprint after a layout change | Silent visual drift within a batch — mitigated by §5.1 |
| 7 | Re-binding an identity | Changes an MXE ID the customer has already seen. Prohibited as routine; explicit logged admin action only, and never after shipping (§4.1) |
| 8 | `setval()`-ing `mxe_id_seq` backwards | Would collide with printed stock. Never do this |
| 9 | Serving `/s/<token>` as a **permanent** (301/308) redirect | Caches in browsers and intermediaries we don't control. An identity corrected by admin action would keep resolving to the old vessel with no way to push a fix — §1.7 requires 307, uncached |

**Not currently a risk but worth stating:** a change to `MAX_BADGE_QR_VERSION` affects only future renders, never printed badges. It is a guard on new output, not a property of old output.

---

## 7. Status of open questions

### Closed by the first review

| Question | Decision |
|---|---|
| URL structure | **Option C.** `/s/<9-char Crockford Base32>`, version 4, 1.277 mm modules. `MAX_BADGE_QR_VERSION` stays at 5. §1.5 backward compatibility binding. |
| Data model shape | **Separate `badge_identities` table.** Status stops at `assigned`; `active`/`dormant` stay on `vessels`. |
| Copies per identity | **Two**, shipping together — one to apply, one spare (§1.6). |
| Batch 1 size | **100 identities / 200 physical badges.** `100` is a working planning figure for thresholds, not a supplier minimum. |
| Pool exhaustion | **Degrade to mint-on-demand**, `badge_identity_id` null, loudly flagged in the queue. Blocking signup rejected (§3.2). |
| Re-binding at pack | **Prohibited.** The MXE ID is visible to the customer from signup; a mismatch is corrected on the shelf. Admin re-bind only, explicit and logged (§4.1). |
| Scan-at-pack flow | **Deferred.** Manual eye-match against the queue for the first run (§4.1). |
| Token on badge face | **No.** MXE ID only. |
| `/s/` → ScanSuccess wiring | **307 redirect to `/<mxeId>?scan=1`**, uncached, unclaimed badges render rather than 404 (§1.7). |
| Transfer / decommission | **`badge_identities` untouched by both.** Never returns to stock (§2.5). |

### Still open

1. **Print shop: sheet size, bleed, crop marks vs. die-line.** Blocks §5.3 entirely. No supplier selected. This is the only thing on the critical path to a first print run.
2. **Packaging for two badges.** §1.6 changes the mailer from one 3″ badge to two. Not specced here; needs deciding alongside the mailer card.
3. **Where the "print individually" flag surfaces** for the §3.2 fallback. Probably a badge on the existing `admin/stickers` row, but the queue is `vessels`-driven and this is a `badge_identities` fact — worth 10 minutes at build time rather than assuming.
4. **Interaction with the dormant-vessel claim path.** Dormant identity spec §6 flags self-serve claiming as needing careful design; unbound claiming (§4.2) is a second door into the same room. Resolve together, when either is built.
5. **When scan-at-pack becomes necessary.** Not a question so much as a tripwire: the first time two orders are open on the bench simultaneously, or the first time someone other than Ben packs (§4.1).
