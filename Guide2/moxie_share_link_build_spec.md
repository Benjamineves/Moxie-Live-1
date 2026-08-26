# Moxie — Share Link Build Spec

**For:** Backend development handoff  
**Date:** April 29, 2026  
**Priority:** High — real boat sale(s) pending; this feature gets used in the transaction  
**Scope:** Owner-generated share links with field-level visibility controls

---

## Why this matters right now

Ben has a potential buyer for the Nimbus and possibly the Beneteau. During the sale, a marine title/escrow person needs vessel documentation — registration, insurance, HIN, owner info. Today that's a mess of emails and phone calls.

The share link lets Ben send a single URL to the escrow person with exactly the fields they need, pre-populated from the Moxie profile. If this works well, it becomes the pitch: "Want this for every transaction you handle?"

This is the first real-world use of Moxie in a boat transaction. It needs to work and look good.

---

## What already exists (reference files in project)

| File | What it is |
|------|-----------|
| `moxie_share_profile.html` | Full UI mockup — owner share sheet, trusted contact view, share management. This is the design source of truth. |
| `moxie_technical_handoff_v1.html` | Architecture, data model, role system, field-to-role visibility map, API endpoints. |
| `moxie_qr_roles.html` | Role definitions and field access breakdown per role. |
| `moxie_vessel_profile_all_roles.html` | Profile rendering for all roles — shows what each role sees. |
| `moxie_vessel_intake_nimbus.html` | Nimbus vessel data already structured. |

---

## The feature in one sentence

An owner generates a share link with a label, expiry, and toggled field visibility. The recipient opens the link and sees a read-only vessel profile filtered to the selected fields. The owner can revoke the link at any time.

---

## Data model

### New table: `share_links`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | Primary key |
| `vessel_id` | uuid | FK → vessels |
| `owner_id` | uuid | FK → users (must match vessel owner) |
| `token` | varchar(8) | Random alphanumeric, unique, URL-safe. This is the `?share=` param. |
| `label` | varchar(100) | Owner's internal label, e.g. "Escrow — Triton Marine Title" |
| `expires_at` | timestamp | Nullable. Null = no expiry. |
| `is_one_time` | boolean | If true, mark as consumed after first access. |
| `revoked_at` | timestamp | Nullable. If set, link is dead. |
| `visible_fields` | jsonb | Array of field keys the recipient can see (see below). |
| `created_at` | timestamp | Auto |
| `accessed_at` | timestamp | Nullable. Last access time. |
| `access_count` | integer | Default 0. Increment on each view. |

### `visible_fields` — the field toggle list

The share sheet UI has toggles for field groups. The `visible_fields` column stores which groups are turned on. Here are the groups and their underlying fields:

| Toggle group | Fields included | Default for escrow use case |
|-------------|----------------|---------------------------|
| `vessel_specs` | vessel_name, make, model, year, length_ft, type, draft_ft | ON |
| `location` | marina_name, marina_city, slip_number, marina_phone | ON |
| `registration` | reg_number, reg_expiry, uscg_doc_number, official_number | ON |
| `insurance` | ins_carrier, ins_policy, ins_expiry, ins_liability, ins_broker | ON |
| `owner_contact` | owner_name, owner_phone, owner_email | ON |
| `emergency_contact` | emg_name, emg_phone, emg_relationship | OFF |
| `engine_safety` | engine, fuel_type, max_persons, lifejackets, fire_ext, flares | OFF |
| `hin` | hin (full, unmasked) | ON |
| `documents` | Access to uploaded doc files (insurance cert, registration doc) | ON |
| `public_notes` | public_notes | ON |

Ben toggles these on/off per share link. The `visible_fields` value for a typical escrow share would look like:

```json
["vessel_specs", "location", "registration", "insurance", "owner_contact", "hin", "documents", "public_notes"]
```

---

## API endpoints

### `POST /api/vessels/:mxeId/shares`

**Auth:** Owner JWT (must own this vessel)

**Request body:**
```json
{
  "label": "Escrow — Triton Marine Title",
  "expires_in": "30d",
  "is_one_time": false,
  "visible_fields": ["vessel_specs", "registration", "insurance", "owner_contact", "hin", "documents"]
}
```

`expires_in` accepts: `"one_time"`, `"24h"`, `"7d"`, `"30d"`, `null` (no expiry). Convert to `expires_at` timestamp server-side.

**Response:**
```json
{
  "id": "uuid",
  "token": "d7x2k9ab",
  "url": "moxie.sh/MXE-00001?share=d7x2k9ab",
  "label": "Escrow — Triton Marine Title",
  "expires_at": "2026-05-29T00:00:00Z",
  "visible_fields": ["vessel_specs", "registration", "insurance", "owner_contact", "hin", "documents"]
}
```

