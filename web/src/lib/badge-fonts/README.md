# Vendored badge fonts

Two font faces, subset to the glyphs the printed badge actually draws.
They exist because badge artwork has to render **outside a browser**:
`buildBadgeSvg(..., { theme: "print" })` is rasterized server-side by
sharp/librsvg, which has no access to `next/font`'s CSS variables and no
network. Without these embedded, the wordmark and captions silently fall
back to a default font — a defect invisible in code review and obvious
only once a badge is printed.

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

Neither may be sold on its own, and neither carries a Reserved Font
Name here, so the subset files keep their original names.

## What is subset in

Only the glyphs the badge can draw, after the caption lines are
uppercased: `A-Z`, `0-9`, space, `·`, `-`, plus the lowercase `o x i e`
for the "Moxie" wordmark. That is why these are 4-8 KB rather than
30-40 KB.

**If badge copy ever changes, these must be regenerated** — a character
outside the subset renders as nothing at all, not as a fallback glyph.
`BADGE_TEXT` in `lib/badge-layout.ts` is the source of truth for what
gets drawn.

## Regenerating

Google Fonts subsets server-side via the `text=` parameter. Fetch with a
modern browser User-Agent or the API returns TTF instead of WOFF2:

    TEXT='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ·-Moxie'
    # Cormorant Garamond, italic 300 — the wordmark
    https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&text=<urlencoded TEXT>
    # DM Sans, 500 — the three caption lines
    https://fonts.googleapis.com/css2?family=DM+Sans:wght@500&text=<urlencoded TEXT>

Follow the `src: url(...)` in each response, save alongside this file,
then regenerate `base64.ts`:

    node scripts/generate-badge-font-base64.mjs

## Why base64 in a `.ts` module rather than reading the `.woff2` at runtime

Reading a file from disk in a Next server bundle depends on the file
being traced into the deployment, which is fragile on Vercel and fails
at runtime rather than at build. A TypeScript module is bundled by
construction and works on every runtime. The `.woff2` files stay
committed as provenance, as the licence source, and as the input for
regeneration — nothing reads them at runtime.
