# Moxie Lite — Cursor Build Prompt
## Complete the owner onboarding flow: intake → photo/doc upload → MXE ID → QR code

---

## Context & Codebase State

This is a Next.js 15 App Router project with Supabase auth and Postgres. The following already exists and must NOT be modified:

- `/src/app/[mxeId]/page.tsx` — vessel public/owner profile viewer (working)
- `/src/components/VesselPublicProfile.tsx` — public profile rendering
- `/src/components/VesselOwnerProfile.tsx` — owner profile rendering
- `/src/lib/vessel-service.ts` — `fetchVesselByMxeId`, `filterVesselForRole`
- `/src/types/vessel.ts` — `VesselRecord`, `ProfileRole` types
- `/src/app/signup/` and `/src/app/login/` — auth flows (working)
- `/src/app/layout.tsx` — fonts: `--font-display` (Cormorant Garamond italic), `--font-dm` (DM Sans)
- `/src/app/globals.css` — design tokens (use these, never hardcode colors)

**Design tokens to use throughout:**
```
--navy: #0d1f35          (primary dark)
--navy-deep: #071020     (header bg)
--gold: #c9a84c          (accent)
--cream: #f5f2ec         (page bg)
--cream2: #ede9e0        (card bg)
--aqua-bright: #17c3b2   (success/CTA)
--divider: rgba(13,31,53,0.1)
--text: #0d1f35
--text2: #3a5068
--text3: #6b8299
```

**Typography pattern:**
- Headers: `font-[family-name:var(--font-display)] italic font-light text-[var(--navy)]`
- Labels: `font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]`
- Body: `font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]`

---

## What Needs to Be Built

### Task 1 — Supabase Storage Buckets (run these SQL migrations)

```sql
-- Enable storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('vessel-photos', 'vessel-photos', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('vessel-docs', 'vessel-docs', false);

-- Vessel photos: public read, owner write
CREATE POLICY "Public read vessel photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'vessel-photos');
CREATE POLICY "Owner upload vessel photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'vessel-photos' AND auth.uid() IS NOT NULL
  );

-- Vessel docs: owner read/write only
CREATE POLICY "Owner read vessel docs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL
  );
CREATE POLICY "Owner upload vessel docs" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL
  );
```

Also add columns to vessels table if not present:
```sql
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_registration_url TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_insurance_url TEXT;
```

### Task 2 — MXE ID Auto-Generation (server action)

Create `/src/lib/mxe-id.ts`:
- Use Supabase service role client (server-side only)
- Query `SELECT mxe_id FROM vessels ORDER BY mxe_id DESC LIMIT 1`
- Parse the number, increment by 1, return formatted as `MXE-00001` (5 zero-padded digits)
- Use a Postgres advisory lock or upsert pattern to prevent race conditions
- Export: `async function generateNextMxeId(): Promise<string>`

### Task 3 — Owner Dashboard `/dashboard`

Create `/src/app/dashboard/page.tsx` (server component, requires auth):

**Auth gate:** Use `createSupabaseServerClient()`. If no session, redirect to `/login?next=/dashboard`.

**Page layout:**
- Header: same sticky navy header as vessel pages, show user email + sign out button
- If user has no vessels: show empty state with "Register your first vessel →" CTA button (aqua)
- If user has vessels: show a card grid — one card per vessel with:
  - Vessel photo (or placeholder anchor icon if none)
  - Vessel name, make/model/year
  - MXE ID badge in gold
  - "View public profile" link → `/{mxeId}`
  - "Manage" link → `/{mxeId}?role=owner`
  - QR code download button (see Task 5)

Query: `SELECT * FROM vessels WHERE owner_id = auth.uid()`

### Task 4 — Vessel Intake Form `/dashboard/new`

Create `/src/app/dashboard/new/page.tsx` — a multi-step form for registering a new vessel.

**Auth gate:** Requires session. Redirect to `/login?next=/dashboard/new` if not authenticated.

**3-step wizard (show progress indicator: Step 1 / 2 / 3):**

**Step 1 — Vessel Basics:**
- Vessel Name (required, text)
- Vessel Type (select: Sailboat / Powerboat / Catamaran / Trawler / Dinghy / Other)
- Make / Manufacturer (required, text)
- Model (required, text)
- Year (required, number, 1900–2030)
- Length (ft, number, optional)
- Draft (ft, number, optional)
- Public Notes (textarea, optional — "Visible to anyone who scans your QR")

