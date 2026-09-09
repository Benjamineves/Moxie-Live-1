# Vendored badge fonts

Two font faces, subset to the glyphs the printed badge actually draws.
They exist because badge artwork has to render **outside a browser**:
`buildBadgeSvg(..., { theme: "print" })` is rasterized server-side by
sharp/librsvg, which has no access to `next/font`'s CSS variables and no
network.

**These are not loaded as fonts at render time.** librsvg does not
implement `@font-face` at all — embedding the faces as base64, in any
format, produced output byte-identical to embedding nothing (see the
measurement in `../badge-outline.ts`). On a Mac that failure hides behind
system fonts; on Vercel, where no fonts are installed, every glyph
rendered as tofu.

Instead these bytes are parsed by `opentype.js` in `badge-outline.ts`,
which converts each badge text run into a `<path>` outline. The
rasterizer then has no font to resolve. **That is why these are `.ttf`
and not `.woff2`**: opentype.js reads TTF/OTF and does not decompress
WOFF2. The size cost of dropping WOFF2 compression is ~15 KB, paid once
in the server bundle and never by a browser.

The screen theme is unaffected and still uses `next/font/google` exactly
as `app/layout.tsx` configures it. These files are for print only.

## Licence — SIL Open Font License 1.1

Both are OFL 1.1, which permits redistribution and embedding, including
in a rasterized document. The licence requires the copyright notice and
licence text to travel with the font, which is why the two `OFL-*.txt`
files sit here rather than being referenced from elsewhere:

| Face | Copyright | Licence |
|---|---|---|
| Cormorant Garamond | 2015 The Cormorant Project Authors | `OFL-Cormorant-Garamond.txt` |
| DM Sans | 2014 The DM Sans Project Authors | `OFL-DM-Sans.txt` |

Outlining to paths does not change the licensing position: OFL 1.1
explicitly permits embedding, and converting glyphs to curves in a
rendered document is a normal use of an embedded font, not a
modification or a redistribution of the font software itself. The `.ttf`
files below *are* redistributed here, which is what the two licence
files cover.

Neither may be sold on its own, and neither carries a Reserved Font
Name here, so the subset files keep their original names.

## What is subset in

Only the glyphs the badge can draw, after the caption lines are
uppercased: `A-Z`, `0-9`, space, `·`, `-`, plus the lowercase `o x i e`
for the "Moxie" wordmark. That is why these are 4-8 KB rather than
30-40 KB.

**If badge copy ever changes, these must be regenerated.** A character
outside the subset can no longer render as nothing, though: `outlineRun`
throws with the offending characters named, and
`badge-theme.test.mts` asserts every printable character produced a
contour. `BADGE_TEXT` in `lib/badge-layout.ts` is the source of truth for
what gets drawn.

## Regenerating

Google Fonts subsets server-side via the `text=` parameter. Fetch with an
**old** User-Agent (e.g. `Mozilla/4.0`) so the API returns TTF — a modern
one returns WOFF2, which opentype.js cannot read:

    TEXT='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ·-Moxie'
    # Cormorant Garamond, italic 300 — the wordmark
    https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&text=<urlencoded TEXT>
    # DM Sans, 500 — the three caption lines
    https://fonts.googleapis.com/css2?family=DM+Sans:wght@500&text=<urlencoded TEXT>

Follow the `src: url(...)` in each response, save alongside this file as
`*.subset.ttf`, then regenerate `base64.ts`:

    node scripts/generate-badge-font-base64.mjs

## Why base64 in a `.ts` module rather than reading the `.ttf` at runtime

Reading a file from disk in a Next server bundle depends on the file
being traced into the deployment, which is fragile on Vercel and fails
at runtime rather than at build. A TypeScript module is bundled by
construction and works on every runtime. The `.ttf` files stay
committed as provenance, as the licence source, and as the input for
regeneration — nothing reads them at runtime.
