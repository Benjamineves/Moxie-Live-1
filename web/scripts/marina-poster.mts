/**
 * THE MARINA OFFICE POSTER, AS A PRINT FILE.
 *
 *   npm run marina-poster -- 7TJY-KFTK            one marina, by its code
 *   npm run marina-poster -- --all                every marina with a code
 *   npm run marina-poster -- 7TJY-KFTK --out ~/Desktop
 *
 * Reads the marina from the live database (read-only), builds the page
 * with src/lib/marina-poster.ts — the shipped builder, not a copy — and
 * prints it to a vector PDF with headless Chrome, which embeds the brand
 * fonts and keeps the QR as crisp vector modules at any print size.
 *
 * Why Chrome and not sharp, which renders the badge: sharp/librsvg has no
 * @font-face support, so the badge outlines its text through fonts subset
 * to A–Z, 0–9 and a few letters. A poster prints marina names and
 * sentences, which that subset can't draw. This is a local tool, run on
 * the Mac where Chrome is installed; set CHROME_PATH if it lives elsewhere.
 *
 * Needs network for Google Fonts. Before reporting success the script
 * checks the PDF it just wrote, and refuses it otherwise:
 *   - exactly one US Letter page (a second page means something overflowed),
 *   - DM Sans and Cormorant Garamond embedded, not a fallback face,
 *   - the QR, decoded out of a rendering of the PDF itself (macOS `sips`),
 *     is exactly the join URL.
 */
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import jsQR from "jsqr";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildMarinaPosterHtml, marinaJoinUrl } from "../src/lib/marina-poster.ts";
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

const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!existsSync(chrome)) {
  console.error(`Chrome not found at ${chrome}. Set CHROME_PATH.`);
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
  const htmlPath = join(work, `${slug}.html`);
  const pdfPath = join(outDir, `moxie-poster-${slug}-${formatJoinCode(m.code)}.pdf`);
  writeFileSync(htmlPath, buildMarinaPosterHtml({ marinaName: m.name, city: m.city, joinCode: m.code }));

  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-pdf-header-footer",
      "--virtual-time-budget=15000",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: "ignore" },
  );

  // One page, US Letter (612 × 792 pt). A second page means something
  // overflowed and the code or QR is split — refuse it rather than print it.
  const pdf = readFileSync(pdfPath).toString("latin1");
  const pages = pdf.match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
  const letter = /\/MediaBox\s*\[\s*0\s+0\s+612\s+792\s*\]/.test(pdf);
  if (pages !== 1 || !letter) {
    console.error(`${m.name}: expected one US Letter page, got ${pages} page(s)${letter ? "" : ", not Letter-sized"}. Not usable.`);
    process.exit(1);
  }
  // The brand faces, embedded — a missing Google Fonts fetch silently
  // falls back to Arial/Georgia, which would still "work" and look wrong.
  const missingFonts = ["DMSans", "CormorantGaramond"].filter((f) => !pdf.includes(f));
  if (missingFonts.length) {
    console.error(`${m.name}: ${missingFonts.join(", ")} not embedded — fonts didn't load (network?). Not usable.`);
    process.exit(1);
  }

  // Decode the QR from the printed page, not from the SVG string.
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
