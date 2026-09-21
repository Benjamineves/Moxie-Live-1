import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import jsQR from "jsqr";
import { buildMarinaPosterHtml, marinaJoinUrl, posterNameSize } from "./marina-poster.ts";
import { buildQrPathSvg, buildQrSvg } from "./qr-render.ts";

async function decodeSvg(svg: string): Promise<string | null> {
  const { data, info } = await sharp(Buffer.from(svg)).resize(900, 900).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

test("the join URL is the app origin with the printed form of the code", () => {
  assert.equal(marinaJoinUrl("7TJYKFTK"), "https://moxieyacht.com/marina/join?code=7TJY-KFTK");
});

test("the poster's path QR scans to the same URL as the badge's rect QR", async () => {
  const url = marinaJoinUrl("7TJYKFTK");
  assert.equal(await decodeSvg(buildQrPathSvg(url, { width: 900, margin: 2 })), url);
  assert.equal(await decodeSvg(buildQrSvg(url, { width: 900, margin: 2 })), url);
});

test("the poster carries the name, the code, the QR and the two lines — and escapes the name", () => {
  const html = buildMarinaPosterHtml({ marinaName: "Bay & Harbor <Marina>", city: "Oakland", joinCode: "7TJYKFTK" });
  assert.match(html, /Bay &amp; Harbor &lt;Marina&gt;<\/h1>/);
  assert.doesNotMatch(html, /<Marina>/);
  assert.match(html, /<p class="code">7TJY-KFTK<\/p>/);
  assert.match(html, /<svg[^>]*viewBox/);
  assert.match(html, /will see your contact details, emergency contact and slip number — and your registration and insurance, if you choose\./);
  assert.match(html, /You can remove access any time from your vessel page\. The marina isn’t notified\./);
});

test("nothing on the poster that carries meaning is below 17pt", () => {
  const html = buildMarinaPosterHtml({ marinaName: "X", city: null, joinCode: "7TJYKFTK" });
  const sizes = [...html.matchAll(/font-size: (\d+)pt/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length > 5);
  assert.ok(Math.min(...sizes) >= 16, `smallest ${Math.min(...sizes)}pt`);
  // 16pt is only the uppercase eyebrow; every sentence is 17pt or more.
  assert.match(html, /\.lines p \{ font-weight: 500; font-size: 17pt/);
});

test("longer names step down in size, never up", () => {
  const sizes = [5, 14, 15, 22, 23, 32, 33, 48, 49, 80].map((n) => posterNameSize("x".repeat(n)));
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] <= sizes[i - 1]);
  assert.equal(posterNameSize("Moxie Test Marina"), 54);
});

// ─── The PDF the admin button and the batch script both produce ──────────

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMarinaPosterPdf, inspectPosterPdf, unprintablePosterChars } from "./marina-poster-pdf.ts";

const POSTER = { marinaName: "Moxie Test Marina", city: "Oakland", joinCode: "7TJYKFTK" };

test("the poster is one US Letter page with the brand faces embedded", async () => {
  const facts = await inspectPosterPdf(await buildMarinaPosterPdf(POSTER));
  assert.equal(facts.pages, 1);
  assert.equal(Math.round(facts.width), 612);
  assert.equal(Math.round(facts.height), 792);
  // Not a substituted fallback: the faces are in the file.
  assert.ok(facts.fonts.some((f) => f.startsWith("DMSans")), facts.fonts.join(", "));
  assert.ok(facts.fonts.some((f) => f.startsWith("CormorantGaramond")), facts.fonts.join(", "));
  assert.ok(!facts.fonts.some((f) => /Helvetica|Arial|Times/.test(f)), facts.fonts.join(", "));
});

test("long marina names still fit one page", async () => {
  for (const marinaName of [
    "St. Francis Yacht Club & Marina of Sausalito",
    "The Extraordinarily Long-Named Municipal Harbor and Yacht Basin Marina",
  ]) {
    const facts = await inspectPosterPdf(await buildMarinaPosterPdf({ ...POSTER, marinaName }));
    assert.equal(facts.pages, 1, `${marinaName.length} characters spilled onto ${facts.pages} pages`);
  }
});

test("a name the font subset can't print is refused, not printed with blanks", async () => {
  assert.deepEqual(unprintablePosterChars("Bahía Marina — Café"), []);
  assert.deepEqual(unprintablePosterChars("マリーナ"), ["マ", "リ", "ー", "ナ"]);
  await assert.rejects(buildMarinaPosterPdf({ ...POSTER, marinaName: "マリーナ" }), /can't print/);
});

test("the QR on the rendered page decodes to the join URL", { skip: process.platform !== "darwin" ? "needs macOS sips" : false }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "poster-test-"));
  const pdfPath = join(dir, "poster.pdf");
  const pngPath = join(dir, "poster.png");
  writeFileSync(pdfPath, await buildMarinaPosterPdf(POSTER));
  execFileSync("sips", ["-s", "format", "png", "-Z", "2400", pdfPath, "--out", pngPath], { stdio: "ignore" });
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: "attemptBoth" });
  assert.equal(decoded?.data, marinaJoinUrl("7TJYKFTK"));
});
