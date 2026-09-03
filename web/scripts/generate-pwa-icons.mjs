// Generates the PWA/app icon set from the Pixel M mark, per the
// Application 01 treatment in docs/design/moxie_brand_guide_v1.1.pdf
// (docs/moxie_digital_brand_addendum_integration.md §3):
//   background   navy gradient #0D1F35 -> #0A1828 at 160deg
//   mark         Pixel M, gold #C9A84C, corner brackets at 55% opacity
//   signal pixel Bright Aqua #17C3B2
//   corner radius 22.5% (iOS superellipse approximation)
//   mark size    62% of icon canvas
//
// Cell geometry (the M shape, the 3 corner brackets, the signal pixel)
// is taken from web/src/components/marketing/MarketingNav.tsx's
// NavPixelM, NOT from web/src/components/PixelM.tsx. The two differ:
// PixelM.tsx (the shared, widely-reused component) renders only the 17
// M-cells + signal pixel, with no corner brackets at all. NavPixelM
// (nav-bar only) additionally has 3 gold L-shaped corner brackets at
// .55 opacity, occupying 3 of the icon's 4 corners -- the 4th corner is
// the signal pixel. That's a closer match to the guide's "corner cells
// at 55% opacity" than PixelM.tsx has. This script follows NavPixelM's
// fuller definition, since the goal is reusing the already-validated
// mark, not inventing new geometry -- PixelM.tsx just turns out to be
// the simplified one of the two. Flagged for awareness; not fixing
// PixelM.tsx itself here, since it's used in several live UI spots
// (nav, footer, dashboard header, ScanSuccess) and changing its visual
// weight there is a separate decision.
//
// Run: node scripts/generate-pwa-icons.mjs
// Requires `sharp` (already a transitive dependency via Next.js/next/image).

import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "icons");

const GOLD = "#C9A84C";
const AQUA = "#17C3B2";
const NAVY_FROM = "#0D1F35";
const NAVY_TO = "#0A1828";

// 17 gold cells forming the M, in a 100x100 mark-space -- identical
// coordinates to PixelM.tsx / NavPixelM.
const M_CELLS = [
  [15, 25], [15, 35], [15, 45], [15, 55], [15, 65], [15, 75],
  [25, 35], [35, 45], [45, 35], [55, 45], [65, 35],
  [75, 25], [75, 35], [75, 45], [75, 55], [75, 65], [75, 75],
];
const CELL = 10;

// 3 corner brackets (top-left, top-right, bottom-left), each an L made
// of two rects. Bottom-right is deliberately empty -- the signal pixel
// goes there instead.
const BRACKETS = [
  { x: 0, y: 0, w: 25, h: 10 }, { x: 0, y: 0, w: 10, h: 25 },
  { x: 75, y: 0, w: 25, h: 10 }, { x: 90, y: 0, w: 10, h: 25 },
  { x: 0, y: 90, w: 25, h: 10 }, { x: 0, y: 75, w: 10, h: 25 },
];

const SIGNAL = { x: 85, y: 85, w: 8, h: 8 };

/**
 * CSS-angle-to-SVG-gradient-vector conversion: for
 * linear-gradient(angleDeg, ...), 0deg points up (north), increasing
 * clockwise. Standard formula, not an approximation.
 */
function gradientVector(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const x2 = 0.5 + Math.sin(rad) * 0.5;
  const y2 = 0.5 - Math.cos(rad) * 0.5;
  const x1 = 0.5 - Math.sin(rad) * 0.5;
  const y1 = 0.5 + Math.cos(rad) * 0.5;
  return {
    x1: `${(x1 * 100).toFixed(2)}%`,
    y1: `${(y1 * 100).toFixed(2)}%`,
    x2: `${(x2 * 100).toFixed(2)}%`,
    y2: `${(y2 * 100).toFixed(2)}%`,
  };
}

/**
 * The scale ladder (addendum §3): the mark simplifies as it shrinks.
 *   < 32px  -> 'minimal'  bare M cells only, no brackets, no signal
 *   32-55px -> 'brackets' M cells + corner brackets, no signal
 *   >= 56px -> 'full'     everything
 * The addendum's explicit sizes are 16 (minimal), 32 (brackets), and
 * "56+" (full) -- 40px isn't named explicitly but falls under 56, and
 * an 8%-of-40px signal pixel (~3px) would just read as noise, so it's
 * grouped into the 'brackets' tier by the same logic as 32px.
 */
function detailForSize(size) {
  if (size < 32) return "minimal";
  if (size < 56) return "brackets";
  return "full";
}