### `GET /api/vessels/:mxeId?share=:token`

**Auth:** None (public access via token)

**Logic:**
1. Look up `share_links` by `token` + `vessel_id`
2. Check: not revoked (`revoked_at` is null)
3. Check: not expired (`expires_at` is null OR `expires_at > now`)
4. Check: if `is_one_time`, `access_count` must be 0
5. If all pass → return vessel data filtered to `visible_fields` groups only
6. Increment `access_count`, update `accessed_at`
7. If any check fails → return 404 (don't reveal that the vessel exists)

**Response:** Same shape as the public vessel profile, but with additional field groups based on `visible_fields`. Do NOT include any fields outside the toggled groups.

### `GET /api/vessels/:mxeId/shares`

**Auth:** Owner JWT

Returns all share links for this vessel (active, expired, and revoked) so the owner can manage them. This powers the "Manage shares" screen in the UI.

### `DELETE /api/vessels/:mxeId/shares/:shareId`

**Auth:** Owner JWT

Sets `revoked_at = now()`. Does NOT delete the row — keep it for audit trail.

---

## Supabase RLS policy

```sql
-- Share links: owners manage their own
CREATE POLICY "owner_manage_shares" ON share_links
  FOR ALL USING (owner_id = auth.uid());

-- Public: read vessel via valid share token
-- (This is handled in the API layer, not RLS, because
-- token validation logic is too complex for a policy.
-- The API endpoint queries as a service role after
-- validating the token.)
```

---

## Share link profile render

When someone opens a share link URL, they see a read-only vessel profile. The design is already built — see `moxie_share_profile.html`, specifically the "Trusted Contact View" screen.

Key rendering rules:

- **Header:** Show the Moxie bar with a "Shared profile" badge (not "Boat Owner" or "Marina Operator"). Use the amber color accent from the brand system.
- **Hero:** Same vessel hero as public view (photo, name, specs).
- **Fields:** Only render sections where the toggle group is in `visible_fields`. If `insurance` is not in the list, the entire Insurance section is hidden — don't show it with "Private" placeholders.
- **Documents:** If `documents` is in `visible_fields`, show download links for uploaded docs (insurance cert, registration). Use signed S3 URLs with 15-minute TTL, same as existing doc access pattern.
- **Footer:** "Powered by Moxie" with the registration CTA ("Own a vessel? Get your boat on Moxie."). This is the acquisition touchpoint — every escrow person who opens a share link sees it.
- **Expired/revoked state:** If the link is dead, show a clean branded page: "This share link has expired or been revoked. Contact the vessel owner for access." Plus the Moxie registration CTA.

---

## What can be deferred

These are NOT needed for the first transaction use:

- Share analytics dashboard (access count is stored but doesn't need a UI yet)
- Email/SMS delivery of share links (Ben will copy-paste the URL)
- Share link templates / presets (future: "Escrow package" preset that auto-selects the right fields)
- QR code on the share page itself
- Multiple vessel bundling (sharing both Nimbus + Beneteau in one link)

---

## Build sequence suggestion

1. **`share_links` table + RLS** — schema, migration, policy
2. **Create share endpoint** — `POST /shares` with token generation
3. **Share-filtered profile render** — `GET /vessel?share=token` returning filtered data
4. **Share profile page** — frontend render of the filtered view (use the Trusted Contact View from `moxie_share_profile.html` as the template)
5. **Revoke endpoint** — `DELETE /shares/:id`
6. **Owner share management UI** — list active shares, revoke button (use the "Manage Shares" screen from `moxie_share_profile.html`)

Steps 1–4 are the minimum to use in a real transaction. Steps 5–6 are nice-to-have for v1 but Ben can revoke via Supabase dashboard directly if needed.

---

## Token generation note

Keep the share token short (6–8 chars) and URL-safe (lowercase alphanumeric). The URL format is:

```
moxie.sh/MXE-00001?share=d7x2k9ab
```

This keeps the URL clean enough to paste in an email or text. The token does NOT grant any write access — it's read-only, scoped to the fields the owner selected, and revokable.

---

## One more thing

This isn't just a feature for Ben's boat sale. Every marine title/escrow company processes hundreds of transactions a year. If the escrow person at Triton (or whoever Ben uses) has a good experience with this, the pitch writes itself: recommend Moxie to your sellers, and every closing package arrives pre-organized. That's the wedge into the transaction ecosystem — and it starts with this share link working well on one deal.
