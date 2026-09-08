/**
 * Regenerates src/lib/badge-fonts/base64.ts from the committed .woff2
 * subsets. Run after re-subsetting the fonts (see that folder's README).
 *
 *   node scripts/generate-badge-font-base64.mjs
 *
 * The base64 exists so the print theme can embed the faces in a
 * self-contained SVG without reading from disk at runtime — see the
 * README for why file access is the wrong tool inside a Next server
 * bundle.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "../src/lib/badge-fonts");

const FACES = [
  { const: "CORMORANT_GARAMOND_ITALIC_300", file: "cormorant-garamond-italic-300.subset.woff2" },
  { const: "DM_SANS_500", file: "dm-sans-500.subset.woff2" },
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
// Produced by scripts/generate-badge-font-base64.mjs from the .woff2
// subsets in this folder. See README.md for provenance and the SIL Open
// Font License covering both faces.

${parts.join("\n\n")}
`;

await writeFile(resolve(DIR, "base64.ts"), out);
console.log(`wrote base64.ts (${FACES.length} faces)`);
