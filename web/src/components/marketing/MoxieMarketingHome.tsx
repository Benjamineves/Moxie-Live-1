import Link from "next/link";
import { PixelM } from "@/components/PixelM";
import { WaitlistForm } from "@/components/marketing/WaitlistForm";

function NavPixelM({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="25" height="10" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="0" y="0" width="10" height="25" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="75" y="0" width="25" height="10" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="90" y="0" width="10" height="25" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="0" y="90" width="25" height="10" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="0" y="75" width="10" height="25" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="15" y="25" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="45" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="55" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="65" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="75" width="10" height="10" fill="#c9a84c" />
      <rect x="25" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="35" y="45" width="10" height="10" fill="#c9a84c" />
      <rect x="45" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="55" y="45" width="10" height="10" fill="#c9a84c" />
      <rect x="65" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="25" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="45" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="55" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="65" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="75" width="10" height="10" fill="#c9a84c" />
      <rect x="85" y="85" width="8" height="8" fill="#17C3B2" />
    </svg>
  );
}

/** Marketing homepage — structure & content from `Guide2/moxie_homepage_v2.html` (technical spec). */
export function MoxieMarketingHome({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <div className="overflow-x-hidden bg-[var(--cream)]">
      <nav className="fixed left-0 right-0 top-0 z-[100] flex items-center justify-between border-b border-[var(--divider)] bg-[rgba(245,242,236,0.92)] px-6 py-5 backdrop-blur-md md:px-12">
        <Link href="/" className="flex items-center gap-3 no-underline">
          <NavPixelM className="h-7 w-7 shrink-0" />
          <span className="font-[family-name:var(--font-display)] text-[22px] font-normal italic leading-none tracking-wide text-[var(--navy)]">
            <span className="text-[var(--gold)]">M</span>oxie
          </span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          <a
            href="#qr-hero"
            className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
          >
            The QR
          </a>
          <a
            href="#how"
            className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
          >
            How it works
          </a>
          <a
            href="#who"
            className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
          >
            Who it&apos;s for
          </a>
          <a
            href="#contact"
            className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
          >
            Contact
          </a>
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              className="border border-[var(--navy)] bg-[var(--navy)] px-5 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--gold)] no-underline transition hover:border-[var(--gold)] hover:bg-[var(--gold)] hover:!text-[var(--navy)]"
            >
              Dashboard
            </Link>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
              >
                Log in
              </Link>
              <Link
                href="/signup?next=%2Fdashboard"
                className="border border-[var(--navy)] bg-[var(--navy)] px-5 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--gold)] no-underline transition hover:border-[var(--gold)] hover:bg-[var(--gold)] hover:!text-[var(--navy)]"
              >
                Sign up
              </Link>
            </div>
          )}
        </div>
      </nav>

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
            A weatherproof QR sticker on the hull. A persistent digital profile for every vessel. What people see
            depends on who they are.
          </p>
          <div className="flex flex-wrap items-center gap-3.5">
            <Link
              href="/signup?next=%2Fdashboard"
              className="inline-flex items-center gap-2.5 bg-[var(--aqua-bright)] px-8 py-4 font-[family-name:var(--font-dm)] text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--navy)] no-underline transition hover:gap-4 hover:bg-[var(--aqua-vapor)]"
            >
              Create your account →
            </Link>
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
            "Role-gated access",
            "Weatherproof vinyl QR",
            "Free for boat owners",
            "Emergency data for Coast Guard",
            "Marina operator tools",
          ]
            .concat([
              "Your boat's digital home",
              "Role-gated access",
              "Weatherproof vinyl QR",
              "Free for boat owners",
              "Emergency data for Coast Guard",
              "Marina operator tools",
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
              The QR sticker
            </p>
            <h2 className="mb-7 font-[family-name:var(--font-display)] text-[clamp(36px,5vw,62px)] font-light leading-[1.05] text-white">
              One sticker.
              <br />
              Every <span className="italic text-[var(--aqua-bright)]">identity.</span>
            </h2>
            <p className="mb-10 max-w-[480px] text-[15px] font-light leading-relaxed text-[rgba(255,255,255,0.55)]">
              A single weatherproof vinyl QR sticker goes on the stern, dock box, or companionway. Anyone with a phone
              can scan it. What they see depends on who they are — your personal information is never exposed to the
              public.
            </p>
            <Link
              href="/signup?next=%2Fdashboard"
              className="inline-flex items-center gap-2.5 bg-[var(--aqua-bright)] px-8 py-4 font-[family-name:var(--font-dm)] text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--navy)] no-underline transition hover:bg-[var(--aqua-vapor)]"
            >
              Register your vessel →
            </Link>
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
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="bg-[var(--cream)] px-6 py-[100px] md:px-12">
        <div className="mx-auto max-w-[1160px]">
          <p className="mb-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">
            <span className="h-px w-6 bg-[var(--gold)]" />
            How it works
          </p>
          <h2 className="mb-[72px] font-[family-name:var(--font-display)] text-[clamp(36px,5vw,62px)] font-light leading-[1.05] text-[var(--navy)]">
            Three steps.
            <br />
            <em className="text-[var(--gold)] not-italic">Always working.</em>
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
                body: "A marina operator sees emergency contacts. The Coast Guard sees registration. The public sees vessel specs. The owner sees everything — and can edit.",
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
                  "Edit from any phone — no app needed",
                ],
              },
              {
                badge: "Marina Operator",
                badgeClass: "bg-[var(--blue-bg)] text-[var(--blue-fg)]",
                title: "Every slip, verified",
                body: "Emergency contacts, insurance verification, and vessel data — accessible by scanning the QR on the dock box or hull.",
                items: ["Emergency contact access in seconds", "Insurance verification on demand", "Slip occupancy management"],
              },
              {
                badge: "General Public",
                badgeClass: "bg-[var(--gray-bg)] text-[var(--gray-fg)]",
                title: "Admirers welcome",
                body: "Vessel specs — make, model, year, type. Nothing private. The digital equivalent of reading the name on the transom.",
                items: ["Make, model, year, vessel type", "No personal data exposed", "Clean, beautiful profile page"],
              },
              {
                badge: "Coast Guard",
                badgeClass: "bg-[var(--red-bg)] text-[var(--red-fg)]",
                title: "Boarding inspections in seconds",
                body: "Registration number, expiry, HIN, and insurance — everything needed for a boarding inspection, instantly.",
                items: ["Registration & HIN verification", "Insurance status & expiry", "Emergency & safety data"],
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
                  {card.items.map((li) => (
                    <li
                      key={li}
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
          <div className="mx-auto w-[280px] shrink-0 overflow-hidden rounded-[36px] border-8 border-[var(--navy2)] bg-[var(--navy)] shadow-[0_32px_80px_rgba(13,31,53,0.35)]">
            <div className="mx-auto h-[22px] w-20 rounded-b-[14px] bg-[var(--navy2)]" />
            <div className="relative h-[180px] overflow-hidden bg-gradient-to-br from-[var(--navy)] via-[var(--navy2)] to-[var(--navy3)]">
              <span className="absolute left-[18px] top-3.5 font-[family-name:var(--font-display)] text-xs italic text-[var(--gold)]">
                <span className="text-[var(--gold)]">M</span>oxie
              </span>
              <div className="absolute bottom-[18px] left-[18px] z-[1] font-[family-name:var(--font-display)] text-[22px] font-light italic text-white">
                Discovery One
              </div>
              <div className="absolute bottom-8 left-[18px] z-[1] text-[9px] uppercase tracking-[0.12em] text-[rgba(255,255,255,0.5)]">
                2023 Nimbus T8 · Power
              </div>
            </div>
            <div className="bg-[var(--white)] px-[18px] pb-6 pt-4">
              <div className="mb-4 grid grid-cols-3 gap-2.5">
                {[
                  ["Make", "Nimbus"],
                  ["Year", "2023"],
                  ["Length", "26'"],
                  ["Type", "Power"],
                  ["Model", "T8"],
                  ["HIN", "···1234"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="mb-0.5 text-[7px] uppercase tracking-[0.1em] text-[var(--text3)]">{k}</div>
                    <div className="text-xs font-semibold text-[var(--navy)]">{v}</div>
                  </div>
                ))}
              </div>
              <div className="my-3.5 h-px bg-[var(--divider)]" />
              <div className="mb-4 flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--gold-dim)]">
                  <svg className="h-3.5 w-3.5 stroke-[var(--gold)]" viewBox="0 0 24 24" fill="none" strokeWidth={1.5}>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                  </svg>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-[var(--navy)]">Portobello Marina</div>
                  <div className="text-[8px] uppercase tracking-[0.08em] text-[var(--text3)]">
                    Home marina · Oakland, CA
                  </div>
                </div>
              </div>
              <div className="text-center">
                <div className="mx-auto inline-grid grid-cols-7 gap-px bg-[var(--navy)] p-2">
                  {Array.from({ length: 49 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-[7px] w-[7px] rounded-[0.5px] ${i === 48 ? "bg-[var(--aqua-bright)]" : [0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 31, 32, 33, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47].includes(i) ? "bg-[var(--gold)]" : "bg-[rgba(255,255,255,0.06)]"}`}
                    />
                  ))}
                </div>
                <p className="mt-2 font-[family-name:var(--font-dm)] text-[7px] font-medium uppercase tracking-[0.16em] text-[var(--text3)]">
                  Scan or tap to verify
                </p>
              </div>
            </div>
          </div>
          <div>
            <p className="mb-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">
              <span className="h-px w-6 bg-[var(--gold)]" />
              The vessel profile
            </p>
            <h2 className="mb-6 font-[family-name:var(--font-display)] text-[clamp(32px,4.5vw,52px)] font-light leading-tight text-[var(--navy)]">
              What people see
              <br />
              when they <em className="text-[var(--gold)] not-italic">scan.</em>
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
                  t: "Marina — emergency & insurance",
                  d: "Reach any boat owner in seconds. No more paper chase.",
                  tone: "bg-[var(--blue-bg)] text-[var(--blue-fg)]",
                },
                {
                  t: "Coast Guard — full verification",
                  d: "Registration, HIN, expiry, and insurance — boarding inspections in seconds.",
                  tone: "bg-[var(--red-bg)] text-[var(--red-fg)]",
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
            <Link
              href="/signup?next=%2Fdashboard"
              className="inline-flex items-center gap-2.5 bg-[var(--gold)] px-8 py-4 font-[family-name:var(--font-dm)] text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--navy)] no-underline transition hover:bg-[var(--gold-lt)]"
            >
              Create your profile →
            </Link>
          </div>
        </div>
      </section>

      <section id="contact" className="bg-[var(--cream)] px-6 py-[100px] md:px-12">
        <div className="mx-auto max-w-[640px] text-center">
          <p className="mb-4 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">Get started</p>
          <h2 className="mb-6 font-[family-name:var(--font-display)] text-[clamp(36px,5vw,56px)] font-light leading-tight text-[var(--navy)]">
            Register today.
            <br />
            <em className="text-[var(--gold)] not-italic">No marina required.</em>
          </h2>
          <p className="mb-9 text-[15px] font-light leading-relaxed text-[var(--text2)]">
            Create an account and register your vessel — wherever it&apos;s docked, trailered, or moored. Your
            sticker ships once registration is complete.
          </p>
          <Link
            href="/signup?next=%2Fdashboard"
            className="inline-flex items-center gap-2.5 bg-[var(--aqua-bright)] px-8 py-4 font-[family-name:var(--font-dm)] text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--navy)] no-underline transition hover:gap-4 hover:bg-[var(--aqua-vapor)]"
          >
            Create your account →
          </Link>

          <div className="my-12 h-px bg-[var(--divider)]" />

          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--text3)]">Not ready yet?</p>
          <p className="mb-6 text-[14px] font-light leading-relaxed text-[var(--text2)]">
            Leave your email and we&apos;ll follow up when the time&apos;s right.
          </p>
          <WaitlistForm />
          <p className="mb-12 text-[12px] text-[var(--text3)]">
            Free for boat owners · No spam · Unsubscribe anytime
          </p>
          <div className="mb-9 h-px bg-[var(--divider)]" />
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-6 text-left">
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--text3)]">Contact</div>
              <div className="text-sm text-[var(--navy)]">Ben Eves</div>
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--text3)]">Email</div>
              <a
                className="border-b border-[var(--divider)] text-sm text-[var(--navy)] no-underline transition hover:border-[var(--gold)]"
                href="mailto:ben@moxieyachting.com"
              >
                ben@moxieyachting.com
              </a>
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--text3)]">Phone</div>
              <a
                className="border-b border-[var(--divider)] text-sm text-[var(--navy)] no-underline transition hover:border-[var(--gold)]"
                href="tel:+13124650672"
              >
                312-465-0672
              </a>
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-[var(--text3)]">Based in</div>
              <div className="text-sm text-[var(--navy)]">Northern California</div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[rgba(201,168,76,0.15)] bg-[var(--navy-deep)] px-12 py-12 text-center">
        <div className="mb-5 flex items-center justify-center gap-3">
          <PixelM size={20} />
          <span className="font-[family-name:var(--font-display)] text-lg italic text-white">
            <span className="text-[var(--gold)]">M</span>oxie
          </span>
          <span className="inline-block h-2 w-2 bg-[var(--aqua-bright)]" aria-hidden />
        </div>
        <p className="text-[11px] leading-relaxed text-[rgba(255,255,255,0.35)]">
          Ben Eves · CA Yacht Salesperson Lic. S-1-4046-0001 · © 2026 Moxie Marine Technology · moxieyachting.com
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4 font-[family-name:var(--font-dm)] text-[11px] text-[rgba(255,255,255,0.45)]">
          {isAuthenticated ? (
            <Link className="text-[var(--gold)] no-underline hover:underline" href="/dashboard">
              Dashboard
            </Link>
          ) : (
            <>
              <Link className="text-[var(--gold)] no-underline hover:underline" href="/login">
                Log in
              </Link>
              <span aria-hidden>·</span>
              <Link className="text-[var(--gold)] no-underline hover:underline" href="/signup?next=%2Fdashboard">
                Sign up
              </Link>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