function iconSvg(size, detail) {
  const g = gradientVector(160);
  const markScale = 0.62;
  const markSize = size * markScale;
  const offset = (size - markSize) / 2;
  const unit = markSize / 100;

  const cellRects = M_CELLS.map(
    ([x, y]) =>
      `<rect x="${(offset + x * unit).toFixed(2)}" y="${(offset + y * unit).toFixed(2)}" width="${(CELL * unit).toFixed(2)}" height="${(CELL * unit).toFixed(2)}" fill="${GOLD}"/>`,
  ).join("");

  const bracketRects =
    detail !== "minimal"
      ? BRACKETS.map(
          (b) =>
            `<rect x="${(offset + b.x * unit).toFixed(2)}" y="${(offset + b.y * unit).toFixed(2)}" width="${(b.w * unit).toFixed(2)}" height="${(b.h * unit).toFixed(2)}" rx="${unit.toFixed(2)}" fill="${GOLD}" opacity="0.55"/>`,
        ).join("")
      : "";

  const signalRect =
    detail === "full"
      ? `<rect x="${(offset + SIGNAL.x * unit).toFixed(2)}" y="${(offset + SIGNAL.y * unit).toFixed(2)}" width="${(SIGNAL.w * unit).toFixed(2)}" height="${(SIGNAL.h * unit).toFixed(2)}" fill="${AQUA}"/>`
      : "";

  const cornerRadius = (size * 0.225).toFixed(2);

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">
        <stop offset="0%" stop-color="${NAVY_FROM}"/>
        <stop offset="100%" stop-color="${NAVY_TO}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="url(#bg)"/>
    ${cellRects}${bracketRects}${signalRect}
  </svg>`;
}

// The 9 required export sizes, plus 192 (Android/Chrome's de facto
// minimum PWA manifest icon size -- not in the guide's own iOS-focused
// list, added because a manifest without it can fail installability
// checks) and 16/32 for the favicon/in-app-chrome tiers.
const SIZES = [16, 32, 40, 60, 76, 87, 120, 152, 180, 192, 512, 1024];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const size of SIZES) {
    const detail = detailForSize(size);
    const svg = iconSvg(size, detail);
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const filePath = path.join(OUT_DIR, `icon-${size}.png`);
    await writeFile(filePath, buffer);
    console.log(`icon-${size}.png (${detail})`);
  }

  // apple-icon.png (180x180, full detail) for iOS Safari/home-screen —
  // Next.js's app/apple-icon.png convention auto-serves the
  // <link rel="apple-touch-icon"> tag.
  const appleIconPath = path.join(__dirname, "..", "src", "app", "apple-icon.png");
  const appleSvg = iconSvg(180, "full");
  await writeFile(appleIconPath, await sharp(Buffer.from(appleSvg)).png().toBuffer());
  console.log("src/app/apple-icon.png (180, full)");

  // icon.svg (32-tier detail) for app/icon.svg's modern-browser favicon
  // convention — vector, so it stays crisp at any rendered size.
  const iconSvgPath = path.join(__dirname, "..", "src", "app", "icon.svg");
  await writeFile(iconSvgPath, iconSvg(64, "brackets"));
  console.log("src/app/icon.svg (64 canvas, brackets tier)");

  // favicon.ico bundling 16 + 32 px PNGs — legacy fallback for browser
  // chrome/bookmarks that specifically request /favicon.ico regardless
  // of <link> tags.
  const png16 = await sharp(Buffer.from(iconSvg(16, "minimal"))).png().toBuffer();
  const png32 = await sharp(Buffer.from(iconSvg(32, "brackets"))).png().toBuffer();
  const ico = buildIco([
    { size: 16, png: png16 },
    { size: 32, png: png32 },
  ]);
  const faviconPath = path.join(__dirname, "..", "src", "app", "favicon.ico");
  await writeFile(faviconPath, ico);
  console.log("src/app/favicon.ico (16 + 32, PNG-embedded ICO)");
}

/**
 * Minimal ICO encoder: modern ICO format supports embedding PNG data
 * directly per image entry (supported since Windows Vista, universally
 * supported by browsers) — no need for legacy raw-bitmap encoding.
 */
function buildIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = headerSize + entrySize * images.length;
  const entries = [];
  const dataChunks = [];

  for (const { size, png } of images) {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8); // data size
    entry.writeUInt32LE(offset, 12); // data offset
    entries.push(entry);
    dataChunks.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...dataChunks]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
