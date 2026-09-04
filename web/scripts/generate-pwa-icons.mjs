// Generates the PWA/app icon set from the Pixel M mark, per the
// Application 01 treatment in docs/design/moxie_brand_guide_v1.1.pdf
// (docs/moxie_digital_brand_addendum_integration.md §3):
//   background   navy gradient #0D1F35 -> #0A1828 at 160deg
//   mark         Pixel M, gold #C9A84C, corner brackets at 55% opacity
//   signal pixel Bright Aqua #17C3B2
//   corner radius 22.5% (iOS superellipse approximation)
//   mark size    62% of icon canvas
//
// Geometry is imported in spirit from the canonical mark,
// src/components/brand/PixelMMark.tsx -- same 100x100 mark-space, same
// rects. Kept as literals here rather than importing the component
// because this is a plain Node script with no JSX/TS pipeline; if the
// component's coordinates change, change them here too. That is the one
// duplication in the system and it is deliberate.
//
// INVERTED TREATMENT: the icon canvas is a navy gradient, so the mark
// body is drawn in gold rather than the component's navy default --
// navy-on-navy would be invisible. Brackets are gold and the aqua
// signal pixel is retained, per the same inverted rule the on-navy React
// call sites use.
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

// The canonical M: two 5-cell columns plus the three cells forming the
// centre vertex. 10x10 cells in a 100x100 mark-space.
const M_CELLS = [
  [22, 21], [22, 33], [22, 45], [22, 57], [22, 69],
  [68, 21], [68, 33], [68, 45], [68, 57], [68, 69],
  [34, 33], [56, 33], [45, 45],
];
const CELL = 10;

// Four corner brackets, each an L of two thin rects. Unlike the previous
// mark, all four corners are bracketed; the signal pixel sits inside the
// bottom-right bracket rather than replacing it.
const BRACKETS = [
  { x: 14, y: 14, w: 10, h: 2.5 }, { x: 14, y: 14, w: 2.5, h: 10 },
  { x: 76, y: 14, w: 10, h: 2.5 }, { x: 83.5, y: 14, w: 2.5, h: 10 },
  { x: 14, y: 83.5, w: 10, h: 2.5 }, { x: 14, y: 76, w: 2.5, h: 10 },
  { x: 76, y: 83.5, w: 10, h: 2.5 }, { x: 83.5, y: 76, w: 2.5, h: 10 },
];

const SIGNAL = { x: 83.5, y: 83.5, w: 4, h: 4 };

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
            `<rect x="${(offset + b.x * unit).toFixed(2)}" y="${(offset + b.y * unit).toFixed(2)}" width="${(b.w * unit).toFixed(2)}" height="${(b.h * unit).toFixed(2)}" fill="${GOLD}"/>`,
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
