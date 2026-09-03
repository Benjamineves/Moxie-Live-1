/**
 * Static broker-facing design-preview page, embedded verbatim as a
 * string rather than read from the filesystem at request time --
 * Vercel's serverless bundler only reliably includes files it can
 * trace as real import/require dependencies, and docs/ sits outside
 * the web/ app root, so a fs.readFileSync() here is not guaranteed to
 * find the file in production. This mirrors
 * docs/design/moxie_digital_broker_preview.html exactly -- if that
 * file changes, paste the new contents in here too by hand.
 */
export const BROKER_PREVIEW_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Moxie for Brokers — Design Preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=DM+Sans:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --navy:#0d1f35; --navy2:#132943; --gold:#C9A84C; --gold-dim:rgba(201,168,76,.14);
    --cream:#f5f2ec; --white:#fff; --aqua:#1FA394; --aqua-bright:#17C3B2;
    --text2:#3a5068; --text3:#6b8299; --divider:rgba(13,31,53,0.1);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'DM Sans',-apple-system,sans-serif;background:var(--cream);color:var(--navy);line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:820px;margin:0 auto;padding:0 24px}

  /* Preview banner */
  .preview-bar{background:var(--navy);color:var(--gold);text-align:center;padding:11px 24px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}

  /* Hero */
  .hero{padding:56px 0 44px;border-bottom:1px solid var(--divider)}
  .wordmark{font-family:'Cormorant Garamond',serif;font-size:23px;font-style:italic;color:var(--navy);margin-bottom:36px}
  .wordmark .m{color:var(--gold);font-style:normal;font-weight:400}
  .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--text3);margin-bottom:14px}
  h1{font-family:'Cormorant Garamond',serif;font-size:47px;font-weight:300;line-height:1.12;letter-spacing:-.01em;margin-bottom:18px}
  h1 em{font-style:italic;color:var(--gold)}
  .lede{font-size:17px;color:var(--text2);font-weight:300;max-width:600px}

  /* Sections */
  section{padding:44px 0;border-bottom:1px solid var(--divider)}
  h2{font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:300;margin-bottom:8px}
  .sec-eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--text3);margin-bottom:10px}
  p{color:var(--text2);font-weight:300;margin-bottom:16px;font-size:15.5px}
  p strong{color:var(--navy);font-weight:500}

  /* Flow steps */
  .flow{display:flex;flex-direction:column;gap:2px;margin:26px 0 8px}
  .step{display:flex;gap:18px;padding:18px 20px;background:var(--white);border:1px solid var(--divider);align-items:flex-start}
  .step:first-child{border-radius:4px 4px 0 0}
  .step:last-child{border-radius:0 0 4px 4px}
  .step-n{font-family:'Cormorant Garamond',serif;font-size:26px;color:var(--gold);line-height:1;min-width:26px;padding-top:2px}
  .step-t{font-size:15px;font-weight:500;color:var(--navy);margin-bottom:4px}
  .step-d{font-size:13.5px;color:var(--text2);font-weight:300;line-height:1.6}

  /* Callout */
  .callout{background:var(--white);border-left:2px solid var(--gold);padding:20px 22px;margin:26px 0;border-radius:0 4px 4px 0}
  .callout-t{font-size:13px;font-weight:600;color:var(--navy);margin-bottom:6px}
  .callout p{margin:0;font-size:14px}

  /* ID compare */
  .ids{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:24px 0}
  .id-card{background:var(--white);border:1px solid var(--divider);border-radius:4px;padding:20px}
  .id-tag{font-family:monospace;font-size:15px;letter-spacing:.05em;padding:5px 11px;border-radius:3px;display:inline-block;margin-bottom:12px;font-weight:700}
  .id-mxe{background:var(--gold-dim);color:#7a5f1e}
  .id-bxe{background:rgba(23,163,152,.13);color:#0d6b64}
  .id-h{font-size:14px;font-weight:500;margin-bottom:5px}
  .id-p{font-size:13px;color:var(--text2);font-weight:300;line-height:1.6}

  /* Comparison list */
  .points{list-style:none;margin:22px 0}
  .points li{display:flex;gap:13px;padding:13px 0;border-bottom:1px solid var(--divider);align-items:flex-start}
  .points li:last-child{border-bottom:none}
  .pt-ico{width:17px;height:17px;flex-shrink:0;margin-top:3px}
  .pt-ico svg{width:100%;height:100%;stroke:var(--aqua);fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .pt-t{font-size:14.5px;font-weight:500;color:var(--navy);margin-bottom:2px}
  .pt-d{font-size:13.5px;color:var(--text2);font-weight:300;line-height:1.55}

  /* Feedback block */
  .feedback{background:var(--navy);color:var(--white);border-radius:5px;padding:34px 32px;margin:44px 0}
  .feedback h2{color:var(--white);margin-bottom:12px}
  .feedback p{color:rgba(255,255,255,.72);font-size:15px}
  .qs{list-style:none;margin-top:20px}
  .qs li{padding:11px 0;border-top:1px solid rgba(255,255,255,.13);font-size:14.5px;color:rgba(255,255,255,.9);font-weight:300}
  .qs li:before{content:"—";color:var(--gold);margin-right:11px}

  footer{padding:34px 0 60px;font-size:12.5px;color:var(--text3);font-weight:300}
  footer a{color:var(--navy);text-decoration:underline}

  @media(max-width:640px){
    h1{font-size:34px}
    .ids{grid-template-columns:1fr}
    .hero{padding:36px 0 30px}
  }
</style>
</head>
<body>

<div class="preview-bar">Design preview · not yet built · seeking broker feedback</div>

<div class="wrap">

  <div class="hero">
    <div class="wordmark"><span class="m">M</span>oxie</div>
    <div class="eyebrow">For Brokers &amp; Dealers</div>
    <h1>Every listing's paperwork,<br><em>in one place.</em></h1>
    <p class="lede">Moxie gives every boat a permanent digital identity — documents, history, and records that live with the hull instead of in a folder on someone's desk. This is what we're designing for brokers. Nothing here is built yet, and that's the point: we'd rather hear what's wrong with it now.</p>
  </div>

  <section>
    <div class="sec-eyebrow">The problem we think you have</div>
    <h2>Paperwork, times every listing.</h2>
    <p>Registration, title, insurance, survey, maintenance records — scattered across email threads, the seller's glovebox, and whatever the last broker happened to keep. Every listing starts from scratch. Every buyer asks for the same documents. Every closing means chasing the same paper.</p>
    <p>And when the boat sells, all of it evaporates. The next broker, the next buyer, the next surveyor starts over.</p>
  </section>

  <section>
    <div class="sec-eyebrow">How it would work</div>
    <h2>A listing record, free with your account.</h2>
    <p>When you take a listing, you create a record for the boat in Moxie. Upload the documents once. Share them with a prospective buyer with a link that shows exactly what you choose — and that you can revoke the moment you want to.</p>

    <div class="callout">
      <div class="callout-t">The seller doesn't have to do anything.</div>
      <p>No account, no signup, no fee. A seller who's already decided to sell is the last person who wants to be sold something. Creating the listing record is entirely on your side.</p>
    </div>

    <div class="flow">
      <div class="step">
        <div class="step-n">1</div>
        <div>
          <div class="step-t">You take the listing</div>
          <div class="step-d">Create the record, upload what you have. Takes a few minutes, costs nothing beyond your account.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-n">2</div>
        <div>
          <div class="step-t">You share what's relevant</div>
          <div class="step-d">Send a prospective buyer the full document set, or just the survey. Send escrow everything. One link each, revocable, and you see what's been opened.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-n">3</div>
        <div>
          <div class="step-t">The boat sells</div>
          <div class="step-d">The record hands over to the buyer — documents, history, and a permanent identity for the hull. They start with a complete file instead of an empty one.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-n">4</div>
        <div>
          <div class="step-t">You move on</div>
          <div class="step-d">Your commission's earned and the boat's gone. The record goes where it belongs — with the new owner.</div>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="sec-eyebrow">Two kinds of record</div>
    <h2>The listing and the boat are different things.</h2>
    <p>A boat's identity outlives any one sale. A listing is a moment in time. We keep them separate on purpose.</p>

    <div class="ids">
      <div class="id-card">
        <div class="id-tag id-mxe">MXE-01042</div>
        <div class="id-h">The vessel</div>
        <div class="id-p">Permanent. Tied to the hull, survives every sale, never reused. Owned by whoever owns the boat — never by a broker.</div>
      </div>
      <div class="id-card">
        <div class="id-tag id-bxe">BXE-01042</div>
        <div class="id-h">The listing</div>
        <div class="id-p">Yours. Created when you take the listing, holds the paperwork through the sale, and closes when the boat changes hands.</div>
      </div>
    </div>

    <p>A boat can have several listing records over its life — one per brokered sale — while keeping the same vessel identity throughout.</p>
  </section>

  <section>
    <div class="sec-eyebrow">What we're committing to</div>
    <h2>Your listings. Not your records.</h2>
    <ul class="points">
      <li>
        <div class="pt-ico"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <div>
          <div class="pt-t">A vessel record belongs to the owner, always</div>
          <div class="pt-d">You get access, granted and revocable. If the listing ends, the seller keeps their record and you're not holding data for a boat you don't represent.</div>
        </div>
      </li>
      <li>
        <div class="pt-ico"><svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></div>
        <div>
          <div class="pt-t">No cap on your book</div>
          <div class="pt-d">Priced per brokerage and per seat, not per listing. Having a lot of inventory shouldn't cost you more.</div>
        </div>
      </li>
      <li>
        <div class="pt-ico"><svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <div>
          <div class="pt-t">Licensed accounts only</div>
          <div class="pt-d">Brokerage accounts are approved individually. This isn't a tool for someone to run transactions without a license.</div>
        </div>
      </li>
      <li>
        <div class="pt-ico"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></div>
        <div>
          <div class="pt-t">We're not becoming a brokerage</div>
          <div class="pt-d">Moxie is the record, not the transaction. Our next build after this is deeper integration with title and escrow — the parts of a closing that slow you down.</div>
        </div>
      </li>
    </ul>
  </section>

  <div class="feedback">
    <h2>What we'd actually like to know</h2>
    <p>This is a design, not a product. Before we build it, we'd rather find out which parts are wrong.</p>
    <ul class="qs">
      <li>Is document chaos actually a real cost in your day, or is it noise?</li>
      <li>Would you use a free listing record, or is one more system worse than the problem?</li>
      <li>What would your brokerage pay for this, per seat, per year?</li>
      <li>What would make you refuse to use it at all?</li>
      <li>What did we not think of?</li>
    </ul>
  </div>

  <footer>
    Moxie Digital · Northern California · <a href="mailto:info@moxieyachting.com">info@moxieyachting.com</a><br>
    Nothing described on this page is currently available. Vessel identity, document storage, sharing, and ownership transfer are live today at <a href="https://moxieyachting.com">moxieyachting.com</a>.
  </footer>

</div>
</body>
</html>
`;
