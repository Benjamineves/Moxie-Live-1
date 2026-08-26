# Moxie Platform — Acceptance Test Plan v1

> **For:** Matt + coding agents  
> **Source:** Build priority table from Technical Handoff v1  
> **Rule:** A milestone is not done until every test in its section passes.  
> **Convention:** Each test is written as a concrete, verifiable assertion. No ambiguity.

---

## How to use this document

Each milestone from the build priority table has a test section below. Tests are grouped by what they verify: **happy path** (it works), **security** (unauthorized access fails), and **edge cases** (weird inputs don't break things).

Coding agents: implement these as automated tests (Jest, Playwright, or whatever test framework you choose). The test descriptions are written to be directly translatable into test function names.

---

## P0-A: Static Public Profile Render

**What it unlocks:** Scan QR → see Discovery One's public profile. First live demo.

### Happy Path
- `GET /api/vessels/MXE-00001?role=public` returns 200 with JSON containing: vessel_name, make, model, year, length_ft, draft_ft, vessel_type, marina_name, marina_city, mxe_id, photo_url, public_notes
- Response JSON for MXE-00001 contains `vessel_name: "Discovery One"`, `make: "Nimbus"`, `model: "T8"`, `year: 2023`
- Public profile page renders vessel name "Discovery One" in the hero section
- Public profile page renders spec strip with Make, Year, Length, Type, Draft values
- Public profile page renders marina name "Portobello Marina" with city "Oakland, CA"
- Public profile page renders "Moxie Registered Vessel" verified badge with MXE-00001
- HIN field displays "Private" (not the actual HIN value) in public view
- Public notes text is visible on the public profile

### Security
- `GET /api/vessels/MXE-00001?role=public` response does NOT contain: owner_name, owner_phone, owner_email, emg_name, emg_phone, ins_policy, ins_broker, ins_liability, hin (full value), uscg_doc_number, official_number, slip_number, slip_notes, engine, fuel_type, max_persons, lifejackets
- No private fields leak into the HTML source of the public profile page (search page source for "312-465", "Novamar", "NIM12341", "MAR-2025")
- Insurance and registration are shown as status only ("Current" badge) with no policy numbers or detail

### Edge Cases
- `GET /api/vessels/MXE-99999?role=public` returns 404
- `GET /api/vessels/INVALID?role=public` returns 404 (not 500)
- `GET /api/vessels/MXE-00001?role=owner` without auth returns 401 (not public data)
- `GET /api/vessels/MXE-00001` (no role param) defaults to public render

---

## P0-B: Scan-Success Animation → Redirect

**What it unlocks:** Scanning feels like a product, not a link click. Brand moment.

### Happy Path
- `GET /api/vessels/MXE-00001/preview` returns 200 with minimal JSON: vessel_name, make, model, year, vessel_type (5 fields only)
- Navigating to `moxie.sh/MXE-00001?scan=1` loads the scan-success animation page
- Animation displays vessel name "Discovery One" and metadata "2023 Nimbus T8 · Power"
- Animation displays MXE-00001 scan ID
- Animation completes in approximately 2.4 seconds
- After animation completes, page redirects to the vessel profile URL
- Redirect destination includes appropriate role parameter based on session state
- If no session: redirects to `?role=public`
- If valid owner session: redirects to `?role=owner`
- If valid marina session: redirects to `?role=marina`

### Security
- `/api/vessels/MXE-00001/preview` returns ONLY the 5 public preview fields, no private data
- Preview endpoint does not require authentication

### Edge Cases
- `moxie.sh/MXE-99999?scan=1` shows a graceful "vessel not found" state (not a broken animation)
- Animation works on mobile Safari, mobile Chrome, desktop Chrome, desktop Safari
- Animation works without JavaScript (degrades to direct redirect)

---

## P0-C: Owner Auth + Owner Profile Render

**What it unlocks:** Ben can log in, see his full profile, edit it.

### Happy Path
- Owner can register with email and password
- Owner can log in with email and password → receives JWT
- `GET /api/vessels/MXE-00001?role=owner` with valid owner JWT returns ALL vessel fields
- Owner profile page renders the full spec strip including HIN (masked as "NIM·····234")
- Owner profile page renders Home Marina section with Portobello Marina, Oakland CA, Slip 38, phone
- Owner profile page renders Documents on File section with status badges (USCG Documentation: Current, Marine Insurance: Current, CA Boater Card: Current)
- Owner profile page renders owner contact section (name, phone, email)
- Owner profile page renders emergency contact section (even if empty — shows "Add emergency contact" prompt)
- Owner profile page renders Edit Profile button
- Owner can update vessel_name via `PATCH /api/vessels/MXE-00001` with owner JWT → returns 200, database updated
- Owner profile page renders "My Fleet" tab showing both vessels (Discovery One + Polaris)
- Clicking Polaris in fleet switcher loads MXE-00002 owner profile
- Owner profile page renders bottom navigation: Profile, My Fleet, Docs, Account
- `GET /api/users/{userId}/fleet` with owner JWT returns array of 2 vessels

### Security
- `GET /api/vessels/MXE-00001?role=owner` without JWT returns 401
- `GET /api/vessels/MXE-00001?role=owner` with JWT belonging to a DIFFERENT user returns 403
- `PATCH /api/vessels/MXE-00001` with JWT belonging to a different user returns 403
- Owner cannot see another owner's vessels via `/api/users/{otherUserId}/fleet`
- JWT expires after reasonable period (e.g., 7 days)
- Password reset flow works via email

### Edge Cases
- Owner with 0 vessels sees empty fleet with "Register a new vessel" CTA
- Owner with expired insurance sees amber/red status badge (not green "Current")
- HIN masking works correctly: shows first 3 chars + dots + last 3 chars
- Long vessel names don't break the hero layout
- Missing photo_url renders the decorative navy/gold gradient background (no broken image)

---

## P0-D: Vessel Intake Form → Creates DB Record

**What it unlocks:** New vessels can be registered by owner. Second vessel added.

### Happy Path
- Intake form has 4 steps: Vessel Identity → Location & Mooring → Documents → Owner Info
- Step 1 collects: vessel_name, type, make, model, year, length, draft, HIN, engine, fuel_type, max_persons, public_notes
- Step 2 collects: marina (select or enter), slip_number, marina_phone, is_liveaboard, slip_notes
- Step 3 collects: registration number, registration expiry, registration file upload, insurance carrier, insurance broker, insurance policy, insurance expiry, insurance liability, insurance file upload, boater card file upload
- Step 4 collects: owner_name, owner_phone, owner_email, preferred_contact, emergency_name, emergency_relationship, emergency_phone, safety equipment (lifejackets, fire_ext, flares)
- Submitting form via `POST /api/vessels` with owner JWT creates a new vessel record
- New vessel is assigned the next sequential MXE-XXXXX ID automatically
- QR token record is created automatically when vessel is created
- New vessel appears in owner's fleet list immediately after creation
- File uploads store to Supabase Storage and file_url is saved to vessel_documents
- Live preview panel updates in real-time as form fields are filled

### Security
- `POST /api/vessels` without JWT returns 401
- File upload validates MIME type: only PDF, JPG, PNG accepted
- File upload validates size: max 10MB per file
- File upload stores to private bucket with signed URLs (not public)
- XSS prevention: vessel_name and all text fields are sanitized before storage and rendering

### Edge Cases
- Form preserves state when navigating between steps (step 1 → step 3 → back to step 1 retains data)
- Submitting with only required fields (vessel_name, make, model, year, type) succeeds
- Submitting with all fields populated succeeds
- Duplicate vessel_name is allowed (two boats can have the same name)
- HIN field accepts various formats (alphanumeric, no strict validation in v1)
- Year field accepts reasonable range (1900–current year + 1)

---

## P1-A: Marina Operator Render + Auth

**What it unlocks:** Emery Cove pilot demo. Show harbor master what they see when they scan.

### Happy Path
- Marina operator can log in with email/password → receives JWT with marina_operator role
- `GET /api/vessels/MXE-00001?role=marina` with marina JWT returns marina-tier fields
- Marina view shows: all public fields PLUS slip_number, marina_phone, is_liveaboard, slip_notes, owner_name, owner_phone, owner_email, emg_name, emg_phone, emg_relationship
- Marina view shows insurance status badge ("Current" / "Expiring" / "Expired") but NOT policy number or liability amount
- Marina view shows registration status badge but NOT full registration number
- Marina view includes "Call Owner" action button with tel: link
- Marina view includes "Call Emergency" action button with tel: link
- Marina view is read-only — no Edit button, no PATCH capability

### Security
- Marina operator can ONLY see vessels at their assigned marina
- Marina operator at Emery Cove CANNOT see vessels at Portobello Marina (unless those vessels are also at Emery Cove)
- Marina view does NOT show: ins_policy, ins_liability, ins_broker, hin, uscg_doc_number, official_number, engine, fuel_type, max_persons, lifejackets, fire_ext, flares
- `PATCH /api/vessels/MXE-00001` with marina JWT returns 403

### Edge Cases
- Marina with 0 vessels shows empty state
- Vessel with expired insurance shows prominent warning in marina view
- Marina operator account creation is admin-only (no self-signup in v1)

---

## P1-B: QR Code Generation + Sticker PDF

**What it unlocks:** Produce the actual printable sticker file for hull placement.

### Happy Path
- `GET /api/vessels/MXE-00001/qr.pdf` with owner JWT returns a downloadable PDF
- PDF is 3" × 3" at 600 DPI resolution
- QR code encodes the URL: `moxie.sh/MXE-00001?scan=1`
- QR code uses Level H error correction
- Navy + Gold colorway: dark cells #071020, background #0d1f35, if applicable
- "MOXIE" text appears below QR grid in uppercase
- QR code scans successfully with iPhone camera app
- QR code scans successfully with Android camera app
- Scanning the QR from the PDF loads the scan-success animation

### Security
- Only the vessel owner can generate their vessel's QR PDF
- QR PDF endpoint requires owner JWT

### Edge Cases
- QR code remains scannable when printed on weatherproof vinyl (test with Level H damage tolerance — cover 25% of QR and verify scan still works)
- Long MXE IDs don't break QR density below scannable threshold

---

## P2-A: Document Upload + Storage

**What it unlocks:** Insurance cards, registration docs actually stored and accessible.

### Happy Path
- Owner can upload PDF via `POST /api/vessels/MXE-00001/documents` with owner JWT
- Upload returns a document record with file_url pointing to Supabase Storage
- `GET /api/vessels/MXE-00001/documents/{docId}` generates a signed URL (15-minute expiry)
- Signed URL allows direct download of the document
- Document list on owner profile shows: file name, doc type, status badge, file size
- Owner can upload JPG/PNG images (insurance card photos)
- Document status automatically computed from expiry dates: green (>30 days), amber (≤30 days), red (expired)

### Security
- Signed URLs expire after 15 minutes
- Document access is role-gated per the field-to-role map:
  - Owner: sees all documents
  - Marina: sees insurance + registration documents only
  - Coast Guard: sees all documents
  - Public: sees NO documents
- Direct S3/Storage URLs are not publicly accessible (private bucket)
- MIME type validation on upload (PDF, JPG, PNG only)
- File size limit enforced (10MB max)

### Edge Cases
- Uploading a new insurance document when one already exists replaces the old record (or creates a version history — TBD)
- Corrupt PDF upload returns meaningful error
- 0-byte file upload is rejected

---

## P2-B: Coast Guard Render

**What it unlocks:** Full compliance view. Required before any law enforcement demo.

### Happy Path
- `GET /api/vessels/MXE-00001?role=coastguard` with CG auth returns ALL vessel fields including full HIN, policy numbers, safety equipment
- CG view shows "Coast Guard Boarding View" header with shield icon
- CG view shows full HIN (unmasked): "NIM12341H223"
- CG view shows Registration & Documentation table: USCG Doc Number, Official Number, HIN, Registration Expiry, Home Port, Flag
- CG view shows Insurance table: Carrier, Agent/Broker, Policy Number, Coverage Expiry, Liability
- CG view shows Propulsion & Safety table: Engine, Fuel Type, Life Jackets, Flares, Fire Extinguisher, Sound Device
- CG view shows Owner & Emergency Contact with "Call Owner" button
- CG view shows CA Boater Card status

### Security
- CG auth method TBD (per open questions in handoff). Whichever method is chosen, it must be validated server-side.
- CG view does NOT allow editing
- CG cannot access document files that aren't relevant to boarding inspection

### Edge Cases
- Vessel with incomplete safety data shows "Not on file" rather than blank cells
- CG view works well on tablet screens (boarding inspections often use tablets)

---

## P3: Marketing Site with Waitlist Backend

**What it unlocks:** Captures emails from moxieyachting.com.

### Happy Path
- Homepage loads at moxieyachting.com with hero, how-it-works, role overview, profile mockup, and contact/waitlist sections
- Email input field accepts valid email and submits to `POST /api/waitlist`
- Successful submission shows confirmation message
- Waitlist record is created in the database with email + timestamp + source
- Page is fully responsive (mobile, tablet, desktop)
- Page loads in under 3 seconds on 3G connection

### Security
- Rate limit on waitlist endpoint (prevent spam)
- Email validation (reject obviously invalid emails)
- No duplicate email submissions (idempotent — second submit for same email returns success without creating duplicate)

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
- No orphaned records (documents without vessels, QR tokens without vessels)
- MXE-ID uniqueness is enforced at the database level
- Email uniqueness is enforced at the database level
- Vessel updated_at timestamp changes on every PATCH

---

## Verification Checklist (run before any demo)

Before Ben walks into Emery Cove Marina for the pilot demo, ALL of the following must be true:

1. Scanning a physical QR sticker with iPhone camera → shows scan animation → loads Discovery One public profile
2. The public profile looks identical to `moxie_vessel_profile_all_roles.html` (public render)
3. Ben can log in on his phone → sees full owner profile with both vessels
4. Switching to Polaris in fleet view loads the Polaris profile
5. No private data (phone numbers, insurance policies, HIN) is visible without logging in
6. The marina operator demo account can scan the same QR → sees the marina view with owner contact info
7. Page loads in under 3 seconds on cellular connection
8. All status badges show correct states (Current green, not expired red)
