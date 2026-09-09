/**
 * Converts badge text into path outlines, so the print renderer draws no
 * text at all.
 *
 * WHY THIS EXISTS — the third and final font defect in this path.
 *
 * librsvg does not implement CSS `@font-face`. Not "unreliably", not
 * "only for some formats": it ignores the rule entirely and resolves
 * every font-family through fontconfig against fonts installed on the
 * host. Embedding the faces as base64 — WOFF2 or TTF, in <defs> or a
 * root <style>, any src syntax — produced byte-identical output to
 * having no @font-face at all, and byte-identical to asking for plain
 * `serif`/`sans-serif`. Five variants, one hash.
 *
 * On a developer Mac that failure is invisible, because fontconfig finds
 * a system serif and a system sans and the result looks plausible enough
 * to pass review — which is exactly what happened. On Vercel's runtime
 * there are no installed fonts to fall back to, so every glyph rendered
 * as tofu.
 *
 * Outlining removes the whole class of problem. A path has no font to
 * resolve, so the artwork renders identically on any host, with or
 * without fontconfig, forever. The trade is that text in print artwork
 * is no longer selectable or searchable — irrelevant for a 3-inch badge
 * destined for a vinyl press, and the reason this was the right answer
 * rather than a workaround.
 *
 * The screen theme is untouched and still uses real <text> with
 * next/font. Only rasterized output is outlined.
 */
import * as opentypeModule from "opentype.js";
import type { Font } from "opentype.js";
import type { BadgeFace } from "./badge-layout.ts";
import { CORMORANT_GARAMOND_ITALIC_300, DM_SANS_500 } from "./badge-fonts/base64.ts";

/**
 * opentype.js has to be reached through the namespace, because the two
 * runtimes that load this file disagree about its shape. It declares a
 * CJS `main` and an ESM `module` with no `exports` map, so Node resolves
 * the CJS bundle — whose named exports its lexer cannot see through —
 * while Turbopack resolves the ESM bundle, which has named exports and
 * no default. A named import fails under `node --test`; a default import
 * fails the production build. Taking the namespace and picking whichever
 * shape arrived satisfies both, and fails loudly rather than at the
 * first render if a future version changes shape again.
 */
type OpentypeApi = { parse: (buffer: ArrayBuffer) => Font };

const opentype: OpentypeApi =
  "parse" in opentypeModule
    ? (opentypeModule as unknown as OpentypeApi)
    : (opentypeModule as unknown as { default: OpentypeApi }).default;

if (typeof opentype?.parse !== "function") {
  throw new Error("opentype.js did not expose parse() under either module shape.");
}

const FACE_BASE64: Record<BadgeFace, string> = {
  display: CORMORANT_GARAMOND_ITALIC_300,
  dm: DM_SANS_500,
};

let parsed: Record<BadgeFace, Font> | null = null;

function parseFace(base64: string): Font {
  const buf = Buffer.from(base64, "base64");
  // Buffer is a view into a larger pooled ArrayBuffer; slice to this
  // face's own bytes or opentype parses whatever else shares the pool.
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/**
 * Parsed once per process. Rendering a batch of 20 badges in one chunk
 * would otherwise re-parse both faces 20 times for identical results.
 */
function faces(): Record<BadgeFace, Font> {
  if (!parsed) {
    parsed = { display: parseFace(FACE_BASE64.display), dm: parseFace(FACE_BASE64.dm) };
  }
  return parsed;
}

export type BadgeOutlineRun = {
  text: string;
  face: BadgeFace;
  /** Horizontal centre — every run on the badge is centre-anchored. */
  centerX: number;
  baselineY: number;
  fontSize: number;
  letterSpacing: number;
};

/**
 * Advance width of a run, in user units, laid out exactly as
 * outlineRun() will draw it.
 *
 * Trailing letter-spacing IS included, because CSS adds letter-spacing
 * after every character including the last, and SVG's text-anchor works
 * off that advance. Excluding it here would shift print text half a
 * space right of where the browser puts it — a divergence too small to
 * notice in review and permanent once pressed.
 */
function runWidth(font: Font, run: BadgeOutlineRun): number {
  const glyphs = font.stringToGlyphs(run.text);
  const scale = run.fontSize / font.unitsPerEm;
  let width = 0;
  glyphs.forEach((glyph, i) => {
    if (i > 0) width += font.getKerningValue(glyphs[i - 1], glyph) * scale;
    width += (glyph.advanceWidth ?? 0) * scale + run.letterSpacing;
  });
  return width;
}

/**
 * Path data for one centre-anchored run.
 *
 * Throws rather than drawing nothing if the run needs a glyph the subset
 * does not carry. The subsets cover only what BADGE_TEXT can produce, so
 * a miss means badge copy changed without the fonts being regenerated —
 * see badge-fonts/README.md. Silence here would ship a badge with a word
 * missing, which is the failure mode this whole module exists to end.
 */
export function outlineRun(run: BadgeOutlineRun): string {
  const font = faces()[run.face];

  const missing = [...run.text].filter((char) => font.charToGlyphIndex(char) === 0);
  if (missing.length > 0) {
    throw new Error(
      `Badge font subset "${run.face}" has no glyph for ${JSON.stringify(missing.join(""))} ` +
        `(drawing ${JSON.stringify(run.text)}). Re-subset the fonts — see src/lib/badge-fonts/README.md.`,
    );
  }

  const glyphs = font.stringToGlyphs(run.text);
  const scale = run.fontSize / font.unitsPerEm;

  let x = run.centerX - runWidth(font, run) / 2;
  let data = "";
  glyphs.forEach((glyph, i) => {
    if (i > 0) x += font.getKerningValue(glyphs[i - 1], glyph) * scale;
    // Two decimals at a 1000-unit viewBox is a 0.01-unit grid — well
    // under a printer dot at 600 DPI, and keeps the SVG a fraction of
    // the size full precision produces.
    data += glyph.getPath(x, run.baselineY, run.fontSize).toPathData(2);
    x += (glyph.advanceWidth ?? 0) * scale + run.letterSpacing;
  });

  return data;
}
