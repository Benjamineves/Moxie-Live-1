import { APP_ORIGIN } from "@/lib/site-domains";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import {
  VESSEL_LIMIT,
  BASIC_DOCUMENT_LIMIT,
  FULL_STORAGE_CAP_BYTES,
  BADGE_FEE_AMOUNT_USD,
  SUBSCRIPTION_AMOUNT_USD,
  TRANSFER_FEE_AMOUNT_USD,
} from "@/lib/tier-config";

const FULL_STORAGE_CAP_MB = FULL_STORAGE_CAP_BYTES / (1024 * 1024);

const WHAT_IT_DOES = [
  {
    title: "Documents, always on hand",
    body: "Registration, insurance, and your boater card live with the vessel, stored once. Pull them up from any phone.",
  },
  {
    title: "Trusted Contact Sharing",
    body: "Selling the boat? Send escrow the whole record. Hiring a cleaner? Give them just the slip number and the lockbox code — nothing else. Every link shows exactly what you choose, and you can revoke it any time.",
  },
  {
    title: "Ownership transfer",
    body: "When you sell, hand the whole record to the buyer — documents, history, identity — instead of them starting over from a blank form.",
  },
  {
    title: "The badge and public profile",
    body: "A weatherproof QR badge on the hull, and a public profile that resolves the moment it's scanned. Permanent, for the life of the boat.",
  },
];

type TierRow = { label: string; basic: string; full: string };

const TIER_ROWS: TierRow[] = [
  { label: "Vessels", basic: `${VESSEL_LIMIT.basic}`, full: `${VESSEL_LIMIT.full}` },
  { label: "Documents per vessel", basic: `${BASIC_DOCUMENT_LIMIT}`, full: `Unlimited†` },
  { label: "Trusted Contact Sharing", basic: "Included", full: "Included" },
  { label: "QR badge & public profile", basic: "Included", full: "Included" },
  { label: "Ownership transfer fee", basic: `$${TRANSFER_FEE_AMOUNT_USD.basic}`, full: `$${TRANSFER_FEE_AMOUNT_USD.full}` },
];

