/**
 * THE MARINA OFFICE POSTER, IN BATCH.
 *
 *   npm run marina-poster -- 7TJY-KFTK            one marina, by its code
 *   npm run marina-poster -- --all                every marina with a code
 *   npm run marina-poster -- 7TJY-KFTK --out ~/Desktop
 *
 * For one marina, use the Download poster button on /admin/marinas — this
 * is for doing several at once, or for a print run. Both call the same
 * builder (src/lib/marina-poster-pdf.ts), so both produce the same file.
 *
 * NO BROWSER ANY MORE. This used to render the HTML poster through local
 * Chrome, which does not exist on Vercel and so could never back the admin
 * button. pdf-lib draws the page directly with the brand faces embedded
 * from base64 (src/lib/poster-fonts), the same way the badge avoids
 * needing a font host at render time.
 *
 * Before reporting success it checks the PDF it just wrote, and refuses it
 * otherwise:
 *   - exactly one US Letter page (612 x 792pt),
 *   - DM Sans and Cormorant Garamond embedded, not a fallback face,
 *   - the QR, decoded out of a rendering of the PDF itself (macOS `sips`),
 *     is exactly the join URL.
 */
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import jsQR from "jsqr";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildMarinaPosterPdf, inspectPosterPdf } from "../src/lib/marina-poster-pdf.ts";
import { marinaJoinUrl } from "../src/lib/marina-poster.ts";
import { formatJoinCode, loadMarinaByJoinCode } from "../src/lib/marina-access.ts";

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outDir = resolve((outFlag >= 0 ? args[outFlag + 1] : ".").replace(/^~/, homedir()));
const all = args.includes("--all");
const codes = args.filter((a, i) => !a.startsWith("--") && i !== outFlag + 1);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run via `npm run marina-poster`).");
  process.exit(1);
}
if (!all && codes.length === 0) {
  console.error("Give a marina code (e.g. 7TJY-KFTK) or --all.");
  process.exit(1);
}

const service = createClient(url, key, { auth: { persistSession: false } });

type Marina = { name: string; city: string | null; code: string };
const marinas: Marina[] = [];

if (all) {
  const { data, error } = await service.from("marinas").select("name, city, join_code").not("join_code", "is", null).order("name");
  if (error) throw new Error(error.message);
  for (const m of (data ?? []) as { name: string; city: string | null; join_code: string }[]) {
    marinas.push({ name: m.name, city: m.city, code: m.join_code });
  }
} else {
  for (const typed of codes) {
    const marina = await loadMarinaByJoinCode(service as never, typed);
    if (!marina) {
      console.error(`${typed}: no marina has that code.`);
      process.exit(1);
    }
    marinas.push({ name: marina.name, city: marina.city, code: typed.toUpperCase().replace(/[\s-]/g, "") });
  }
}

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "marina-poster-"));

for (const m of marinas) {
  const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const pdfPath = join(outDir, `moxie-poster-${slug}-${formatJoinCode(m.code)}.pdf`);
  const pdf = await buildMarinaPosterPdf({ marinaName: m.name, city: m.city, joinCode: m.code });
  writeFileSync(pdfPath, pdf);

  // One page, US Letter. A second page would mean something overflowed.
  const facts = await inspectPosterPdf(pdf);
  if (facts.pages !== 1 || Math.round(facts.width) !== 612 || Math.round(facts.height) !== 792) {
    console.error(`${m.name}: expected one 612x792 page, got ${facts.pages} at ${facts.width}x${facts.height}. Not usable.`);
    process.exit(1);
  }
  // The brand faces, embedded — never a substituted fallback.
  const missing = ["DMSans", "CormorantGaramond"].filter((f) => !facts.fonts.some((name) => name.startsWith(f)));
  if (missing.length) {
    console.error(`${m.name}: ${missing.join(", ")} not embedded (got ${facts.fonts.join(", ")}). Not usable.`);
    process.exit(1);
  }

  // Decode the QR from the printed page, not from the path data.
  const pngPath = join(work, `${slug}.png`);
  execFileSync("sips", ["-s", "format", "png", "-Z", "2400", pdfPath, "--out", pngPath], { stdio: "ignore" });
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: "attemptBoth" });
  const expected = marinaJoinUrl(m.code);
  if (decoded?.data !== expected) {
    console.error(`${m.name}: QR on the page decodes to ${JSON.stringify(decoded?.data ?? null)}, expected ${expected}. Not usable.`);
    process.exit(1);
  }

  console.log(`${m.name} — ${formatJoinCode(m.code)} → ${pdfPath}\n  QR decoded from the page: ${decoded.data}`);
}
