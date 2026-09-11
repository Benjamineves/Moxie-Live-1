# Moxie Digital — Brand Addendum Integration
### Audit & action list · Brand Guide v1.1, Part II

**Source:** `Moxie — Brand Guide (Complete) v1.1`, April 2026. Part I (foundation) was already being followed. **Part II (Addendum v1) has never been applied to the product.**
**Purpose:** translate the addendum into concrete work against the actual codebase, and flag where the guide itself has drifted since April.

---

## 1. What's already correct

Verified against `docs/design/moxie_digital_share_profile.html`: the design token set already matches the guide exactly, **including all four aqua roles**.

```
--navy #0d1f35   --gold #c9a84c    --cream #f5f2ec
--navy2 #132943  --gold-lt #dfc06a --cream2 #ede9e0
--navy3 #1a3a5c  --navy-deep #071020
--aqua-lagoon #1FA394  --aqua-bright #17C3B2
--aqua-vapor  #13F1D1  --aqua-abyss  #0B6E6A
```

**Live app audit — completed, zero deviations.** `web/src/app/globals.css` is the single source of design tokens (no separate Tailwind config; everything styles off these CSS custom properties) and every value matches the guide exactly. The app is in fact *more* correct than the design file: `--gold-dim` and `--gold-line` are `0.15`/`0.35` in the app (guide-correct) versus `.12`/`.3` in `moxie_digital_share_profile.html`. Fix the design file, not the app.

**Two ad-hoc aqua shades found in the app** — both in `SharedVesselProfile.tsx`, both outside the four-role system, both natural to fix during the §7 item 5 aqua audit rather than now:
- Line 40 — header gradient from `--aqua-abyss` to a hardcoded `#0d3830`, an undocumented fifth shade. Also violates Part I's "no gradients except the gold radial glow."
- Line 46 — badge text in hardcoded `#7fe8dc` on translucent aqua-bright. Another invented shade.

**Correction to earlier artifacts.** Several documents produced outside the app carried an incorrect palette — navy `#0F2340`, cream `#F5F2E9`, an invented aqua `#17A398`, and non-guide text/divider colors. None of these came from the brand guide. Affected and now corrected: `moxie_digital_pwa_spec.md`, `moxie_digital_broker_preview.html`, and the revenue calculator. The PWA spec was the consequential one — a manifest `theme_color` becomes the actual chrome color on every installed device, so building from the uncorrected spec would have made a wrong navy real. The broker preview and calculator now use Lagoon `#1FA394`, which is also the correct *role* for both surfaces per the guide's context matrix (partner-facing pages and dashboard chart accents).

---

## 2. What's genuinely new and entirely missing

### The Mark Family — neither mark exists in the product

The addendum introduces two marks alongside the unchanged italic wordmark:

| | Anchored M | Pixel M |
|---|---|---|
| Role | Heritage seal · ceremonial | Digital signal · operational |
| Where | Wax seals, embossed stationery, patches, hull decal trim, business cards, letterhead | **App icon, favicon, QR sticker branding, scan-confirmation, in-app chrome** |
| Rules | Gold or navy only. Never aqua. Never animated. | Can animate. Carries the aqua signal pixel. |

**The decision rule from the guide:** *will this object still exist in ten years? → Anchored M. Will it ship, update, or refresh? → Pixel M.* The two marks never appear in the same lockup.

**Practical consequence:** almost everything in the software product is Pixel M territory. The Anchored M is for physical, ceremonial artifacts — business cards, letterhead, patches. That means the immediate product work is entirely Pixel M.

### The four-role aqua system — currently used ad hoc

Aqua is used in the product today (the share FAB, various accents) but without role discipline. The addendum makes each shade a specific job, with a hard rule: **never two aquas in one composition.**

| Shade | Role | Product usage |
|---|---|---|
| Lagoon `#1FA394` | Institutional | Marina/partner surfaces, dashboard chart lines, "verified by Moxie" |
| **Bright `#17C3B2`** | **Signal (default)** | CTAs, the Pixel M signal pixel, hull decal accent, anywhere one accent is needed |
| Vapor `#13F1D1` | Live state, **screen only** | Scan-success animation, "just updated" pulses, hover feedback. **Never printed.** |
| Abyss `#0B6E6A` | Depth | Type on Bright aqua fields, navy→abyss duotones, subdued backgrounds |