export function MoxiePricing({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <div className="overflow-x-hidden bg-[var(--cream)]">
      <MarketingNav isAuthenticated={isAuthenticated} />

      <section className="relative overflow-hidden bg-[var(--navy)] px-6 pb-20 pt-40 md:px-12 md:pb-24">
        <div className="absolute -right-[10%] -top-[15%] z-[1] h-[clamp(260px,38vw,480px)] w-[clamp(260px,38vw,480px)] rounded-full bg-[radial-gradient(circle,var(--gold)_0%,rgba(201,168,76,.7)_60%,transparent_100%)] opacity-15" />
        <div className="relative z-10 mx-auto max-w-[1160px] text-center">
          <p className="mb-5 flex items-center justify-center gap-3.5 text-[11px] font-normal uppercase tracking-[0.22em] text-[var(--gold)]">
            <span className="inline-block h-px w-8 bg-[var(--gold)]" />
            Pricing
            <span className="inline-block h-px w-8 bg-[var(--gold)]" />
          </p>
          <h1 className="mx-auto mb-7 max-w-[720px] font-[family-name:var(--font-display)] text-[clamp(40px,6.5vw,76px)] font-light leading-[1.05] tracking-tight text-white">
            Simple pricing.
            <br />
            <em className="text-[var(--gold-lt)] not-italic">Permanent identity.</em>
          </h1>
          <p className="mx-auto max-w-[520px] text-[clamp(15px,1.6vw,18px)] font-light leading-relaxed text-[rgba(255,255,255,0.55)]">
            One badge fee to register your boat. One plan to manage it. No hidden tiers, no surprises.
          </p>
        </div>
      </section>

      <section className="bg-[var(--cream)] px-6 py-[100px] md:px-12">
        <div className="mx-auto max-w-[760px] text-center">
          <p className="mb-4 flex items-center justify-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">
            <span className="h-px w-6 bg-[var(--gold)]" />
            What Moxie is
            <span className="h-px w-6 bg-[var(--gold)]" />
          </p>
          <h2 className="mb-7 font-[family-name:var(--font-display)] text-[clamp(32px,4.5vw,52px)] font-light leading-tight text-[var(--navy)]">
            A permanent identity
            <br />
            for your <em className="text-[var(--gold)] not-italic">boat.</em>
          </h2>
          <p className="mb-5 text-[15px] font-light leading-relaxed text-[var(--text2)]">
            Every vessel gets one badge and one MXE ID — assigned once, kept for the life of the hull. It&apos;s not a
            sticker with a phone number on it. It&apos;s a real digital identity: a public profile that resolves the
            instant someone scans it, and an owner&apos;s record that travels with the boat, sale after sale.
          </p>
          <p className="text-[15px] font-light leading-relaxed text-[var(--text2)]">
            The badge buys that identity. The plan buys the active management on top of it — document storage,
            sharing, transfer, editing. They&apos;re billed separately on purpose: even if a subscription lapses, the
            badge and the boat&apos;s public identity keep working. Nothing about who this boat is ever goes dark.
          </p>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[var(--navy)] px-6 py-[100px] md:px-12">
        <div className="absolute -right-[100px] -top-[100px] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(201,168,76,0.06)_0%,transparent_70%)]" />
        <div className="relative z-[2] mx-auto max-w-[1160px]">
          <p className="mb-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">
            <span className="h-px w-6 bg-[var(--gold)]" />
            What&apos;s included
          </p>
          <h2 className="mb-16 font-[family-name:var(--font-display)] text-[clamp(36px,5vw,62px)] font-light leading-[1.05] text-white">
            Real records.
            <br />
            <em className="text-[var(--gold-lt)] not-italic">Real control.</em>
          </h2>
          <div className="grid gap-0.5 bg-[rgba(255,255,255,0.06)] md:grid-cols-2">
            {WHAT_IT_DOES.map((item) => (
              <div
                key={item.title}
                className="relative overflow-hidden bg-[rgba(255,255,255,0.03)] p-10 transition hover:bg-[rgba(255,255,255,0.06)] md:p-12"
              >
                <h3 className="mb-4 font-[family-name:var(--font-display)] text-[24px] font-light leading-tight text-white">
                  {item.title}
                </h3>
                <p className="text-[14px] leading-relaxed text-[rgba(255,255,255,0.55)]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="plans" className="bg-[var(--cream)] px-6 py-[100px] md:px-12">
        <div className="mx-auto max-w-[1160px]">
          <p className="mb-4 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">
            <span className="h-px w-6 bg-[var(--gold)]" />
            Plans
          </p>
          <h2 className="mb-8 font-[family-name:var(--font-display)] text-[clamp(36px,5vw,62px)] font-light leading-[1.05] text-[var(--navy)]">
            Basic or <em className="text-[var(--gold)] not-italic">Full Access.</em>
          </h2>

          <div className="mb-10 flex flex-col gap-2 border-l-2 border-[var(--gold)] bg-[var(--gold-dim)] p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
              <span className="font-semibold">QR badge — ${BADGE_FEE_AMOUNT_USD} one-time, per vessel.</span>{" "}
              Registers the boat and puts a permanent identity on the hull. Paid once, separate from your plan.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--divider)]">
                  <th className="py-4 pr-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
                    &nbsp;
                  </th>
                  <th className="px-4 py-4">
                    <p className="font-[family-name:var(--font-display)] text-2xl italic text-[var(--navy)]">Basic</p>
                    <p className="mt-1 font-[family-name:var(--font-dm)] text-lg font-semibold text-[var(--navy)]">
                      ${SUBSCRIPTION_AMOUNT_USD.basic}
                      <span className="text-xs font-normal text-[var(--text3)]">/yr</span>
                    </p>
                  </th>
                  <th className="border-x border-[var(--gold-line)] bg-[var(--gold-dim)] px-4 py-4">
                    <p className="font-[family-name:var(--font-display)] text-2xl italic text-[var(--navy)]">
                      Full Access
                    </p>
                    <p className="mt-1 font-[family-name:var(--font-dm)] text-lg font-semibold text-[var(--navy)]">
                      ${SUBSCRIPTION_AMOUNT_USD.full}
                      <span className="text-xs font-normal text-[var(--text3)]">/yr</span>
                    </p>
                  </th>
                  <th className="px-4 py-4">
                    <p className="font-[family-name:var(--font-display)] text-2xl italic text-[var(--text3)]">
                      Commercial
                    </p>
                    <p className="mt-1 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text3)]">
                      Coming soon
                    </p>
                  </th>
                </tr>
              </thead>
              <tbody>
                {TIER_ROWS.map((row, i) => (
                  <tr key={row.label} className={i < TIER_ROWS.length - 1 ? "border-b border-[var(--divider)]" : undefined}>
                    <td className="py-4 pr-4 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                      {row.label}
                    </td>
                    <td className="px-4 py-4 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
                      {row.basic}
                    </td>
                    <td className="border-x border-[var(--gold-line)] bg-[var(--gold-dim)] px-4 py-4 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                      {row.full}
                    </td>
                    <td className="px-4 py-4 font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">—</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pr-4 pt-6" />
                  <td className="px-4 pt-6">
                    <a
                      href={`${APP_ORIGIN}/signup?next=%2Fdashboard`}
                      className="inline-flex w-full items-center justify-center gap-2 border border-[var(--navy)] px-5 py-3 font-[family-name:var(--font-dm)] text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--navy)] no-underline transition hover:bg-[var(--navy)] hover:text-[var(--gold)]"
                    >
                      Create your account →
                    </a>
                  </td>
                  <td className="border-x border-[var(--gold-line)] bg-[var(--gold-dim)] px-4 pt-6">
                    <a
                      href={`${APP_ORIGIN}/signup?next=%2Fdashboard`}
                      className="inline-flex w-full items-center justify-center gap-2 bg-[var(--navy)] px-5 py-3 font-[family-name:var(--font-dm)] text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--gold)] no-underline transition hover:bg-[var(--navy2)]"
                    >
                      Create your account →
                    </a>
                  </td>
                  <td className="px-4 pt-6">
                    <a
                      href="mailto:info@moxieyachting.com"
                      className="inline-flex w-full items-center justify-center gap-2 border border-[var(--divider)] px-5 py-3 font-[family-name:var(--font-dm)] text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text3)] no-underline transition hover:border-[var(--gold)] hover:text-[var(--gold)]"
                    >
                      Get in touch →
                    </a>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            † Full&apos;s document storage is capped at {FULL_STORAGE_CAP_MB}MB total across the account, not per
            vessel.
          </p>

          <div className="mt-16 max-w-[640px] rounded-xl border border-[var(--divider)] bg-[var(--white)] p-8">
            <p className="mb-3 inline-flex items-center rounded-full bg-[var(--gray-bg)] px-3 py-1 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.16em] text-[var(--gray-fg)]">
              Coming soon
            </p>
            <h3 className="mb-3 font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
              Commercial / Broker
            </h3>
            <p className="mb-6 text-[14px] font-light leading-relaxed text-[var(--text2)]">
              Built for brokers and dealers managing multiple listings — share a vessel&apos;s full document set with
              a prospective buyer instantly, and manage a fleet of listings from one place. Not yet available — get
              in touch and we&apos;ll follow up when it opens.
            </p>
            <a
              href="mailto:info@moxieyachting.com"
              className="inline-flex items-center gap-2.5 border border-[var(--navy)] px-6 py-3 font-[family-name:var(--font-dm)] text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--navy)] no-underline transition hover:bg-[var(--navy)] hover:text-[var(--gold)]"
            >
              Get in touch →
            </a>
          </div>
        </div>
      </section>

      <MarketingFooter isAuthenticated={isAuthenticated} />
    </div>
  );
}