**Step 2 — Photo & Documents:**
- Vessel Photo upload (image/*, max 10MB) — upload to `vessel-photos` bucket at path `{userId}/{mxeId}/photo.{ext}`, store public URL in `photo_url`
- Registration Document (PDF or image, optional) — upload to `vessel-docs` bucket at `{userId}/{mxeId}/registration.{ext}`, store URL in `doc_registration_url`
- Insurance Card (PDF or image, optional) — upload to `vessel-docs` at `{userId}/{mxeId}/insurance.{ext}`, store URL in `doc_insurance_url`
- Show upload progress bar (aqua color)
- Photo preview after upload

**Step 3 — Review & Confirm:**
- Show summary of entered data
- Show the MXE ID that will be assigned (generate it server-side when user reaches this step, hold it temporarily)
- "Register Vessel" button

**On submit:**
1. Call server action `createVessel(data)`:
   - Generate MXE ID via `generateNextMxeId()`
   - INSERT into `vessels` table with `owner_id = auth.uid()`
   - Return the new `mxe_id`
2. Redirect to `/dashboard/[mxeId]/qr`

**Form state:** Use React `useState` + client component. Keep it simple — no external form library needed.

**Validation:** Required fields show inline error on blur. Can't proceed from step 1 without vessel name, make, model, year, type.

### Task 5 — QR Code Generation `/dashboard/[mxeId]/qr`

Create `/src/app/dashboard/[mxeId]/qr/page.tsx`:

**Install qrcode package:**
```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

**Server component** — generates QR on the server.

**QR target URL:** `https://moxieyacht.com/{mxeId}` (use env var `NEXT_PUBLIC_BASE_URL` with fallback to `https://moxieyacht.com`)

**Page layout:**
- Success header: aqua checkmark icon + "Your vessel is registered"
- MXE ID displayed large in gold: `MXE-00001`
- QR code rendered as SVG (use `qrcode.toString(url, { type: 'svg' })`)
- Framed in a navy card with cream background — print-ready appearance
- Below QR: vessel name + moxieyacht.com/{mxeId} URL in small text
- Two buttons:
  - "Download QR (PNG)" — client-side canvas render + download via `qrcode` toDataURL
  - "View Your Profile →" — links to `/{mxeId}?role=owner`
- Instructional note: "Print this and affix it to your vessel. Anyone with a phone can scan it."

**Also generate a printable page** at `?print=1` — just the QR code + MXE ID + URL, white background, no nav, optimized for sticker printing.

### Task 6 — Post-signup Redirect

After a user signs up via `/signup`, redirect them to `/dashboard` instead of the homepage. Update `/src/app/auth/callback/route.ts` and the `nextPath` default in `SignupForm` to point to `/dashboard`.

---

## File Structure to Create

```
src/
  app/
    dashboard/
      page.tsx                    (Task 3 — vessel list)
      new/
        page.tsx                  (Task 4 — intake wizard, client component)
        actions.ts                (server action: createVessel)
      [mxeId]/
        qr/
          page.tsx                (Task 5 — QR display)
          QrDownload.tsx          (client component for PNG download button)
  lib/
    mxe-id.ts                     (Task 2 — ID generation)
```

---

## Constraints

- **Never use hardcoded hex colors** — always use CSS custom properties from globals.css
- **Mobile-first** — all pages must look good at 390px width (iPhone)
- **No new UI libraries** — use Tailwind only, following existing patterns in the codebase
- **Supabase RLS** — all DB writes must go through server actions using the service role client, never expose service role key to the browser
- **Error states** — every form and upload must handle and display errors gracefully
- **Loading states** — uploads and submissions must show spinners/progress, disable the submit button while pending

---

## Design Reference

The existing `VesselPublicProfile` and `VesselOwnerProfile` components show the correct card/row pattern. The `MoxieMarketingHome` shows the correct nav pattern. Match these exactly — cream page bg, navy headers, gold accents, DM Sans body, Cormorant Garamond italic display text.

The Pixel M logo SVG is in `PixelM.tsx` — reuse it in dashboard headers.
