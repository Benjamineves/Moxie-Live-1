import Link from "next/link";
import { APP_ORIGIN } from "@/lib/site-domains";
import { WaitlistForm } from "@/components/marketing/WaitlistForm";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { ScanDemo } from "@/components/marketing/ScanDemo";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

/** Marketing homepage — structure & content from `Guide2/moxie_homepage_v2.html` (technical spec). */
export function MoxieMarketingHome({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <div className="overflow-x-hidden bg-[var(--cream)]">
      <MarketingNav isAuthenticated={isAuthenticated} />

      <section className="relative flex min-h-screen flex-col justify-end overflow-hidden bg-[var(--navy)] pb-20 pt-28 md:pb-24">
        <div className="absolute left-0 right-0 top-0 z-20 h-[3px] bg-[var(--gold)]" />
        <div className="absolute -right-[5%] -top-[8%] z-[1] h-[clamp(300px,45vw,600px)] w-[clamp(300px,45vw,600px)] rounded-full bg-[radial-gradient(circle,var(--gold)_0%,rgba(201,168,76,.7)_60%,transparent_100%)] opacity-15" />
        <div className="absolute -bottom-[5%] -left-[3%] z-[1] h-[clamp(200px,30vw,420px)] w-[clamp(200px,30vw,420px)] rounded-full bg-[radial-gradient(circle,var(--aqua-bright)_0%,rgba(23,195,178,.5)_60%,transparent_100%)] opacity-[0.08]" />
        <div
          className="pointer-events-none absolute bottom-[-0.12em] left-[-0.02em] z-[2] whitespace-nowrap font-[family-name:var(--font-display)] text-[clamp(140px,22vw,300px)] font-light italic leading-none tracking-tight text-[rgba(255,255,255,0.03)]"
          aria-hidden
        >
          Moxie
        </div>
        <div className="marketing-hero-enter relative z-10 mx-auto max-w-[1200px] px-6 md:px-12">
          <p className="mb-5 flex items-center gap-3.5 text-[11px] font-normal uppercase tracking-[0.22em] text-[var(--gold)]">
            <span className="inline-block h-px w-8 bg-[var(--gold)]" />
            The digital dry bag
          </p>
          <h1 className="mb-7 font-[family-name:var(--font-display)] text-[clamp(52px,8vw,110px)] font-light leading-[0.93] tracking-tight text-white">
            Your Boat&apos;s
            <br />
            <em className="text-[var(--gold-lt)] not-italic">Digital</em> Home.
          </h1>
          <p className="mb-12 max-w-[520px] text-[clamp(15px,1.6vw,18px)] font-light leading-relaxed text-[rgba(255,255,255,0.55)]">
            A weatherproof QR badge on the hull. A persistent digital profile for every vessel. What people see
            depends on who they are.
          </p>
          <div className="flex flex-wrap items-center gap-3.5">
            <a
              href={`${APP_ORIGIN}/signup?next=%2Fdashboard`}
              className="inline-flex items-center gap-2.5 bg-[var(--aqua-bright)] px-8 py-4 font-[family-name:var(--font-dm)] text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--navy)] no-underline transition hover:gap-4 hover:bg-[var(--aqua-vapor)]"
            >
              Create your account →
            </a>
            <a
              href="#qr-hero"
              className="inline-flex items-center gap-2.5 border-b border-[rgba(255,255,255,0.2)] py-4 font-[family-name:var(--font-dm)] text-[12px] font-medium uppercase tracking-[0.18em] text-[rgba(255,255,255,0.7)] no-underline transition hover:border-[var(--gold)] hover:text-[var(--gold)]"
            >
              See how it works →
            </a>
          </div>
        </div>
      </section>

      <div className="overflow-hidden whitespace-nowrap bg-[var(--gold)] py-3">
        <div className="marketing-ticker-inner inline-flex">
          {[
            "Your boat's digital home",
            "One boat, one identity",
            "Weatherproof vinyl QR",
            "Scan to verify, instantly",
            "Role-gated access",
            "Share exactly what you choose",
            "Documents always on hand",
            "Self-serve, no marina required",
          ]
            .concat([
              "Your boat's digital home",
              "One boat, one identity",
              "Weatherproof vinyl QR",
              "Scan to verify, instantly",
              "Role-gated access",
              "Share exactly what you choose",
              "Documents always on hand",
              "Self-serve, no marina required",
            ])
            .map((t, i) => (
              <span
                key={i}
                className="px-8 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--navy)]"
              >
                {t}
                <span className="px-4 text-[rgba(13,31,53,0.3)]">◆</span>
              </span>
            ))}
        </div>
      </div>

      <section id="qr-hero" className="relative overflow-hidden bg-[var(--navy)] px-6 py-[100px] md:px-12">
        <div className="absolute -right-20 -top-20 h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(201,168,76,0.08)_0%,transparent_70%)]" />
        <div className="relative z-[1] mx-auto grid max-w-[1160px] items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <p className="mb-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--aqua-bright)]">
              <span className="h-px w-6 bg-[var(--aqua-bright)]" />
              The QR badge
            </p>
            <h2 className="mb-7 font-[family-name:var(--font-display)] text-[clamp(36px,5vw,62px)] font-light leading-[1.05] text-white">
              One badge.
              <br />
              Every <span className="italic text-[var(--aqua-bright)]">identity.</span>
            </h2>
            <p className="mb-10 max-w-[480px] text-[15px] font-light leading-relaxed text-[rgba(255,255,255,0.55)]">
              A single weatherproof vinyl QR sticker goes on the hull. Anyone with a phone
              can scan it. What they see depends on who they are — your personal information is never exposed to the
              public.
            </p>
            <a
              href={`${APP_ORIGIN}/signup?next=%2Fdashboard`}
              className="inline-flex items-center gap-2.5 bg-[var(--aqua-bright)] px-8 py-4 font-[family-name:var(--font-dm)] text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--navy)] no-underline transition hover:bg-[var(--aqua-vapor)]"
            >
              Register your vessel →
            </a>
          </div>
          <div className="flex justify-center">
            <div className="w-[240px] rounded-[14px] border border-[rgba(201,168,76,0.2)] bg-[var(--navy)] px-6 pb-5 pt-6 text-center shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
              <div className="mb-4 font-[family-name:var(--font-display)] text-[18px] font-normal italic text-white">
                <span className="text-[var(--gold)]">M</span>oxie
              </div>
              <div className="mx-auto mb-3 grid h-[160px] w-[160px] grid-cols-9 grid-rows-9 gap-0.5 bg-[var(--navy-deep)] p-1">
                {Array.from({ length: 81 }).map((_, i) => {
                  const lt = new Set([
                    3, 5, 10, 14, 21, 23, 28, 30, 31, 32, 33, 34, 36, 38, 39, 40, 41, 42, 44, 48, 50, 51, 59, 60, 61,
                    65, 67, 68, 69,
                  ]);
                  const gold = new Set([
                    0, 1, 2, 4, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 19, 20, 22, 24, 25, 26, 27, 29, 35, 37, 43,
                    45, 46, 47, 49, 52, 53, 54, 55, 56, 57, 58, 62, 63, 64, 66, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
                  ]);
                  if (i === 80) return <div key={i} className="rounded-[1px] bg-[var(--aqua-bright)]" />;
                  if (lt.has(i)) return <div key={i} className="rounded-[1px] bg-transparent" />;
                  if (gold.has(i)) return <div key={i} className="rounded-[1px] bg-[var(--gold)]" />;
                  return <div key={i} className="rounded-[1px] bg-[rgba(255,255,255,0.06)]" />;
                })}
              </div>
              <div className="my-3 h-px w-full bg-[var(--gold)] opacity-50" />
              <p className="font-[family-name:var(--font-dm)] text-[8px] font-medium uppercase leading-snug tracking-[0.22em] text-[rgba(255,255,255,0.5)]">
                Registered vessel
                <br />
                Scan · MXE-00001
              </p>
              <p className="mt-2 font-[family-name:var(--font-dm)] text-[6px] font-medium uppercase tracking-[0.14em] text-[rgba(255,255,255,0.25)]">
                Patent Pending
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="bg-[var(--cream)] px-6 py-[100px] md:px-12">
        <div className="mx-auto max-w-[1160px]">
          <p className="mb-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold-deep)]">
            <span className="h-px w-6 bg-[var(--gold)]" />
            How it works
          </p>
          <h2 className="mb-[72px] font-[family-name:var(--font-display)] text-[clamp(36px,5vw,62px)] font-light leading-[1.05] text-[var(--navy)]">
            Three steps.
            <br />
            <em className="text-[var(--gold-deep)] not-italic">Always working.</em>
          </h2>
          <div className="grid gap-0.5 bg-[var(--divider)] md:grid-cols-3">
            {[
              {
                n: "01",
                title: "You register your vessel",
                body: "Make, model, year, HIN, storage details, insurance, registration — everything in one persistent digital identity, filled in by you in a few minutes. You control what's shared and with whom.",
              },
              {
                n: "02",
                title: "Sticker goes on the boat",
                body: "A premium weatherproof vinyl QR sticker — 3M marine-grade with gloss overlaminate. Designed to last, built to look right on a yacht.",
              },
              {
                n: "03",
                title: "Anyone can scan it",
                body: "A stranger sees the boat — make, model, year, photo — and nothing about you. You see everything, and can edit it. The people you let in — a captain, a cleaner, family — see only what you share, through a link you can revoke.",
              },
            ].map((c) => (
              <div
                key={c.n}
                className="bg-[var(--white)] p-10 transition hover:bg-[#fdfbf7] md:p-12"
              >
                <div className="mb-6 font-[family-name:var(--font-display)] text-[72px] font-light italic leading-none text-[var(--gold-dim)]">
                  {c.n}
                </div>
                <h3 className="mb-3.5 font-[family-name:var(--font-display)] text-[22px] font-normal leading-tight text-[var(--navy)]">
                  {c.title}
                </h3>
                <p className="text-[14px] font-light leading-relaxed text-[var(--text2)]">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="who" className="relative overflow-hidden bg-[var(--navy)] px-6 py-[100px] md:px-12">
        <div className="absolute -right-[100px] -top-[100px] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(201,168,76,0.06)_0%,transparent_70%)]" />
        <div className="relative z-[2] mx-auto max-w-[1160px]">
          <p className="mb-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">
            <span className="h-px w-6 bg-[var(--gold)]" />
            Who it&apos;s for
          </p>
          <h2 className="mb-16 font-[family-name:var(--font-display)] text-[clamp(36px,5vw,62px)] font-light leading-[1.05] text-white">
            One scan.
            <br />
            <em className="text-[var(--gold-lt)] not-italic">Four audiences.</em>
          </h2>
          <div className="grid gap-0.5 bg-[rgba(255,255,255,0.06)] md:grid-cols-2">
            {[
              {
                badge: "Boat Owner",
                badgeClass: "bg-[var(--green-bg)] text-[var(--green-fg)]",
                title: "Your boat's command center",
                body: "Full read/write access to every field. Insurance docs, registration, maintenance logs — always with the boat, always current.",
                items: [
                  "Store insurance, registration, boater card",
                  "Manage who sees what",
                  // Not "no app needed": an owner is better served by the
                  // installed web app, which opens straight to their boats and
                  // keeps them signed in. A link rather than an install button,
                  // because iOS cannot install a web app programmatically — the
                  // FAQ walks through Safari's Share → Add to Home Screen.
                  // (The FAQ's own "no app needed" is about scanning, and stays.)
                  <>
                    Install it on your home screen —{" "}
                    <Link href="/faq#home-screen" className="text-[var(--gold)] underline underline-offset-2">
                      here&rsquo;s how
                    </Link>
                  </>,
                ],
              },
              {
                // PLANNED, NOT BUILT. There is no way to sign in as a marina
                // operator today; filterVesselForRole has a "marina" data shape
                // and nothing reaches it. Every line here is future tense on
                // purpose. "Slip occupancy management" was dropped: it is in no
                // spec and no code, so it was a promise with nothing behind it.
                // What IS live is the "Marina / Dock Staff" share preset, which
                // shares the owner's name and phone and nothing on this list —
                // so "Available now" claims only that. The body describes v1 as
                // specified (docs/moxie_digital_marina_access_spec.md): documents
                // at the owner's option, not insurance/registration "status".
                // An earlier version said owners could share "those details"
                // today; no share flag exposes insurance status, so it never
                // could.
                badge: "Marina Operator",
                badgeClass: "bg-[var(--blue-bg)] text-[var(--blue-fg)]",
                title: "A marina view, planned",
                body: "We plan to let marina staff scan a boat in their slips and see the owner’s contact details and emergency contact, plus the registration and insurance documents the owner chooses to share. Owners will add their marina with a code from the marina office. It isn’t available yet.",
                items: ["Planned: owner and emergency contact on a scan", "Planned: registration and insurance documents, if the owner shares them", "Available now: a Trusted Contact link with your contact details"],
              },
              {
                badge: "General Public",
                badgeClass: "bg-[var(--gray-bg)] text-[var(--gray-fg)]",
                title: "Admirers welcome",
                body: "Vessel specs — make, model, year, type. Nothing private. The digital equivalent of reading the name on the transom.",
                items: ["Make, model, year, vessel type", "No personal data exposed", "Clean, beautiful profile page"],
              },
              {
                // Replaces Coast Guard, which was never built. Trusted Contact is
                // the share flow's own term, and it ships today: owner-chosen
                // fields, an expiry (one-time, 24h, 7d or none), revocable.
                badge: "Trusted Contact",
                badgeClass: "bg-[var(--purple-bg)] text-[var(--purple-fg)]",
                title: "The people you let in",
                body: "Your captain, cleaner, caterer, family or guests — each gets a link that shows only what you choose. Change your mind and revoke it, and the link stops working.",
                items: ["You pick what each person sees", "Expire it, or make it one-time", "Revoke any link instantly"],
              },
            ].map((card) => (
              <div
                key={card.badge}
                className="relative overflow-hidden bg-[rgba(255,255,255,0.03)] p-10 transition hover:bg-[rgba(255,255,255,0.06)] md:p-12"
              >
                <span
                  className={`mb-5 inline-flex items-center rounded-full px-3 py-1 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.16em] ${card.badgeClass}`}
                >
                  {card.badge}
                </span>
                <h3 className="mb-4 font-[family-name:var(--font-display)] text-[26px] font-light leading-tight text-white">
                  {card.title}
                </h3>
                <p className="mb-7 text-[14px] leading-relaxed text-[rgba(255,255,255,0.5)]">{card.body}</p>
                <ul className="list-none space-y-2">
                  {card.items.map((li, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-3 border-b border-[rgba(255,255,255,0.06)] py-2 text-[13px] leading-snug text-[rgba(255,255,255,0.6)] last:border-0"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--gold)]" />
                      {li}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="profile" className="bg-[var(--cream2)] px-6 py-[100px] md:px-12">
        <div className="mx-auto grid max-w-[1160px] items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <ScanDemo />

          <div>
            <p className="mb-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold-deep)]">
              <span className="h-px w-6 bg-[var(--gold)]" />
              The vessel profile
            </p>
            <h2 className="mb-6 font-[family-name:var(--font-display)] text-[clamp(32px,4.5vw,52px)] font-light leading-tight text-[var(--navy)]">
              What people see
              <br />
              when they <em className="text-[var(--gold-deep)] not-italic">scan.</em>
            </h2>
            <p className="mb-9 text-[15px] font-light leading-relaxed text-[var(--text2)]">
              The mobile vessel profile is the #1 user-facing touchpoint. Clean, fast, and role-gated — it shows exactly
              the right information to the right person.
            </p>
            <div className="mb-9 divide-y divide-[var(--divider)] border-y border-[var(--divider)]">
              {[
                {
                  t: "Owner — full control",
                  d: "Read/write access to every field. Insurance, registration, maintenance — always current.",
                  tone: "bg-[var(--green-bg)] text-[var(--green-fg)]",
                },
                {
                  t: "Trusted Contact — what you share",
                  d: "A captain, cleaner or guest sees only what you’ve chosen, through a link you can revoke.",
                  tone: "bg-[var(--purple-bg)] text-[var(--purple-fg)]",
                },
                {
                  t: "Marina — planned",
                  d: "A view for marina staff is planned. Until then, owners share with their marina through a Trusted Contact link.",
                  tone: "bg-[var(--blue-bg)] text-[var(--blue-fg)]",
                },
              ].map((x) => (
                <div key={x.t} className="flex gap-4 py-4">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${x.tone}`}
                  >
                    <svg
                      className="h-[18px] w-[18px]"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium text-[var(--navy)]">{x.t}</div>
                    <div className="text-[13px] font-light leading-relaxed text-[var(--text2)]">{x.d}</div>
                  </div>
                </div>
              ))}
            </div>
            <a
              href={`${APP_ORIGIN}/signup?next=%2Fdashboard`}
              className="inline-flex items-center gap-2.5 bg-[var(--gold)] px-8 py-4 font-[family-name:var(--font-dm)] text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--navy)] no-underline transition hover:bg-[var(--gold-lt)]"
            >
              Create your profile →
            </a>
          </div>
        </div>
      </section>

      <section id="contact" className="bg-[var(--cream)] px-6 py-[100px] md:px-12">
        <div className="mx-auto max-w-[640px] text-center">
          <p className="mb-4 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold-deep)]">Get started</p>
          <h2 className="mb-6 font-[family-name:var(--font-display)] text-[clamp(36px,5vw,56px)] font-light leading-tight text-[var(--navy)]">
            Register today.
            <br />
            <em className="text-[var(--gold-deep)] not-italic">No marina required.</em>
          </h2>
          <p className="mb-9 text-[15px] font-light leading-relaxed text-[var(--text2)]">
            Create an account and register your vessel — wherever it&apos;s docked, trailered, or moored. Your
            sticker ships once registration is complete.
          </p>
          <a
            href={`${APP_ORIGIN}/signup?next=%2Fdashboard`}
            className="inline-flex items-center gap-2.5 bg-[var(--aqua-bright)] px-8 py-4 font-[family-name:var(--font-dm)] text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--navy)] no-underline transition hover:gap-4 hover:bg-[var(--aqua-vapor)]"
          >
            Create your account →
          </a>

          <div className="my-12 h-px bg-[var(--divider)]" />

          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--text3)]">Not ready yet?</p>
          <p className="mb-6 text-[14px] font-light leading-relaxed text-[var(--text2)]">
            Leave your email and we&apos;ll follow up when the time&apos;s right.
          </p>
          <WaitlistForm />
          <div className="mb-9 mt-12 h-px bg-[var(--divider)]" />
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-6 text-left">
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--text3)]">Email</div>
              <a
                className="border-b border-[var(--divider)] text-sm text-[var(--navy)] no-underline transition hover:border-[var(--gold)]"
                href="mailto:info@moxieyachting.com"
              >
                info@moxieyachting.com
              </a>
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--text3)]">Based in</div>
              <div className="text-sm text-[var(--navy)]">Northern California</div>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter isAuthenticated={isAuthenticated} />
    </div>
  );
}
