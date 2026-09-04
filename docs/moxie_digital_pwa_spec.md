# Moxie Digital — Progressive Web App (PWA)
### Build spec · not yet built

**Status:** Designed, ready to build. Open questions in §8 are refinements, not blockers.
**Why PWA rather than native:** days of work on the existing Next.js codebase rather than months on a second one, no App Store review cycle, instant updates. Native remains the eventual destination — see §7 — but not before there are real users to justify it.
**Related:** `notifyOwner()` hook (built, currently in-app banners only — push notifications plug into it), the dormant identity spec (notification gap), and the email work pending a provider decision.

---

## 1. What this actually delivers

Three things the mobile browser doesn't:

1. **An icon on the home screen.** Tap it, you're in. No typing a URL, no landing on the marketing homepage, no hunting for a login.
2. **Straight into the account.** A persisted session means the app opens on the owner's vessels, not the front door.
3. **Documents that work with no signal.** Cell service disappears offshore. Registration, insurance, and boater card need to be readable during a Coast Guard stop, a marina check-in in a dead zone, or an emergency.

The third one is the genuinely differentiated feature and the hardest to get right — §4 is about why.

**Marina marketing value:** all three matter for the on-the-dock signup scenario. "Add it to your home screen" is a real close, and the icon is what brings someone back weeks later.

---

## 2. Scope

**In:** web app manifest, service worker, install prompt, session persistence, offline document caching with explicit user control, sync-status UI, push notification permission flow (see §4 — it's load-bearing for more than notifications), and the in-app scanner (§4b).

**Out for now:** native iOS/Android apps, App Store presence, background sync of edits made offline (read-only offline is the v1 target — see §8), camera-specific native integrations beyond the scanner.

**Payment stays exactly as built.** This is a real advantage of the PWA route worth stating explicitly: a native App Store app selling digital subscriptions generally must route them through Apple's In-App Purchase system — meaning rebuilding the Stripe subscription logic a second time against Apple's APIs and giving Apple a cut of every subscription. A PWA is not distributed through the App Store, so none of that applies. The account-level Stripe billing already built works unchanged. Do not introduce any alternate payment path.

---

## 2b. The scanner — differentiator and patent implementation

A phone scanning *another* vessel's QR sticker at the dock is something the desktop web experience structurally cannot do, and it's the clearest reason for the app to exist beyond convenience.

**Architectural requirement, and this matters more than it looks:** the scanner must call the **same role-filtered API** the web vessel profile calls. Not a parallel, app-specific rendering path. One field-visibility map, multiple front-ends.

Two reasons:
1. **Correctness.** A duplicate rendering path is how the app and web end up silently disagreeing about who is allowed to see what — a privacy failure that would surface as "the app showed a stranger my phone number."
2. **It is the patent's actual claim.** Role-differentiated rendering from a single source is the mechanism the provisional patent covers. A simplified "just show the public view" scanner loses the point.

Behavior:
- A logged-in owner scanning someone else's boat gets the **public** view of that vessel — they aren't its owner, and the existing filter already handles this correctly.
- An owner scanning **their own** boat gets the owner view.
- If Marina/Coast Guard roles are ever reactivated (currently paused), an authenticated marina user scanning a vessel at their marina gets the marina-tier view — through the identical filter, with no new rendering path.
- Scanning a **dormant** vessel should surface the dormant-state page per the dormant identity spec, including its claim/reactivate invitation.

---

## 3. Install and session

- **Web app manifest** with Moxie branding — name, short name, icons at required sizes, `display: standalone`, theme color navy `#0d1f35`, background cream `#f5f2ec`.
- **Install prompt.** Android/Chrome fires a native install prompt that can be triggered programmatically. **iOS does not** — installation requires Safari → Share → Add to Home Screen, which the user must do manually. That friction is real and matters for the dock-side signup scenario: build a short, clear in-app instruction card for iOS users rather than assuming they'll figure it out.
- **Session persistence.** Opening the installed app should land on the owner's vessel dashboard, already signed in. Long-lived sessions with secure refresh — the whole point is not re-authenticating every time. Confirm how this composes with the existing Supabase auth session handling rather than bolting on a parallel mechanism.
- **Launch target** is the dashboard, not the marketing homepage.

### 3a. Domain decision (2026-09-03)

`moxieyacht.com` and `moxieyachting.com` are one Vercel deployment but **two
separate browser origins** — there's no shared cookie domain between them, so
a session established on one does not carry to the other. That's a real
problem for "install and launch straight into the dashboard," so it needed a
resolved answer before session persistence or the install prompt could be
built:

- **`moxieyacht.com` is canonical and session-aware** — auth, dashboard,
  admin, MXE vessel scans (`/[mxeId]`), and the PWA all live here. This is
  where the app is installed from.
- **`moxieyachting.com` is marketing-only** — homepage, pricing, and other
  informational pages. It never carries a session and is not
  install-eligible (no manifest link, no service worker registration).
- Any app-route request that lands on `moxieyachting.com` anyway
  (`/login`, `/signup`, `/dashboard`, `/admin`, `/auth`, `/transfer`,
  `/[mxeId]`, etc.) 301-redirects to the same path on `moxieyacht.com` in
  middleware. The bare root (`/`) on `moxieyacht.com` redirects the other
  way, to the `moxieyachting.com` homepage — the short domain exists for
  badge scans, not as a second marketing entry point.
- Marketing CTAs (sign up, log in, dashboard) link straight to
  `moxieyacht.com` rather than relying on the redirect.

This wasn't an arbitrary pick: `NEXT_PUBLIC_BASE_URL` (used for billing
portal returns and share links) and the Stripe webhook were already pointed
at `moxieyacht.com`, and the printed QR badges already encode
`moxieyacht.com/{mxeId}` URLs. Making it canonical formalizes what was
already true in practice.

