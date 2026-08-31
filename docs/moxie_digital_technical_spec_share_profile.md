# Moxie Digital — Trusted Contact Sharing
### Technical build spec · companion to `moxie_digital_share_profile.html`

**Status:** Designed, not built. Ready for Claude Code.
**Depends on:** existing `vessels` table, existing role-gated public/owner profile rendering, `users.subscription_tier`.
**Feeds into:** should be revoked automatically as step 5 of the Ownership Transfer Lifecycle (`ownership_transfers` spec, Phase 4) — cross-reference when that feature is built.

---

## 1. What this is

Every vessel record already renders differently for Public vs. Owner via server-side field-visibility filtering (the core patent mechanism). This feature adds a **third, owner-controlled visibility mode**: a link the owner generates on demand, scoped to exactly the fields they choose, for exactly one recipient, expiring on their terms.

Two share types:
- **Public Link** — the existing public profile URL (`moxieyacht.com/MXE-XXXXX`). No new backend work. Available on **every** tier, including Basic.
- **Trusted Contact** — a per-recipient link with custom field selection, an optional owner-written note, and an expiry. **Full Access only.** This is the new build.

This is the intended Basic → Full upsell moment: Basic owners can still hand out their public link, but the moment they want to send a title company their documents, or give a cleaner a lockbox code without a phone call, they hit the upgrade panel already built into the share sheet.

---

## 2. Database schema

```sql
CREATE TABLE vessel_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id       UUID REFERENCES vessels(id) NOT NULL,
  created_by      UUID REFERENCES users(id) NOT NULL,     -- must be current vessel owner at creation time
  label           TEXT,                                    -- "Diver — Juan", "Escrow — Triton Marine Title"
  preset          TEXT,                                     -- 'escrow' | 'marina' | 'vendor' | 'custom' | NULL
  token_hash      TEXT NOT NULL UNIQUE,                     -- sha256(token) — raw token is NEVER persisted
  field_flags     JSONB NOT NULL DEFAULT '{}'::jsonb,       -- see §3
  access_note     TEXT,                                     -- owner-authored, this-share-only (lockbox codes etc.)
  expires_at      TIMESTAMPTZ,                              -- NULL = no expiry
  one_time        BOOLEAN NOT NULL DEFAULT false,
  view_count      INTEGER NOT NULL DEFAULT 0,
  last_viewed_at  TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,                              -- NULL = active
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vessel_shares_vessel ON vessel_shares(vessel_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_vessel_shares_token ON vessel_shares(token_hash);
```

**RLS policies:**
- `SELECT`/`INSERT`/`UPDATE` on `vessel_shares`: only allowed where `created_by = auth.uid()` **and** `auth.uid()` is the vessel's current owner (join to `vessels.owner_id` or current `ownership_history` row — reuse whatever check already gates vessel edits).
- No `anon` access to this table at all. The public resolve endpoint (§5) runs server-side with the service role and does its own token/expiry/revocation check — it never exposes the table directly.
- `UPDATE` is restricted to setting `revoked_at` (revoke action). Everything else on an existing share is immutable — a changed share should be revoked and recreated, not edited in place, so the audit trail stays clean.

---

## 3. Field groups

`field_flags` keys map to existing vessel data. "Vessel specs" is not a flag — it's always included, same baseline as the public profile.

| Flag | Label in UI | Source data |
|---|---|---|
| `location` | Location details | `vessels.marina_name`, slip #, marina address |
| `contact` | Owner contact | current owner's name, phone |
| `docs` | Documents | uploaded files (insurance, registration cert, etc.) marked shareable |
| `ownership` | Ownership record | HIN, registration #, title status — normally locked/owner-only fields |
| `access` | Access & instructions | the `access_note` text field on this row only |

