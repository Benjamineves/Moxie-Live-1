# Moxie Digital — Acceptance Test Plan

**Companion to `moxie_digital_build_spec.md`.** A milestone is not done until every test in its section passes.

> **Supersedes:** `moxie_acceptance_tests.md` (v1). That doc predates the payment pivot entirely — no Stripe tests, sequential-only MXE IDs assumed, marina role treated as in-scope, password auth assumed, `moxie.sh` domain assumed. This version corrects all of that against `moxie_digital_build_spec.md`. Same format, same rule: **a milestone is not done until every test in its section passes.**

---

## What changed from v1 (read this before using the doc)

- **Domain corrected.** `moxie.sh` was never acquired. `moxieyacht.com` is the confirmed short domain for QR/scan URLs; `moxieyachting.com` is the confirmed primary/marketing domain. Every URL below reflects that.
- **Auth: staying on email/password for launch.** Per `moxie_digital_build_spec.md` §9-B7, magic link is deferred (deliberate call, not an oversight) — the existing email+password flow ships the funnel faster and nothing else in the schema or UI depends on which method is used. Revisit magic link post-launch once a transactional email provider is picked for other reasons (Full-tier reminders).
- **Payment added.** Entirely new section (P0-C below) — didn't exist in v1 at all.
- **Marina (P1-A) and Coast Guard (P2-B) are DEFERRED**, not required for this build phase. Test content is kept below so it's ready when those roles get reactivated, but nothing in these two sections blocks a launch.
- **Intake flow updated.** Storage type replaces marina-only "Location & Mooring," photo upload is optional, and submission routes to payment rather than directly to a completed profile.
- **MXE ID format — unresolved, flagged, not silently decided.** Every artifact reviewed so far (the v1 handoff's own open questions, `moxie_seed.sql`'s column comment, the original `qr_tokens` seed notes) treats **sequential** (`MXE-00001`, `MXE-00002`, ...) as the current/default behavior, with randomized IDs noted as a possible future change — never as a resolved decision. That's worth knowing before writing a test that assumes one or the other. Tests below are written to pass under **either** scheme; a dedicated test at the bottom calls out the specific behavior to lock in once this is actually decided.

---

## How to use this document