Also: **aqua is never an error color.** Errors stay on the existing red functional accent.

---

## 3. Highest-leverage item right now: the app icon

**The PWA build needs an app icon, and Application 01 is a complete, production-ready spec for one.** This is the single best piece of timing in the addendum.

```
Background     Navy gradient #0D1F35 → #0A1828 (160°)
Mark           Pixel M, gold #C9A84C, corners at 55% opacity
Signal pixel   Bright Aqua #17C3B2
Corner radius  22.5% (iOS superellipse)
Mark size      62% of icon canvas
Export sizes   1024 · 512 · 180 · 152 · 120 · 87 · 76 · 60 · 40 px
```

The PWA manifest needs exactly these sizes. Fold this directly into the PWA build rather than treating it as separate design work.

**Related scale ladder** (Pixel M at different sizes — the mark simplifies as it shrinks):
- **16×16 favicon** — omit corner brackets, omit signal pixel
- **32×32 in-app chrome** — include corner brackets, omit signal
- **56×56+ full** — all details including the aqua signal pixel

### The scan-success animation

Application 01 also specifies a delight moment that maps onto something already built: on scan success, the signal pixel fades `#17C3B2` → `#13F1D1` (Vapor), grows 2×, then returns. There's already a `ScanSuccess` component in the app. This is a small, high-impact addition — and it's the canonical use of Vapor.

---

## 4. QR badge — the spec is more complete than what's built

A badge design round was already flagged as pending (web address formatting, which mark to use). Application 02 answers most of it:

```
Substrate      3M IJ180Cv3 with 8518 gloss overlaminate
Size           3"×3" standard · 4"×4" premium
Error corr.    Level H (30% damage tolerance)
Dark cell      Navy Deep #071020
Signal cell    Bright Aqua #17C3B2 — ONE module, bottom-right
Gold rule      #C9A84C at 0.4pt, divides QR from caption
Typography     Cormorant italic (brand) · DM Sans Medium (caption)
Corner radius  10–14px
Caption        "REGISTERED VESSEL" / "SCAN · MXE-00000"
```

**The single aqua module in the bottom-right** is the notable addition — it mirrors the Pixel M's signal pixel, subtle enough not to disrupt scan integrity, and makes the badge unmistakably Moxie once you know to look. That's a genuinely good detail and it's not in the current badge.

**Cross-check needed:** the current badge carries "Patent Pending" text (added recently). The guide's caption layout doesn't account for it. Reconcile the two before any production run.

**Also verify:** the downloadable badge PNG was recently rebuilt to include MXE ID and Patent Pending. Confirm it matches this spec, particularly the dark cell color (`#071020`, not plain navy) and error correction Level H.

---

## 5. Where the guide itself has drifted

The guide is dated April 2026 — before the pivot and before the domains were settled. Flagging so it isn't followed blindly:

1. **`moxie.sh` appears throughout** — business card email `J@MOXIE.SH`, letterhead `MOXIE.SH`. That domain is dead. Current: `moxieyacht.com` (QR/share) and `moxieyachting.com` (marketing).
2. **Emeryville address** on the letterhead (2066 Powell Street). Current public positioning is "Northern California."
3. **Marina-first language** — nav examples show "FOR MARINAS," CTAs say "GET EARLY ACCESS," and the role badge set includes Marina Operator and Coast Guard. Marina and Coast Guard roles are deliberately paused; the product is boat-owner-first self-serve.
4. **Role badge set** includes roles that don't exist in the product. Only Public and Owner are built.

None of these are urgent, but the guide should be annotated or a v1.2 issued so a future designer doesn't reintroduce a dead domain.

---

## 6. Do & Don't — the six failure modes

Worth encoding wherever design decisions get made:

1. Never color the Anchored M in aqua — it lives in gold or navy only
2. Never combine two aquas in one composition
3. Aqua is never an error color
4. Never print Vapor `#13F1D1` — screen only, won't render on vinyl/paper/fabric
5. Never lock the two marks together — siblings, not twins, one per surface
6. Never stretch, skew, or rotate either mark — scale proportionally only

Plus, from Part I: no gradients except the gold radial glow, never Inter/Roboto/system fonts for headings, never navy text on navy, never pure white full-page backgrounds (use cream).

---

## 6b. Every colour token assumes a background — say which

This section exists because the same mistake shipped twice in two days,
both times found by a customer rather than by us:

- A seller **cancelled a live sale** because the cancel control on the
  transfer panel was `--text` on a dark card: **1.10:1**. The error
  message that would have explained what happened was `--red-fg` on the
  same card: **1.48:1**. Both invisible.
- The link steering sellers from decommissioning toward a transfer —
  commercially the most valuable link on that screen — was `--gold` on a
  `--gold-dim` tint: **1.80:1**.

Neither was carelessness at the call site. Both happened because a token
carries no indication of the background it was chosen against, so a
component that was correct on cream became unreadable the moment someone
wrapped it in a tinted or dark panel. The next tinted panel will
rediscover it the same way unless the pairing is written down.

**The rule: a token is defined against a surface. Moving a component to a
different surface means changing its tokens, not just its container.**

### The two pairs that exist today

| Purpose | On a DARK surface | On a LIGHT surface |
|---|---|---|
| Gold — links, triggers, accents | `--gold` `#c9a84c` | `--gold-deep` `#7d6119` |
| Danger — errors, destructive controls | `--danger-on-dark` `#ff9e80` | `--red-fg` `#712b13` |

Measured, so the choice is checkable rather than a matter of taste:

**Gold**

| | composites to | `--gold` | `--gold-deep` |
|---|---|---|---|
| on `--navy-deep` | `#071020` | **8.32:1** ✓ | 3.26:1 ✗ |
| on `--gold-dim` over `--navy-deep` | `rgb(36,39,39)` | **6.60:1** ✓ | — |
| on `--white` | `#ffffff` | 2.29:1 ✗ | **5.84:1** ✓ |
| on `--cream` | `#f5f2ec` | 2.05:1 ✗ | **5.23:1** ✓ |
| on `--cream2` | `#ede9e0` | 1.89:1 ✗ | **4.82:1** ✓ |
| on `--gray-bg` | `#f1efe8` | 1.99:1 ✗ | **5.08:1** ✓ |
| on the marketing nav (`--cream` at 92% over white) | `rgb(246,243,238)` | 2.06:1 ✗ | **5.28:1** ✓ |
| on `--gold-dim` over `--white` | `rgb(247,242,228)` | 2.04:1 ✗ | **5.22:1** ✓ |
| on `--gold-dim` over `--gray-bg` | `rgb(235,228,209)` | 1.80:1 ✗ | **4.60:1** ✓ |

`--gold-deep` clears AA at small sizes on every light surface the app
actually uses; its worst case is 4.60:1 on a `--gold-dim` panel over grey.
`--gold` clears nothing lighter than navy — not even the 3:1 large-text
floor, so a 62px display accent in `--gold` on cream fails as surely as a
10px eyebrow does.

**Danger**

| | `--danger-on-dark` | `--red-fg` |
|---|---|---|
| on `--navy-deep` | **9.47:1** ✓ | 1.86:1 ✗ |
| on `--gold-dim` over `--navy-deep` | **7.51:1** ✓ | 1.48:1 ✗ |
| on `--white` | 2.01:1 ✗ | **10.21:1** ✓ |
| on `--cream` | — | **9.14:1** ✓ |

Note that the failures are symmetrical. `--gold-deep` on navy is as wrong
as `--gold` on cream; this is a pairing, not a ranking, and "use the
darker one to be safe" is not a rule that works.

### Three things that follow from it

1. **A translucent tint is not a background.** `--gold-dim` is
   `rgba(201,168,76,.15)`, so it takes the colour of whatever is behind
   it. On `--gray-bg` it composites to `rgb(235,228,209)` — light. On
   `--navy-deep` it composites to `rgb(36,39,39)` — near black. The same
   class needs opposite text tokens in those two places, and reading the
   component alone will not tell you which.

