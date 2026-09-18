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
