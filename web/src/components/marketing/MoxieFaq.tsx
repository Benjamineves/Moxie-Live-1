import Link from "next/link";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

/**
 * THE FAQ, built from docs/design/moxie_faq_page.html.
 *
 * COPY IS SETTLED — the mockup is the reference and the answers here are
 * its words. Two constraints in it still bind and are load-bearing rather
 * than stylistic:
 *
 *  - #expiry-status says documents show current / expiring soon / expired
 *    and nothing about reminders. The expiry-reminder email has a template
 *    and no sender (CLAUDE.md, "Copy never promises what doesn't send").
 *    When the scheduler's reminder step is switched on, that answer gains
 *    a sentence; not before.
 *  - Nothing here mentions service records or unlimited documents. Both are
 *    roadmap items, neither is built, and /pricing already carries one
 *    unfounded claim of that kind without this page adding another.
 *
 * ANCHORS ARE AN API. Every question's id is fixed and matches the mockup,
 * because these get linked from support email, in-app nudges and expiry
 * prompts. Renaming one silently breaks links already sent to people, so
 * they are listed in FAQ_ANCHORS and held there by a test.
 *
 * TYPE SCALE is deliberately smaller than the mockup, which read larger
 * than the rest of the site: body is 15px font-light like MoxiePricing's
 * prose, questions 16px, section heads text-2xl display italic like the
 * pricing cards, page title text-3xl like every other non-hero page.
 *
 * LIGHT SURFACE. Links are --gold-deep (5.23:1 on cream, 5.84:1 on white)
 * and muted text is --text3 at its corrected value (5.02:1 on cream,
 * 5.61:1 on white). Brand addendum §6b — --gold would be 2.05:1 here.
 */

/** Every anchor this page publishes. Linked from outside; never rename. */
export const FAQ_ANCHORS = [
  "getting-started",
  "what-is-moxie",
  "what-is-the-badge",
  "mxe-number",
  "badge-or-app",
  "home-screen",
  "scanning",
  "what-a-scan-shows",
  "stranger-documents",
  "scan-my-own",
  "how-it-knows",
  "share-documents",
  "documents",
  "what-can-i-store",
  "expiry-status",
  "offline",
  "security",
  "ownership",
  "selling",
  "buying-badged-boat",
  "locked-fields",
  "out-of-service",
  "practical",
  "cost",
  "plan-differences",
  "transfer-fee",
  "damaged-badge",
  "outside-california",
] as const;

const SECTIONS = [
  { id: "getting-started", label: "Getting started" },
  { id: "scanning", label: "Scanning & privacy" },
  { id: "documents", label: "Documents" },
  { id: "ownership", label: "Ownership & transfer" },
  { id: "practical", label: "Plans & practical" },
];

const body = "font-[family-name:var(--font-dm)] text-[15px] font-light leading-relaxed text-[var(--text2)]";
const link = "text-[var(--gold-deep)] underline underline-offset-2 transition hover:text-[var(--navy)]";

function Question({ id, q, children }: { id: string; q: string; children: React.ReactNode }) {
  return (
    <div id={id} className="mb-8 scroll-mt-20">
      <h3 className="mb-2 font-[family-name:var(--font-dm)] text-[16px] font-semibold leading-snug text-[var(--navy)]">{q}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="mt-14 border-t border-[var(--divider)] pt-8 first:mt-0 first:border-t-0 first:pt-0">
      <h2 id={id} className="scroll-mt-20 font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
        {title}
      </h2>
      <p className="mb-7 mt-1 font-[family-name:var(--font-dm)] text-[13px] text-[var(--text3)]">{note}</p>
      {children}
    </section>
  );
}