---

## 4. Offline documents — and the constraint that shapes everything

**The problem, stated plainly:** iOS Safari evicts cached data on a least-recently-used basis. Data from infrequently-visited origins is deleted first when the device is under storage pressure.

A boat owner opens Moxie a handful of times a year. That is exactly the profile iOS evicts. And the offline moment we care about — a Coast Guard stop with no signal — is rare-but-critical. **The cache is most likely to have been cleared precisely when it's needed.** Silent automatic caching would produce a feature that appears to work in testing and fails in the field.

Three design responses, all required:

**a) Request persistent storage.** The Persistent Storage API (Safari 17+) lets an app request protection from automatic eviction. **It requires notification permission to be granted.** This means the push-permission prompt is not optional garnish — it's what protects the offline cache. Design the onboarding to ask for it with a reason the user actually cares about ("so your documents stay on your phone when you're out of service"), not a generic permission nag.

**b) Explicit "save for offline," not silent caching.** The user deliberately taps to keep a vessel's documents on their phone. A promise the user made to themselves is one they understand; a silent cache that might be gone is worse than no promise. Storage quota is generous (Safari 17 raised it to as much as 60% of disk per origin), so this isn't a space constraint — it's a trust and comprehension one.

**c) Honest status in the UI.** Show "Available offline · last synced [date]" on any vessel with cached documents, and surface it clearly if the cache is gone. The user should discover an eviction while sitting at home, not while standing in front of the Coast Guard.

**Caching strategy:** cache-first for documents and the app shell; network-first for anything dynamic (vessel data, share links, billing). Never cache POST/PUT/DELETE. Clean up old cache versions on service worker `activate`.

**What to cache per vessel:** the documents (registration, insurance, boater card), core vessel identity fields, and the primary photo. Not: share links, billing, admin surfaces, or anything belonging to another user.

---

## 5. Push notifications

Push works on iOS 16.4+ (outside the EU — see §7) and on Android. This matters for two reasons:

1. **It's the eviction protection dependency** from §4a.
2. **It partially fills the notification gap.** The `notifyOwner()` hook currently only renders in-app banners, which reach nobody who has stopped logging in — exactly the population that lapses, misses a grace window, or ignores a pending transfer. Push reaches them.

Push should plug into the existing `notifyOwner()` function, not create a parallel notification path. Email, when the provider is chosen, plugs into the same place. One hook, three delivery channels.

**Don't over-notify.** The events worth a push: transfer awaiting your acceptance, transfer expiring, payment failed, grace window closing, correction request resolved. Not: marketing, tips, engagement nudges.

---

