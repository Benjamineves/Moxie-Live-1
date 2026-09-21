/**
 * Regenerates src/lib/poster-fonts/base64.ts from the committed .ttf
 * subsets. Run after re-subsetting the fonts (see that folder's README).
 *
 *   node scripts/generate-poster-font-base64.mjs
 *
 * TTF because pdf-lib/fontkit embeds TTF/OTF and does not decompress
 * WOFF2. Subset to Latin: a poster prints an arbitrary marina name, so
 * the badge's uppercase-only subsets cannot serve it.
 *
 * The base64 exists so the builder needs no disk access at runtime — a
 * route running on Vercel cannot read files that the bundler did not
 * trace, which is the same reason badge-fonts/base64.ts exists.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "../src/lib/poster-fonts");

const FACES = [
  { const: "CORMORANT_GARAMOND_600", file: "cormorant-garamond-600.latin.ttf" },
  { const: "DM_SANS_500", file: "dm-sans-500.latin.ttf" },
  { const: "DM_SANS_700", file: "dm-sans-700.latin.ttf" },
  { const: "DM_SANS_800", file: "dm-sans-800.latin.ttf" },
];

const parts = [];
for (const face of FACES) {
  const buf = await readFile(resolve(DIR, face.file));
  parts.push(
    `/** ${face.file} — ${buf.length} bytes, subset. Regenerate with scripts/generate-poster-font-base64.mjs. */\n` +
      `export const ${face.const} = "${buf.toString("base64")}";`,
  );
}

const out = `// GENERATED FILE — do not edit by hand.
// Produced by scripts/generate-poster-font-base64.mjs from the .ttf
// subsets in this folder. See README.md for provenance and the SIL Open
// Font License covering both faces.

${parts.join("\n\n")}
`;

await writeFile(resolve(DIR, "base64.ts"), out);
console.log(`wrote base64.ts (${FACES.length} faces)`);