export function MoxieFaq({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <MarketingNav isAuthenticated={isAuthenticated} />

      <main className="mx-auto max-w-[760px] px-6 pb-24 pt-32 md:px-8">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic leading-tight text-[var(--navy)] md:text-4xl">
          Frequently asked questions
        </h1>
        <p className={`mt-3 max-w-[58ch] ${body}`}>
          What Moxie is, what a scan shows, and what happens to the record when the boat changes hands.
        </p>

        <nav aria-label="On this page" className="mt-8 mb-14 rounded-xl bg-[var(--white)] px-5 py-4 shadow-sm">
          <p className="mb-2 font-[family-name:var(--font-dm)] text-[11px] uppercase tracking-[0.16em] text-[var(--text3)]">
            On this page
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className={`font-[family-name:var(--font-dm)] text-[14px] ${link}`}>
                {s.label}
              </a>
            ))}
          </div>
        </nav>

        <Section id="getting-started" title="Getting started" note="The basics, in about two minutes.">
          <Question id="what-is-moxie" q="What is Moxie?">
            <p className={body}>
              A permanent digital identity for your boat. The record lives with the hull rather than with you, so it
              carries forward when the boat is sold — the way a vehicle history follows a car rather than its driver.
            </p>
            <p className={body}>
              You register the vessel once, add what matters, and it stays attached to that boat for as long as the boat
              exists.
            </p>
          </Question>

          <Question id="what-is-the-badge" q="What&rsquo;s the badge?">
            <p className={body}>
              A weatherproof vinyl QR badge you affix to the hull. Scanning it pulls up the vessel&rsquo;s profile — no app
              to download, no account needed to look.
            </p>
          </Question>

          <Question id="mxe-number" q="What does the MXE number mean?">
            <p className={body}>
              The MXE number is a permanent identifier, assigned once and never reissued. It stays with the boat it was
              assigned to and follows it through every change of ownership.
            </p>
            <p className={body}>
              No two vessels share one, and a number is never recycled — not even after a boat is decommissioned.
            </p>
          </Question>

          <Question id="badge-or-app" q="Do I need the badge, or is the app enough?">
            <p className={body}>
              Honestly: the app works without it, but the badge is the point. Everything else is a record. The badge is
              what makes that record reachable by someone standing at the boat.
            </p>
            <p className={body}>
              The flexibility is in what a scan reveals. One badge, and what appears depends entirely on who is looking.
            </p>
          </Question>

          <Question id="home-screen" q="How do I put Moxie on my phone&rsquo;s home screen?">
            <p className={body}>
              Install it from any page. It opens straight to your dashboard and you stay signed in, so there&rsquo;s no
              logging in on a dock in the wind.
            </p>
            <p className={body}>
              <strong className="font-semibold text-[var(--navy)]">On iPhone or iPad:</strong> open moxieyacht.com in
              Safari, tap the Share button, then{" "}
              <strong className="font-semibold text-[var(--navy)]">Add to Home Screen</strong>. It has to be Safari —
              other browsers on iOS don&rsquo;t offer it.
            </p>
            <p className={body}>
              <strong className="font-semibold text-[var(--navy)]">On Android:</strong> Chrome will offer to install it,
              or use the menu and choose <strong className="font-semibold text-[var(--navy)]">Install app</strong>.
            </p>
          </Question>
        </Section>

        <Section id="scanning" title="Scanning and privacy" note="What a scan shows, and to whom.">
          <Question id="what-a-scan-shows" q="What happens when someone scans my badge?">
            <p className={body}>It depends who&rsquo;s scanning, and who you&rsquo;ve authorised.</p>
            <p className={body}>
              A stranger — someone admiring the boat at a dock, or a buyer at a brokerage — sees a limited public
              profile: vessel name, make, model, year and photo. Not your documents. Not your contact details. Nothing
              that identifies you.
            </p>
            <p className={body}>
              Someone you&rsquo;ve given a share link to sees more, because you decided they should. And when you scan it
              yourself, you get your own full record.
            </p>
            <p className={body}>Same badge, three different answers.</p>
          </Question>

          <Question id="stranger-documents" q="Can a stranger see my registration or insurance?">
            <p className={body}>
              No. Documents are private to you and to the people you explicitly share them with. A public scan never
              reaches them.
            </p>
          </Question>

          <Question id="scan-my-own" q="What do I see when I scan my own boat?">
            <p className={body}>
              Your own full record, because you&rsquo;re signed in — every stored detail, your documents, and their expiry
              status. Same badge, different view.
            </p>
          </Question>

          <Question id="how-it-knows" q="How does it know who&rsquo;s scanning?">
            <p className={body}>
              The profile renders differently depending on who&rsquo;s signed in when the badge is scanned. One QR code,
              resolving to whatever that particular person is entitled to see.
            </p>
            <p className={body}>It&rsquo;s the part of Moxie we&rsquo;ve applied for a patent on.</p>
          </Question>

          <Question id="share-documents" q="Can I show my documents to someone — a surveyor, a buyer, my marina?">
            <p className={body}>
              Yes, with a share link you create and control. You choose what it includes and you can revoke it at any
              time. No account needed on their end.
            </p>
          </Question>
        </Section>

        <Section id="documents" title="Documents" note="What you can keep, and getting to it when you need it.">
          <Question id="what-can-i-store" q="What can I store?">
            <p className={body}>
              Registration, insurance, boater card and fishing licence — the paperwork you&rsquo;d otherwise keep in a damp
              folder in a locker.
            </p>
          </Question>

          <Question id="expiry-status" q="How do I know if something&rsquo;s expired?">
            <p className={body}>
              Each document shows its status at a glance: current, expiring soon, or expired. Add the expiry date when
              you upload — it&rsquo;s printed on the document — and Moxie tracks it from there.
            </p>
          </Question>

          <Question id="offline" q="Can I get to my documents without a signal?">
            <p className={body}>
              Yes, if you&rsquo;ve explicitly saved that vessel for offline first. Open the vessel and choose to make it
              available offline, and its documents come with you.
            </p>
            <p className={body}>
              Moxie doesn&rsquo;t quietly cache things in the background. You decide what&rsquo;s stored on your phone, so you
              always know what&rsquo;s there.
            </p>
          </Question>

          <Question id="security" q="Is my information secure?">
            <p className={body}>
              Documents are held in private storage, reachable only by you and by anyone you&rsquo;ve deliberately shared
              with. They&rsquo;re not public, not indexed, and not reachable from a scan.
            </p>
          </Question>
        </Section>

        <Section id="ownership" title="Ownership and transfer" note="The part that makes a permanent record worth having.">
          <Question id="selling" q="What happens when I sell the boat?">
            <p className={body}>
              The identity transfers to the buyer. The MXE number, the badge on the hull, and the vessel&rsquo;s own details
              all stay with the boat.
            </p>
            <p className={body}>
              The rule is simple — <strong className="font-semibold text-[var(--navy)]">what describes the boat carries;
              what describes you doesn&rsquo;t</strong>:
            </p>
            <div className="rounded-xl bg-[var(--white)] px-5 py-4 shadow-sm">
              <p className={`mb-2 ${body}`}>
                <strong className="font-semibold text-[var(--navy)]">Carries to the buyer:</strong> the MXE number,
                badge, vessel name, make, model, year, HIN, photo, the chain of title, the registration document, and
                the service history — the entries and their dates, without the attached files.
              </p>
              <p className={body}>
                <strong className="font-semibold text-[var(--navy)]">Stays with you:</strong>{" "}
                your insurance, your boater card, your fishing licence, your contact and emergency details, and the
                files attached to your service entries — all cleared from the boat at transfer. Share links you&rsquo;d
                created and marina access you&rsquo;d granted are revoked.
              </p>
            </div>
            <p className={body}>
              You keep a permanent read-only copy of the vessel as it was on the day you sold it. Anything the new owner
              adds afterwards is theirs, and isn&rsquo;t visible to you.
            </p>
          </Question>

          <Question id="buying-badged-boat" q="What if I buy a boat that already has a badge?">
            <p className={body}>
              The seller starts the transfer from their account using your email address. Moxie emails you a link that
              only works for that address.
            </p>
            <p className={body}>
              You open it, create an account if you don&rsquo;t have one, and accept. Once the seller pays the transfer fee,
              the vessel appears in your dashboard with its history intact.
            </p>
          </Question>

          <Question id="locked-fields" q="Why can&rsquo;t I edit the HIN or year?">
            <p className={body}>
              A boat&rsquo;s HIN and year of build don&rsquo;t change, in the same way its MXE number doesn&rsquo;t. Locking them is
              what makes the record worth anything — a record you can freely rewrite isn&rsquo;t a record.
            </p>
            <p className={body}>
              If something was entered incorrectly, it can be corrected with supporting documentation. Contact support
              and we&rsquo;ll put it right.
            </p>
          </Question>

          <Question id="out-of-service" q="What if I take the boat out of service?">
            <p className={body}>
              You can decommission it. The vessel is archived, its record preserved, and its MXE number retired
              permanently — never reissued to another boat. Available on every plan.
            </p>
          </Question>
        </Section>

        <Section id="practical" title="Plans and practical" note="Cost, coverage, and what to do if something goes wrong.">
          <Question id="cost" q="What does it cost?">
            <p className={body}>
              Current pricing is on the{" "}
              <Link href="/pricing" className={link}>
                pricing page
              </Link>
              .
            </p>
          </Question>

          <Question id="plan-differences" q="What&rsquo;s the difference between plans?">
            <p className={body}>
              Plans differ mainly in how many vessels you can keep active and how much you can store against each.
              Because features change as we build, the{" "}
              <Link href="/pricing" className={link}>
                pricing page
              </Link>{" "}
              is always the accurate answer.
            </p>
          </Question>

          <Question id="transfer-fee" q="Is there a fee to transfer a boat?">
            <p className={body}>
              Yes, and it&rsquo;s charged to the seller once the buyer accepts. Nothing is charged if a transfer is never
              accepted.
            </p>
          </Question>

          <Question id="damaged-badge" q="What if my badge gets damaged or falls off?">
            <p className={body}>
              You can print a temporary one immediately — your badge is downloadable from the vessel&rsquo;s page, and plain
              paper works while you wait.
            </p>
            <p className={body}>
              For a replacement, email{" "}
              <a href="mailto:support@moxieyacht.com" className={link}>
                support@moxieyacht.com
              </a>{" "}
              with your MXE number. Replacement fees apply. Your MXE number never changes, so the new badge is identical
              to the old one.
            </p>
          </Question>

          <Question id="outside-california" q="Do you work outside California?">
            <p className={body}>
              We&rsquo;re headquartered in California and the Bay Area is where you&rsquo;ll find most of us, most of the time.
              But a hull number is a hull number, and nothing about Moxie stops at a state line.
            </p>
            <p className={body}>If your boat floats, we&rsquo;ll badge it.</p>
          </Question>
        </Section>

        <div className="mt-16 border-t border-[var(--divider)] pt-7">
          <p className="font-[family-name:var(--font-dm)] text-[14px] text-[var(--text3)]">
            Still stuck? Email{" "}
            <a href="mailto:support@moxieyacht.com" className={link}>
              support@moxieyacht.com
            </a>{" "}
            and a person will answer.
          </p>
        </div>
      </main>

      <MarketingFooter isAuthenticated={isAuthenticated} />
    </div>
  );
}