## 6. Security considerations

- Cached documents sit on the device. Confirm they're scoped per-user and cleared on sign-out — a shared or borrowed phone must not leak the previous user's registration and insurance.
- The service worker must never cache authenticated API responses in a way another account could read.
- Offline data should respect the same tier gating as online: a Basic account's locked documents shouldn't become readable by virtue of being cached.

---

## 7. Known platform risk

Apple removed standalone PWA support in the EU under the Digital Markets Act (iOS 17.4) — PWAs there open in Safari tabs with no push. Irrelevant to California, Florida, and Washington, which are the current target markets.

The broader point stands though: **Apple controls whether this keeps working.** That's a genuine argument for native eventually, and a reason not to build the entire product identity around PWA-only capabilities. Revisit native when there are enough users that App Store presence, a durable offline store, and independence from Apple's PWA policy justify the cost.

---

## 8. Open questions — resolved (2026-09-04)

1. **Offline write support.** Resolved: read-only for v1. No mutation queue, no offline editing.
2. **Which vessels cache by default?** Resolved: automatic for a single-vessel owner (the common case). Once an owner has more than one vessel, caching becomes explicit opt-in per vessel rather than automatic for all — "automatic" means the same save flow runs without a tap, not that it happens invisibly; the sync-status UI (§4c) still shows what's cached and when, same as the explicit case.
3. **iOS install instruction placement.** Resolved: unchanged from what shipped in build-order step 1 — the dashboard banner (Android `beforeinstallprompt` trigger / iOS Share-sheet card).
4. **Does the install prompt belong in the marina signup flow?** Resolved: yes, specifically — mounted on `/dashboard/[mxeId]/qr`, right after a new vessel's payment succeeds. Not in the intake form itself; the QR-reveal moment (badge is real, registration just completed) is the natural close, matching §1's "marina marketing value" note.
5. **Notification permission timing.** Resolved: requested the first time an owner taps "save for offline" (or, for the automatic single-vessel case, the first time that flow runs) — not at first launch. Ties the ask to the moment its value (eviction protection) is concretely relevant, per §4a.

---

## 8b. Prior art in the repo — check before designing anything

An earlier app prototype (`moxie_app.jsx`) and a readiness doc (`moxie_app_build_readiness.md`) predate this spec. **Two things in them are worth reusing; several assumptions in them are now wrong.**

**Worth reusing:**
- The **five-tab shell** — Profile / Docs / Scan / Fleet / Account. Sound structure, mirrors the web dashboard's own organization, brand-accurate. No need to redesign navigation from scratch.
- The **scanner concept**, now specified properly in §2b above.
- `PixelM.tsx` already exists as a working React SVG component in production use (marketing nav/footer, dashboard header, `ScanSuccess`). The app icon starts from this, not from scratch — what's missing is the Application 01 icon treatment (navy gradient background, 55%-opacity corner cells, superellipse radius) and the exported size set.

**Now outdated — do not build from these:**
- The prototype assumes **magic-link auth**. The app actually uses password auth with a built password-reset flow. Match what exists.
- It assumes a **marina-only location model**. Location is now structured state → storage type → city, covering every storage type.
- It has **no tier awareness**. Tiers are now real and account-level: Basic $59/yr (2 vessels, 3 documents), Full $149/yr (5 vessels, unlimited documents, 500MB cap).
- Its **payment guidance** centers on the Apple IAP / "reader app" question. Moot for a PWA — see §2.

**Check and likely remove:** the readiness doc references `AppDownloadSheet` and `OnboardingAppPrompt` components that prompt users to "Download on the App Store." No such app exists. If these are live on the marketing site or in the signup funnel, they are advertising something unavailable — the same standard applied to the homepage banner and the broker preview page. Verify whether they render anywhere, and remove or repoint them at the PWA install flow.

---

## 9. Build order suggestion

1. Manifest, icons, install prompt, standalone display — the "it's an app" layer.
2. Session persistence and launch-to-dashboard.
3. Service worker with app-shell caching (offline app loads, even without documents).
4. Explicit document caching, persistent storage request, sync-status UI.
5. Push notifications wired into `notifyOwner()`.

Steps 1–3 are meaningful on their own and could ship before 4–5 are finished.
