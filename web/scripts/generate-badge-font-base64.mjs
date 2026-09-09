/**
 * Regenerates src/lib/badge-fonts/base64.ts from the committed .ttf
 * subsets. Run after re-subsetting the fonts (see that folder's README).
 *
 *   node scripts/generate-badge-font-base64.mjs
 *
 * TTF rather than WOFF2 because these bytes are no longer handed to a
 * rasterizer as an embedded @font-face — librsvg ignores @font-face
 * entirely, whatever the format. They are parsed by opentype.js in
 * badge-outline.ts to convert badge text into path outlines. opentype.js
 * reads TTF/OTF and does not decompress WOFF2.
 *
 * The base64 exists so the outliner needs no disk access at runtime —
 * see the README for why file access is the wrong tool inside a Next
 * server bundle.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "../src/lib/badge-fonts");

const FACES = [
  { const: "CORMORANT_GARAMOND_ITALIC_300", file: "cormorant-garamond-italic-300.subset.ttf" },
  { const: "DM_SANS_500", file: "dm-sans-500.subset.ttf" },
];

const parts = [];
for (const face of FACES) {
  const buf = await readFile(resolve(DIR, face.file));
  parts.push(
    `/** ${face.file} — ${buf.length} bytes, subset. Regenerate with scripts/generate-badge-font-base64.mjs. */\n` +
      `export const ${face.const} = "${buf.toString("base64")}";`,
  );
}

const out = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/generate-badge-font-base64.mjs from the .ttf
// subsets in this folder. See README.md for provenance and the SIL Open
// Font License covering both faces.

${parts.join("\n\n")}
`;

await writeFile(resolve(DIR, "base64.ts"), out);
console.log(`wrote base64.ts (${FACES.length} faces)`);