Each milestone from the build priority table has a test section below. Tests are grouped by what they verify: **happy path** (it works), **security** (unauthorized access fails), and **edge cases** (weird inputs don't break things).

Coding agents: implement these as automated tests (Jest, Playwright, or whatever test framework you choose). The test descriptions are written to be directly translatable into test function names.

---

## P0-A: Static Public Profile Render

**What it unlocks:** Scan QR → see Discovery One's public profile. First live demo.

### Happy Path
- `GET /api/vessels/MXE-00001?role=public` returns 200 with JSON containing: vessel_name, make, model, year, length_ft, draft_ft, vessel_type, storage_type, storage_description (or marina_name/marina_city when storage_type='marina'), mxe_id, photo_url, public_notes
- Response JSON for MXE-00001 contains `vessel_name: "Discovery One"`, `make: "Nimbus"`, `model: "T8"`, `year: 2023`
- Public profile page renders vessel name "Discovery One" in the hero section
- Public profile page renders spec strip with Make, Year, Length, Type, Draft values
- Public profile page renders "Home Marina" section with Portobello Marina, Oakland CA (storage_type='marina' case)
- Public profile page renders "Moxie Registered Vessel" verified badge with MXE-00001
- HIN field displays "Private" (not the actual HIN value) in public view
- Public notes text is visible on the public profile
- **A vessel with `qr_status='pending_payment'` does NOT resolve to a live public profile** — returns a "not yet active" state, not the full render (this is new — v1 had no concept of an inactive vessel)

### Security
- `GET /api/vessels/MXE-00001?role=public` response does NOT contain: owner_name, owner_phone, owner_email, emg_name, emg_phone, ins_policy, ins_broker, ins_liability, hin (full value), uscg_doc_number, official_number, slip_number, slip_notes, engine, fuel_type, max_persons, lifejackets
- No private fields leak into the HTML source of the public profile page (search page source for "312-465", "Novamar", "NIM12341", "MAR-2025")
- Insurance and registration are shown as status only ("Current" badge) with no policy numbers or detail

### Edge Cases
- `GET /api/vessels/MXE-99999?role=public` returns 404
- `GET /api/vessels/INVALID?role=public` returns 404 (not 500)
- `GET /api/vessels/MXE-00001?role=owner` without auth returns 401 (not public data)
- `GET /api/vessels/MXE-00001` (no role param) defaults to public render
- A vessel with `storage_type='trailer'` (or home/yard/mooring/other) renders a "Storage" section with type + description instead of "Home Marina"

---

## P0-B: Scan-Success Animation → Redirect

**What it unlocks:** Scanning feels like a product, not a link click. Brand moment.

### Happy Path
- `GET /api/vessels/MXE-00001/preview` returns 200 with minimal JSON: vessel_name, make, model, year, vessel_type (5 fields only)
- Navigating to `moxieyacht.com/MXE-00001?scan=1` loads the scan-success animation page
- Animation displays vessel name "Discovery One" and metadata "2023 Nimbus T8 · Power"
- Animation displays MXE-00001 scan ID
- Animation completes in approximately 2.4 seconds
- After animation completes, page redirects to the vessel profile URL
- Redirect destination includes appropriate role parameter based on session state
- If no session: redirects to `?role=public`
- If valid owner session: redirects to `?role=owner`

### Security
- `/api/vessels/MXE-00001/preview` returns ONLY the 5 public preview fields, no private data
- Preview endpoint does not require authentication

### Edge Cases
- `moxieyacht.com/MXE-99999?scan=1` shows a graceful "vessel not found" state (not a broken animation)
- Scanning a vessel with `qr_status='pending_payment'` shows a distinct, graceful state — not a broken animation, not the normal public profile (this vessel isn't supposed to be scannable yet; in practice this shouldn't be reachable since the physical sticker doesn't exist until payment clears, but the API/route should fail gracefully if hit directly)
- Animation works on mobile Safari, mobile Chrome, desktop Chrome, desktop Safari
- Animation works without JavaScript (degrades to direct redirect)

---

## P0-C: Payment Integration (Stripe) — NEW in v2

**What it unlocks:** The entire reason this version of the spec exists. Nothing in v1 tested this because nothing in v1 built it.

### Happy Path
- Payment page loads with the vessel's `mxe_id` from intake, shows two tier options (Basic one-time, Full Access recurring), Full pre-selected
- Selecting Basic updates the displayed total and the tier card's selected state
- Submitting payment with a Stripe test card (`4242 4242 4242 4242`) for the Basic tier succeeds, creates a `vessel_payments` row with `payment_type='setup_fee'`, `status='paid'`
- On successful setup_fee payment: `vessels.qr_status` flips from `'pending_payment'` to `'active'`, `qr_generated_at` is set
- Submitting payment for Full Access additionally creates/activates a Stripe subscription; `users.subscription_status='active'`, `users.subscription_tier='full'`
- After successful payment, user is redirected to the completion/sticker-reveal screen (already built, no changes needed there per UI patch v2 §3)
- Subscription is billed annually; the price shown to the user throughout is the annual amount divided by 12, labeled "billed annually" — verify no separate true-monthly billing path exists
- **Test mode**: all of the above runs against Stripe test-mode keys. No live keys exist yet — do not hardcode or assume production keys anywhere in this milestone's tests.

### Security
- Payment endpoints validate the Stripe webhook signature before trusting any webhook payload
- A vessel cannot be flipped to `qr_status='active'` by any client-side action alone — only a verified webhook event can do this
- Card data never touches Moxie's own backend — verify no raw card fields appear in any request body Moxie's server receives (Stripe Elements/Payment Element handles this, should be structurally impossible, but test for it)

### Edge Cases
- Declined test card (`4000 0000 0000 0002`) shows a clear error, does not flip `qr_status`, does not create a `'paid'` vessel_payments row
- Submitting payment twice for the same vessel (e.g. double-click) does not create two setup_fee charges
- **Subscription lapse → auto-downgrade:** simulate a Stripe subscription reaching `canceled` after the dunning cycle completes → `users.subscription_tier` flips to `'basic'` → verify `vessels.qr_status` is **unaffected** (stays `'active'`) and the account/login still works normally
- A lapsed-to-Basic user can reactivate to Full from the Account & Billing panel without re-doing intake or re-verifying identity
- A Basic-tier user's document-expiry reminders still fire as in-app status indicators (doc-status-dot warn/red states), but no reminder **email** is sent — verify email sending is specifically gated on `subscription_tier='full'`, while in-app status computation is not gated by tier at all
- **Boater card is exempt from the Basic tier's 1-document limit** — a Basic account can hold its 1 general document (e.g. insurance) *and* a `doc_type='boater_card'` upload simultaneously; verify the count check specifically excludes `boater_card` rows rather than treating it as consuming the single slot

---

## P0-D: Vessel Intake Form → Creates DB Record (updated flow)

**What it unlocks:** New vessels can be registered by owner. Second vessel added.

### Happy Path
- Intake form has 4 steps: Vessel Identity → **Storage** (not "Location & Mooring" — marina is one of several options, see `moxie_digital_build_spec.md §13`) → Documents (+ optional photo) → Owner Info
- Step 1 collects: vessel_name, type, make, model, year, length, draft, HIN, engine, fuel_type, max_persons, public_notes
- Step 2 collects: `storage_type` (marina/trailer/home/yard/mooring/other) via pill selector; if 'marina', additionally collects marina, slip_number, marina_phone, is_liveaboard, slip_notes; if not 'marina', collects `storage_description` instead
- Step 3 collects: registration number, registration expiry, registration file upload, insurance carrier, insurance broker, insurance policy, insurance expiry, insurance liability, insurance file upload, boater card file upload, **and an optional vessel photo upload that does not block continuing**
- Step 4 collects: owner_name, owner_phone, owner_email, preferred_contact, emergency_name, emergency_relationship, emergency_phone, safety equipment (lifejackets, fire_ext, flares)
- Submitting step 4 via `POST /api/vessels` with owner JWT creates a new vessel record with `qr_status='pending_payment'`, then redirects to the payment page (P0-C) — **does not** go directly to a completed/active profile
- New vessel is assigned an `MXE-XXXXX` ID automatically (format per the open question flagged above — test should assert uniqueness and correct `MXE-` prefix format, not a specific generation scheme, until that's resolved)
- QR token record is created automatically when vessel is created, but resolves to an inactive state until payment clears (see P0-A)
- File uploads store to Supabase Storage and file_url is saved to vessel_documents
- Live preview panel updates in real-time as form fields are filled
- Leaving the photo upload empty does not prevent form submission or navigation to payment

### Security
- `POST /api/vessels` without JWT returns 401
- File upload validates MIME type: only PDF, JPG, PNG accepted
- File upload validates size: max 10MB per file
- File upload stores to private bucket with signed URLs (not public) — exception: vessel photo, which is public-read per the storage bucket structure in the seed data
- XSS prevention: vessel_name and all text fields are sanitized before storage and rendering

### Edge Cases
- Form preserves state when navigating between steps (step 1 → step 3 → back to step 1 retains data)
- Submitting with only required fields (vessel_name, make, model, year, type) succeeds — photo and storage_description are never required
- Switching `storage_type` from 'marina' to any other value hides marina-only fields and shows `storage_description` instead (per the storage-type patch's toggle logic)
- Duplicate vessel_name is allowed (two boats can have the same name)
- HIN field accepts various formats (alphanumeric, no strict validation in v1)
- Year field accepts reasonable range (1900–current year + 1)
- Abandoning the flow after step 4 but before completing payment leaves the vessel in `qr_status='pending_payment'` indefinitely — no orphan cleanup required for v1, but verify the vessel doesn't somehow become publicly visible in this state

---

## P0-E: Owner Auth (Email + Password) + Owner Profile Render

**What it unlocks:** Ben can log in, see his full profile, edit it.

**Note:** Magic link is deferred for launch per `moxie_digital_build_spec.md` §9-B7 — a deliberate call, not an oversight. These tests cover the email+password flow actually shipping; re-add magic-link tests here if/when that gets revisited.

### Happy Path
- Owner signs up / logs in with email + password via Supabase auth
- Successful sign-in issues a session JWT (standard Supabase session — no magic link, no custom token logic this phase)
- `GET /api/vessels/MXE-00001?role=owner` with valid owner JWT returns ALL vessel fields
- Owner profile page renders the full spec strip including HIN (masked as "NIM·····234")
- Owner profile page renders Storage section correctly for the vessel's `storage_type`
- Owner profile page renders Documents on File section with status badges (USCG Documentation: Current, Marine Insurance: Current, CA Boater Card: Current)
- Owner profile page renders owner contact section (name, phone, email)
- Owner profile page renders emergency contact section (even if empty — shows "Add emergency contact" prompt)
- Owner profile page renders "Add a photo" nudge when `photo_url` is null (per UI patch v2 §6), and this nudge disappears permanently once a photo exists
- Owner can update vessel_name via `PATCH /api/vessels/MXE-00001` with owner JWT → returns 200, database updated
- Owner profile page renders "My Fleet" tab showing both vessels (Discovery One + Polaris)
- Clicking Polaris in fleet switcher loads MXE-00002 owner profile
- Owner profile page renders bottom navigation: Profile, My Fleet, Docs, Account
- Tapping "Account" opens the Account & Billing bottom sheet (per UI patch v2 §5), showing current tier, renewal info, and payment history
- `GET /api/users/{userId}/fleet` with owner JWT returns array of 2 vessels

### Security
- `GET /api/vessels/MXE-00001?role=owner` without JWT returns 401
- `GET /api/vessels/MXE-00001?role=owner` with JWT belonging to a DIFFERENT user returns 403
- `PATCH /api/vessels/MXE-00001` with JWT belonging to a different user returns 403
- Owner cannot see another owner's vessels via `/api/users/{otherUserId}/fleet`
- JWT expires after a reasonable period (e.g., 7 days)
- Password reset flow (Supabase default) works and doesn't leak whether an email is registered

### Edge Cases
- Owner with 0 vessels sees empty fleet with "Register a new vessel" CTA
- Owner with expired insurance sees amber/red status badge (not green "Current")
- HIN masking works correctly: shows first 3 chars + dots + last 3 chars
- Long vessel names don't break the hero layout
- Missing photo_url renders the decorative navy/gold gradient background (no broken image) AND shows the "Add a photo" nudge
- Basic-tier owner sees an "Upgrade to Full Access" CTA in the Account panel instead of "Manage billing"

---

## P1-A: Marina Operator Render + Auth — **DEFERRED, not required this phase**

**What it unlocks:** Emery Cove pilot demo. Show harbor master what they see when they scan.

Kept for when this role is reactivated per the v2 scope decision — not part of the current build's definition of done. Test content unchanged from v1:

### Happy Path
- Marina operator can log in with email/password *(note: if marina role is reactivated before magic-link is extended to it, confirm auth method at that time — v1 assumed password, v2 hasn't revisited this since the role is paused)* → receives JWT with marina_operator role
- `GET /api/vessels/MXE-00001?role=marina` with marina JWT returns marina-tier fields
- Marina view shows: all public fields PLUS slip_number, marina_phone, is_liveaboard, slip_notes, owner_name, owner_phone, owner_email, emg_name, emg_phone, emg_relationship — **only applies when `storage_type='marina'`; a non-marina vessel has no marina-operator render at all**, per the storage-type patch
- Marina view shows insurance status badge ("Current" / "Expiring" / "Expired") but NOT policy number or liability amount
- Marina view includes "Call Owner" action button with tel: link
- Marina view is read-only — no Edit button, no PATCH capability

### Security
- Marina operator at Emery Cove CANNOT see vessels at Portobello Marina (unless those vessels are also at Emery Cove)
- Marina view does NOT show: ins_policy, ins_liability, ins_broker, hin, uscg_doc_number, official_number, engine, fuel_type, max_persons, lifejackets, fire_ext, flares
- `PATCH /api/vessels/MXE-00001` with marina JWT returns 403

### Edge Cases
- Marina with 0 vessels shows empty state
- Marina operator account creation is admin-only (no self-signup in v1)

---

## P1-B: QR Code Generation + Sticker PDF

**What it unlocks:** Produce the actual printable sticker file for hull placement.

### Happy Path
- `GET /api/vessels/MXE-00001/qr.pdf` with owner JWT returns a downloadable PDF **only when `qr_status='active'`**
- PDF is 3" × 3" at 600 DPI resolution
- QR code encodes the URL: `moxieyacht.com/MXE-00001?scan=1`
- QR code uses Level H error correction
- Navy + Gold colorway: dark cells #071020, background #0d1f35
- "MOXIE" text appears below QR grid in uppercase
- QR code scans successfully with iPhone camera app
- QR code scans successfully with Android camera app
- Scanning the QR from the PDF loads the scan-success animation

### Security
- Only the vessel owner can generate their vessel's QR PDF
- QR PDF endpoint requires owner JWT
- **Requesting a QR PDF for a vessel with `qr_status='pending_payment'` returns a clear error, not a broken/blank PDF** — this is the enforcement point that makes the payment gate real, not just cosmetic

### Edge Cases
- QR code remains scannable when printed on weatherproof vinyl (test with Level H damage tolerance — cover 25% of QR and verify scan still works)
- Long MXE IDs don't break QR density below scannable threshold (relevant if the MXE ID format question resolves toward a longer randomized string)

---

## P2-A: Document Upload + Storage

**What it unlocks:** Insurance cards, registration docs, and vessel photos actually stored and accessible.

### Happy Path
- Owner can upload PDF via `POST /api/vessels/MXE-00001/documents` with owner JWT
- Upload returns a document record with file_url pointing to Supabase Storage
- Uploading with `doc_type='vessel_photo'` additionally sets `vessels.photo_url` directly (not just a documents-drawer entry)
- `GET /api/vessels/MXE-00001/documents/{docId}` generates a signed URL (15-minute expiry) for private documents
- Vessel photos are public-read (not signed-URL-gated) per the storage bucket structure
- Document list on owner profile shows: file name, doc type, status badge, file size
- Document status automatically computed from expiry dates: green (>30 days), amber (≤30 days), red (expired)

### Security
- Signed URLs expire after 15 minutes
- Document access is role-gated: Owner sees all documents; Public sees no documents (Marina/CG gating deferred along with those roles)
- Direct Storage URLs are not publicly accessible for private-bucket documents
- MIME type validation on upload (PDF, JPG, PNG only)
- File size limit enforced (10MB max)

### Edge Cases
- Uploading a new insurance document when one already exists replaces the old record (or creates a version history — TBD, unchanged from v1)
- Corrupt PDF upload returns meaningful error
- 0-byte file upload is rejected

---

## P2-B: Coast Guard Render — **DEFERRED, not required this phase**

Kept for when this role is reactivated — not part of the current build's definition of done. Auth method remains an open question (per v1) and hasn't been revisited since the role is paused.

---

## P3: Marketing Site with Waitlist Backend

**What it unlocks:** Captures emails from moxieyachting.com — but per the current funnel, the site's primary CTA should push toward "Create your account" over "Join waitlist" now that self-serve signup is live. Confirm the homepage copy actually reflects that priority rather than defaulting to pre-launch waitlist language.

### Happy Path
- Homepage loads at moxieyachting.com with hero, how-it-works, role overview, profile mockup, and contact/waitlist sections
- Primary CTA leads to account creation, not the waitlist
- Email input field (secondary, for people not ready to sign up) accepts valid email and submits to `POST /api/waitlist`
- Successful submission shows confirmation message
- Waitlist record is created in the database with email + timestamp + source
- Page is fully responsive (mobile, tablet, desktop)
- Page loads in under 3 seconds on 3G connection

### Security
- Rate limit on waitlist endpoint (prevent spam)
- Email validation (reject obviously invalid emails)
- No duplicate email submissions (idempotent)

### Edge Cases
- Waitlist form works without JavaScript (progressive enhancement)
- Form handles network errors gracefully (shows retry message)

---

## Cross-Cutting Tests (apply to all milestones)

### Performance
- All API endpoints respond in under 200ms (p95)
- Public profile page achieves Lighthouse performance score ≥ 90
- Pages work on slow 3G connections (test with Chrome DevTools throttling)

### Mobile
- All pages render correctly on iPhone SE (smallest common viewport)
- All pages render correctly on iPhone 15 Pro Max
- All pages render correctly on common Android phones (Samsung Galaxy S series)
- Touch targets are at least 44×44px
- No horizontal scrolling on any mobile viewport

### Accessibility
- All pages pass axe-core automated accessibility audit with 0 violations
- All interactive elements are keyboard-navigable
- All images have alt text
- Color contrast meets WCAG AA standards (verify navy text on cream background)

### Data Integrity
- All foreign keys in seed data resolve correctly
- No orphaned records (documents without vessels, QR tokens without vessels, payments without vessels)
- MXE-ID uniqueness is enforced at the database level
- Email uniqueness is enforced at the database level
- Vessel updated_at timestamp changes on every PATCH
- **`qr_status` never transitions from `'active'` back to `'pending_payment'` under any code path** — write a test that specifically tries to trigger this via a subscription-cancellation webhook and asserts it does NOT happen

### MXE ID format — resolve then lock in
- Once the sequential-vs-randomized question is actually decided (see the flag at the top of this doc), add one specific test here asserting the chosen format, and remove the "either scheme" hedging from P0-D's tests above.

---

## Verification Checklist (run before any demo)

Before Ben walks into a marina for any future pilot demo — not required for the current self-serve-only launch, but worth keeping for later — the following must be true:

1. Scanning a physical QR sticker with iPhone camera → shows scan animation → loads Discovery One public profile
2. The public profile looks identical to `moxie_digital_profile_all_roles.html` (public render)
3. Ben can log in on his phone via email + password → sees full owner profile with both vessels
4. Switching to Polaris in fleet view loads the Polaris profile
5. No private data (phone numbers, insurance policies, HIN) is visible without logging in
6. Page loads in under 3 seconds on cellular connection
7. All status badges show correct states (Current green, not expired red)

**Verification checklist for the actual current launch (self-serve funnel):**

1. A brand-new visitor can go from homepage → account creation (email + password) → intake → payment (Stripe test mode) → active QR, with zero manual intervention from Ben
2. A declined test card fails gracefully and doesn't leave the vessel in a broken partial state
3. Skipping the photo upload doesn't block any step of the flow
4. A Basic-tier signup and a Full-Access signup both reach an active, scannable QR
5. Subscription cancellation (simulated) downgrades tier without deactivating the QR or the account
