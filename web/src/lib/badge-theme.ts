/**
 * The two contexts badge markup has to survive, expressed as data so
 * there is one builder rather than two.
 *
 * `screen` is what has always been emitted: real <text> elements
 * referencing CSS variables the app's stylesheet and next/font resolve.
 * Correct in a browser, and only in a browser.
 *
 * `print` is for artwork rasterized outside one. sharp/librsvg has no
 * stylesheet, no next/font, no network — and, as it turns out, no
 * `@font-face` support of any kind (see badge-outline.ts for the
 * measurement). So print resolves the card fill to a literal and
 * converts every text run to a path outline, leaving the rasterizer
 * nothing to look up.
 *
 * WHAT VARIES, AND WHAT CANNOT
 *
 * The two themes differ in exactly two things: the card fill, and how a
 * text run becomes markup. They cannot differ in *what* text is drawn or
 * *where*, because both consume the identical run list from
 * badgeTextRuns() in badge-layout.ts. Every other colour in the badge —
 * the wordmark white, both caption alphas, the gold divider (it reads
 * the QR colorway's dark module) — is a literal already and renders
 * identically in both.
 *
 * badge-theme.test.mts asserts that: same runs, same geometry, same
 * text, no <text> at all in print, and PRINT_CARD_FILL still matching
 * globals.css. It is the guard against the drift that previously
 * produced three copies of the pixel-M mark and a downloadable PNG
 * missing its "Patent Pending" line.
 */
import { outlineRun } from "./badge-outline.ts";
import type { badgeTextRuns } from "./badge-layout.ts";

export type BadgeTheme = "screen" | "print";

/** One entry from badgeTextRuns() — the unit both themes consume. */
export type BadgeTextRun = ReturnType<typeof badgeTextRuns>[number];

export type BadgeThemeTokens = {
  /** The rounded card behind everything — --navy in globals.css. */
  cardFill: string;
  /** Turns one run into markup: <text> for screen, <path> for print. */
  renderText: (run: BadgeTextRun) => string;
};

/**
 * The one literal a server-side rasterizer cannot look up for itself.
 * Named after its CSS variable, and asserted against globals.css in the
 * test so the copy cannot drift from the original in silence.
 */
export const PRINT_CARD_FILL = "#0d1f35"; // --navy

/**
 * Face-to-CSS for the browser. The print theme needs no equivalent: a
 * face selects a font *file* there (badge-outline.ts), not a family
 * name, which is why print artwork cannot fall back to a wrong font.
 */
const SCREEN_FACE_CSS: Record<BadgeTextRun["face"], string> = {
  display: `font-family="var(--font-display)" font-style="italic" font-weight="300"`,
  dm: `font-family="var(--font-dm)" font-weight="500"`,
};

function screenText(run: BadgeTextRun): string {
  const spacing = run.letterSpacing > 0 ? ` letter-spacing="${run.letterSpacing}"` : "";
  return (
    `<text x="${run.centerX}" y="${run.baselineY}" text-anchor="middle" ` +
    `${SCREEN_FACE_CSS[run.face]} font-size="${run.fontSize}"${spacing} fill="${run.fill}">` +
    `${run.text}</text>`
  );
}

/**
 * `data-badge-text` carries the string the outline was generated from.
 * Nothing renders it — it exists so the drift guard can assert both
 * themes draw the same words, and so a stored artwork SVG is still
 * greppable when someone asks which badge a file is. It reveals nothing
 * the badge does not already show in print.
 */
function printText(run: BadgeTextRun): string {
  return (
    `<path data-badge-text="${run.text}" d="${outlineRun(run)}" fill="${run.fill}"/>`
  );
}

export function badgeThemeTokens(theme: BadgeTheme): BadgeThemeTokens {
  if (theme === "print") {
    return { cardFill: PRINT_CARD_FILL, renderText: printText };
  }
  return { cardFill: "var(--navy)", renderText: screenText };
}