2. **A shared class cannot assume a shared surface.** `editTriggerClass`
   had ten call sites: nine on white cards, one inside the navy transfer
   card. Correcting it for the nine would have broken the tenth, from
   8.32:1 to 3.26:1. Shared styles that can land on either kind of
   surface need two variants and a name that says which is which —
   `editTriggerClass` / `editTriggerOnDarkClass`.

3. **Hover states need checking too, and tend to be worse.** A hover is
   a state the user enters *deliberately*, to read something; it is the
   worst possible place for the least readable colour. It has gone wrong
   here in all three available ways:

   - **The text gets lighter.** The edit trigger rested at `--gold`,
     2.29:1 on white, and hovered to `--gold-lt` — 1.77:1.
   - **A readable rest state hovers into an unreadable one.** The six
     marketing nav links rest at `--text2`, a comfortable 7.51:1, and
     hovered to `--gold` at 2.06:1. Pointing at a link made it harder to
     read than ignoring it, on the public site's primary navigation.
   - **The background moves instead of the text.** `LockedDocumentRow`'s
     upgrade CTA keeps its colour and hovers `bg-[var(--gold-dim)]`,
     which lightens the surface under it. Checking the text token alone
     would have missed this one.

   So: check `hover:text-*`, `hover:bg-*`, and `hover:border-*` against
   each other, not just the resting pair.

### The one genuine exemption

The wordmark's gold **M** and aqua **.** are a logotype, and logotypes are
exempt (WCAG 1.4.3). Twelve instances in the app — eleven `M` glyphs plus
the one full "Moxie." on the shared profile's footer CTA.

Two things that look like exemptions and are not, but which this sweep
deliberately left alone:

- The 24px gold hairlines beside the marketing eyebrows
  (`<span className="h-px w-6 bg-[var(--gold)]" />`, eleven of them) are
  decoration, conveying nothing, and exempt under 1.4.11. They stay
  `--gold`, which is now slightly paler than the text beside them.
- `⚓` (U+2693) has `Emoji_Presentation=Yes`, so browsers render it as a
  colour emoji and ignore `color` entirely. The two photo-placeholder
  anchors carry `text-[var(--gold)]` classes that have never had any
  visual effect. Changing the token there would be a no-op, so they were
  left as they are.

### Where the tokens live

`web/src/app/globals.css`, each with a comment giving its measured ratios
and the surface it was chosen against. Add the ratio to the comment when
adding a token — a number in the file is what makes the next reviewer
able to check rather than guess.


---

## 7. Suggested order

1. **Audit the live app's tokens** against §1 — cheap, and establishes whether there's real drift or just the design files being ahead.
2. **Build the Pixel M and produce the app icon set** — needed for the PWA regardless, spec is complete, blocks nothing else.
3. **Favicon + in-app chrome** using the scale ladder — small, immediately visible.
4. **Scan-success Vapor animation** — small, high delight, canonical use of a shade currently unused.
5. **Aqua role audit** — find every aqua usage in the app, assign each a role, fix anything using the wrong shade or mixing two.
6. **QR badge reconciliation** — fold §4 into the pending badge design round, including the Patent Pending conflict.
7. **Anchored M** — only needed when physical/ceremonial artifacts get produced (business cards, letterhead). No product dependency.

Items 2–4 are natural companions to the PWA build. Items 5–6 are their own pass.

---

## 8. Open questions

1. **Do the marks exist as files yet?** The guide specifies SVG/EPS/PDF/PNG delivery at 1×/2×/3×, and Pantone matches (Gold ≈ PMS 872C metallic / 7404C process, Navy ≈ 296C, Bright Aqua ≈ 3262C, Lagoon ≈ 7717C, Abyss ≈ 568C). If the marks were only ever rendered inside the guide, they need to be built as real assets before anything can use them.
2. **Patent Pending placement on the badge** — where does it sit relative to the "REGISTERED VESSEL" / "SCAN · MXE-00000" caption block?
3. **Does the guide get a v1.2** correcting §5's drift, or is it annotated in place?