`ownership` is the one flag that exposes otherwise-locked intrinsic fields (HIN, registration #). This is intentional and matches the escrow use case — but because HIN/registration are the same fields protected against edits (see vessel-intrinsic field locking), this flag should be **read-only exposure only**, never writable by the recipient, and should log which shares have ever had it enabled for audit purposes.

**Presets** (client sets these `field_flags` combinations; server doesn't need to know about presets, just validates the resulting flags):
- `escrow`: location, contact, docs, ownership on · access off
- `marina`: location, contact on · docs, ownership off · access on
- `vendor`: location, access on · contact, docs, ownership off

---

## 4. Tier gating (must be enforced server-side, not just hidden in UI)

`POST /api/vessels/:mxeId/shares` checks `users.subscription_tier` for the requesting owner:
- `tier === 'full'` → proceed.
- `tier === 'basic'` → `403` with a small JSON payload the frontend uses to render the upsell panel (already built in the HTML — `#trusted-upsell`). Do not silently downgrade the request to a public link; reject it explicitly so the frontend can show the correct state.

This mirrors the existing pattern of tier checks already in the payment/webhook logic — reuse whatever helper currently reads `subscription_tier` rather than re-deriving it.

---

## 5. API endpoints

**`POST /api/vessels/:mxeId/shares`** (owner, Full Access only)
Body: `{ label, preset, field_flags, access_note?, expires_in ('one_time'|'24h'|'7d'|'none'), one_time }`
- Generates a 32-byte cryptographically random token, returns it **once** in the response.
- Persists only `sha256(token)`.
- Returns `{ id, url: "moxieyacht.com/MXE-XXXXX?share=<token>", expires_at }`.

**`GET /api/vessels/:mxeId/shares`** (owner)
- Returns active + recently-revoked/expired shares for the Shares dashboard. Include `view_count`, `last_viewed_at` so the owner can see if a link's actually been used.

**`DELETE /api/vessels/:mxeId/shares/:shareId`** (owner)
- Sets `revoked_at = now()`. Idempotent.

**`GET /api/share/:token`** (public, no auth)
- Looks up by `sha256(token) = token_hash`.
- Checks: not revoked, not expired, `view_count < 1` if `one_time`.
- On success: increments `view_count`, sets `last_viewed_at`, and if `one_time`, sets `revoked_at = now()` in the same transaction so a second request can't race past the check.
- Returns the vessel record filtered to baseline specs + whichever `field_flags` are true, plus `access_note` if `access` is true, plus `label`/owner name for the "shared by" banner.
- On failure (expired/revoked/not found/already used): return a generic "This link is no longer active" state — don't distinguish *why* in the response (avoids leaking whether a guessed token ever existed).
- **Rate limit this endpoint** (per IP and/or per token prefix) — it's the one anonymous, unauthenticated surface in this feature and the main thing standing between a stranger and a brute-forced token.

---

## 6. Interaction with Ownership Transfer

The Ownership Transfer spec already states that all active share links are revoked on transfer completion. When that feature is built, Phase 4 (Transfer) should bulk-set `revoked_at = now()` on every `vessel_shares` row for that `vessel_id` where `revoked_at IS NULL`. No changes needed here — just flagging the dependency so it isn't missed.

---

## 7. Frontend

The three screens in `moxie_digital_share_profile.html` map directly to build targets:

1. **Owner profile + share sheet** — add the "Share Profile" FAB and bottom sheet to the existing owner vessel profile page. Sheet posts to `POST /api/vessels/:mxeId/shares` on "Generate share link."
2. **Active Shares manager** — new page/panel, reads `GET /api/vessels/:mxeId/shares`, revoke button calls the `DELETE` endpoint.
3. **Trusted Contact recipient view** — new public route, e.g. `moxieyacht.com/[mxeId]?share=[token]`, calls `GET /api/share/:token` server-side (or via an edge function) and renders the filtered profile. Needs its own "link no longer active" empty state.

All three should reuse the existing profile-rendering components/CSS rather than forking new markup — the HTML file matches the established token set (`--navy`/`--gold`/`--cream`/`--aqua-*`) exactly so it should drop in cleanly.

---

## 8. Acceptance tests

*(Same format as `moxie_acceptance_tests_v2.md` — append as a new milestone.)*

### Happy Path
- Full Access owner opens the share sheet, selects "Trusted Contact," picks the Escrow preset, generates a link — link is copyable and contains a valid token.
- Visiting the generated link (logged out, no session) shows vessel specs + location + contact + documents + ownership record, matching exactly the preset's `field_flags`.
- A field left off (e.g. `access` in the Escrow preset) does not appear anywhere in the recipient view, including in page source.
- Owner revokes the link from the Shares dashboard; the link immediately shows "no longer active" on next visit.
- A `one_time` link works once, then shows "no longer active" on a second visit — including a second visit before the first-view response has been re-fetched (race condition check).
- Creating a link with `expires_in: '24h'` and visiting it 25 hours later (or with a manually adjusted `expires_at` in test) shows "no longer active."

### Tier gating
- Basic-tier owner clicks "Trusted Contact" in the share sheet → sees the upsell panel, not the field toggles. "Public Link" tab still works normally.
- Basic-tier owner hits `POST /api/vessels/:mxeId/shares` directly (bypassing UI) → `403`, no row created.
- Downgrading a Full Access account to Basic does **not** retroactively revoke already-active trusted-contact shares (matches the "downgrade doesn't deactivate QR" precedent) — but new ones can't be created until they upgrade again.

### Security
- `GET /api/share/:token` with a guessed/invalid token returns the same generic "not active" response as an expired one (no distinguishing signal).
- Raw tokens are never present in the database — confirm only `token_hash` is stored.
- `vessel_shares` is unreachable via the Supabase anon key directly (RLS blocks it; only the service-role resolve endpoint can read it).
- A vessel owner cannot see or revoke another owner's shares, even by guessing share IDs.
- Enabling `ownership` (HIN/registration exposure) on a share is logged/auditable.

### Edge Cases
- Vessel with zero active shares shows an empty state on the Shares dashboard, not an error.
- Revoking a share that's already expired doesn't error.
- Owner transfers the vessel (per Ownership Transfer spec) → all shares for that vessel are revoked as part of that flow.
- Very long `access_note` (near any column limit) doesn't break rendering on the recipient view.

---

## 9. Open questions for Ben

1. **SMS delivery** — the mockup has a "Send via text" button that currently just closes the sheet. Worth wiring to an actual SMS provider (e.g. Twilio) later, or is copy-and-paste-yourself fine for launch?
2. **Per-document toggles** — right now "Documents" is one on/off flag covering everything marked shareable. Escrow companies may eventually want to pick specific documents rather than all-or-nothing. Fine to ship all-or-nothing first and revisit if it comes up.
3. **View notifications** — should the owner get notified (in-app, or eventually email) when a trusted-contact link is actually opened? Not in this spec, but a natural follow-on given `view_count`/`last_viewed_at` are already being tracked.
