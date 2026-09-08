/**
 * The two contexts badge markup has to survive, expressed as data so
 * there is one builder rather than two.
 *
 * `screen` is what has always been emitted: CSS variables the app's own
 * stylesheet and next/font resolve. Correct in a browser, and only in a
 * browser.
 *
 * `print` is for artwork rasterized outside one — sharp/librsvg has no
 * stylesheet, no next/font and no network, so every var() silently
 * becomes a default. Left unresolved the navy card renders BLACK and
 * both faces fall back to system defaults: a defect invisible in review
 * and obvious only once a badge is physically printed.
 *
 * ONLY THREE THINGS VARY, which is the point. Every other colour in the
 * badge — the wordmark white, both caption alphas, the gold divider (it
 * reads the QR colorway's dark module) — was already a literal value and
 * renders identically in both. Keeping the varying surface this small is
 * what makes "same geometry, same text, different fills and fonts"
 * something a test can assert rather than a claim in a comment.
 *
 * badge-theme.test.mts asserts exactly that, plus that the literals below
 * still match globals.css. It is the guard against the drift that
 * previously produced three copies of the pixel-M mark and a
 * downloadable PNG missing its "Patent Pending" line.
 */
import { CORMORANT_GARAMOND_ITALIC_300, DM_SANS_500 } from "./badge-fonts/base64.ts";

export type BadgeTheme = "screen" | "print";

export type BadgeThemeTokens = {
  /** The rounded card behind everything — --navy in globals.css. */
  cardFill: string;
  displayFamily: string;
  dmFamily: string;
  /** <defs> content: empty for screen, embedded @font-face for print. */
  defs: string;
};

/**
 * The one literal a server-side rasterizer cannot look up for itself.
 * Named after its CSS variable, and asserted against globals.css in the
 * test so the copy cannot drift from the original in silence.
 */
export const PRINT_CARD_FILL = "#0d1f35"; // --navy

/**
 * Embedded as base64 so the SVG is self-contained. librsvg will not
 * fetch a remote font and has no next/font context, so this is the only
 * way the correct faces reach the rasterizer. The subsets are ~12 KB
 * combined; see badge-fonts/README.md.
 */
function printFontFaces(): string {
  return `<defs><style type="text/css">@font-face{font-family:"Cormorant Garamond";font-style:italic;font-weight:300;src:url(data:font/woff2;base64,${CORMORANT_GARAMOND_ITALIC_300}) format("woff2");}@font-face{font-family:"DM Sans";font-style:normal;font-weight:500;src:url(data:font/woff2;base64,${DM_SANS_500}) format("woff2");}</style></defs>`;
}

export function badgeThemeTokens(theme: BadgeTheme): BadgeThemeTokens {
  if (theme === "print") {
    return {
      cardFill: PRINT_CARD_FILL,
      // Quoted because both names contain a space. The generic fallback
      // matters only if an embedded face fails to load, where a wrong
      // font still beats no text at all.
      displayFamily: "'Cormorant Garamond',serif",
      dmFamily: "'DM Sans',sans-serif",
      defs: printFontFaces(),
    };
  }

  return {
    cardFill: "var(--navy)",
    displayFamily: "var(--font-display)",
    dmFamily: "var(--font-dm)",
    defs: "",
  };
}
