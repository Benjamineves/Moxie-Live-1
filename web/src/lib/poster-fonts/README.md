# Vendored poster fonts

Four faces, subset to Latin, embedded into the marina poster PDF by
`../marina-poster-pdf.ts` (pdf-lib + fontkit).

| File | Face |
|---|---|
| `cormorant-garamond-600.latin.ttf` | Cormorant Garamond SemiBold — the marina's name |
| `dm-sans-500.latin.ttf` | DM Sans Medium — body lines, city |
| `dm-sans-700.latin.ttf` | DM Sans Bold — eyebrow, the ask, "Scan with your phone camera" |
| `dm-sans-800.latin.ttf` | DM Sans ExtraBold — the join code, the URL |

The poster's "Moxie" wordmark reuses `../badge-fonts`' italic subset,
which already carries `M` and `oxie`.

**Why these exist rather than the badge's subsets.** Those are subset to
uppercase A–Z, 0–9 and a few marks, because the badge only ever prints
its own fixed text. A poster prints an arbitrary marina name and whole
sentences, so it needs lowercase, punctuation and accents.

**Why TTF, and why base64.** pdf-lib/fontkit embeds TTF/OTF and does not
decompress WOFF2. The bytes are committed as base64 in `base64.ts`
(regenerate with `node scripts/generate-poster-font-base64.mjs`) so the
builder needs no disk access at runtime — a route on Vercel cannot read
files the bundler did not trace. Same reasoning as `../badge-fonts`.

**Coverage.** `U+0020–007E`, `U+00A0–017F` (Latin-1 Supplement and Latin
Extended-A), plus `– — ‘ ’ ‚ “ ” „ • … €`. Anything outside that has no
glyph, so `unprintablePosterChars()` refuses the poster rather than
printing blanks where a marina's name should be. Extend the subset (see
the `pyftsubset` line below) if a real marina needs more.

```
pyftsubset <source>.ttf \
  --unicodes='U+0020-007E,U+00A0-00FF,U+0100-017F,U+2013,U+2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+20AC' \
  --output-file=<face>.latin.ttf
```

Sources: the `@expo-google-fonts/dm-sans` and
`@expo-google-fonts/cormorant-garamond` packages, which ship the upstream
Google Fonts TTFs. Neither package is a dependency — they were installed
once to take the source files.

## Licence — SIL Open Font License 1.1

Both families are OFL 1.1, which permits redistribution and embedding,
including in a rendered document. The licence requires the copyright
notice and licence text to travel with the font, which is why the two
`OFL-*.txt` files sit here as well as in `../badge-fonts`.

| Face | Copyright | Licence |
|---|---|---|
| Cormorant Garamond | 2015 The Cormorant Project Authors | `OFL-Cormorant-Garamond.txt` |
| DM Sans | 2014 The DM Sans Project Authors | `OFL-DM-Sans.txt` |

Subsetting is a permitted modification; neither carries a Reserved Font
Name here, so the subset files keep their original names.
