import { buildQrPathSvg } from "./qr-render.ts";
import { formatJoinCode } from "./marina-access.ts";
import { APP_ORIGIN } from "./site-domains.ts";

/**
 * The marina office poster: a US Letter print file. docs/moxie_digital_marina_access_spec.md §3.
 *
 * It sits on a counter and is read at arm's length in poor light, so it is
 * built like the badge rather than like a web page:
 *
 *  - Navy on white for every word. Nothing that carries meaning is in
 *    gold, grey or a light weight; body text is no smaller than 17pt.
 *  - The QR is the badge's own — the same modules, colorway (gold on
 *    navy-deep), Level H correction and quiet zone — drawn as one path
 *    (no seams in a PDF), on a navy panel, so a
 *    tenant recognises it from their hull. marina-poster.test.mts decodes
 *    it out of the rendered page, not out of this string.
 *  - The code is the largest thing after the marina's name, in a heavy
 *    face, with the look-alike-free alphabet the CHECK enforces.
 *
 * The marina's name is sized by length so a long one wraps to two lines at
 * most rather than shrinking the code or pushing the QR off the page.
 *
 * Content, and only this: marina name, the code, the QR to the join URL,
 * one line on what's shared, one line on removing access.
 */

export type PosterInput = { marinaName: string; city: string | null; joinCode: string };

export function marinaJoinUrl(joinCode: string): string {
  return `${APP_ORIGIN}/marina/join?code=${formatJoinCode(joinCode)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Points, by name length. Checked by rendering: 45 and 70 characters both fit one page. */
export function posterNameSize(name: string): number {
  const n = name.trim().length;
  if (n <= 14) return 64;
  if (n <= 22) return 54;
  if (n <= 32) return 44;
  if (n <= 48) return 36;
  return 30;
}

export function buildMarinaPosterHtml({ marinaName, city, joinCode }: PosterInput): string {
  const name = escapeHtml(marinaName.trim());
  const code = formatJoinCode(joinCode);
  const qr = buildQrPathSvg(marinaJoinUrl(joinCode), { width: 1000, margin: 2 });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${name} — Moxie marina code ${code}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&family=DM+Sans:wght@500;700;800&display=block" rel="stylesheet">
<style>
  @page { size: 8.5in 11in; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 8.5in; height: 11in; background: #ffffff; color: #0d1f35; }
  body { font-family: "DM Sans", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 8.5in; height: 11in; padding: 0.5in 0.65in 0.42in; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .eyebrow { font-weight: 700; font-size: 16pt; letter-spacing: 0.14em; text-transform: uppercase; }
  .name { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 600; font-size: ${posterNameSize(marinaName)}pt; line-height: 1.02; margin-top: 0.06in; max-width: 7.2in; }
  .city { font-weight: 500; font-size: 17pt; margin-top: 0.02in; }
  .ask { font-weight: 700; font-size: 22pt; line-height: 1.2; margin-top: 0.16in; max-width: 6.8in; }
  .qrpanel { margin-top: 0.16in; background: #071020; border-radius: 0.2in; padding: 0.14in; }
  .qrpanel svg { display: block; width: 2.75in; height: 2.75in; }
  .scan { font-weight: 700; font-size: 18pt; margin-top: 0.08in; }
  .or { font-weight: 500; font-size: 17pt; margin-top: 0.1in; }
  .or b { font-weight: 800; }
  .code { font-weight: 800; font-size: 64pt; letter-spacing: 0.06em; line-height: 1; margin-top: 0.06in; padding: 0.08in 0.28in 0.1in; border: 4pt solid #0d1f35; border-radius: 0.14in; font-variant-numeric: tabular-nums; }
  .lines { margin-top: 0.2in; max-width: 7.1in; }
  .lines p { font-weight: 500; font-size: 17pt; line-height: 1.28; }
  .lines p + p { margin-top: 0.06in; }
  .foot { margin-top: auto; font-family: "Cormorant Garamond", Georgia, serif; font-style: italic; font-weight: 500; font-size: 20pt; }
  .foot .m { color: #9a7a22; }
</style>
</head>
<body>
<div class="page">
  <p class="eyebrow">Boat owners at</p>
  <h1 class="name">${name}</h1>
  ${city ? `<p class="city">${escapeHtml(city)}</p>` : ""}
  <p class="ask">Share your boat’s contact details with the marina office</p>
  <div class="qrpanel">${qr}</div>
  <p class="scan">Scan with your phone camera</p>
  <p class="or">or go to <b>moxieyacht.com/marina/join</b> and enter</p>
  <p class="code">${code}</p>
  <div class="lines">
    <p>${name} will see your contact details, emergency contact and slip number — and your registration and insurance, if you choose.</p>
    <p>You can remove access any time from your vessel page. The marina isn’t notified.</p>
  </div>
  <p class="foot"><span class="m">M</span>oxie</p>
</div>
</body>
</html>`;
}
