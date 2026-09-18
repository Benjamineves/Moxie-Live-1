import { formatJoinCode } from "@/lib/marina-access";

/**
 * Day one. A marina signs up with zero boats and stays at zero until
 * tenants join — and this is the screen on which a harbormaster decides
 * whether Moxie is worth anything. So it says how boats arrive, gives the
 * code to hand out, and shows what they'll have once one does, rather
 * than an empty list that looks broken.
 */
export function EmptyRoster({ marinaName, code }: { marinaName: string; code: string | null }) {
  const body = "font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]";
  return (
    <div className="mt-5 space-y-4">
      <section className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
        <h2 className="font-[family-name:var(--font-dm)] text-base font-semibold text-[var(--navy)]">Boats arrive when tenants share them</h2>
        <p className={`mt-2 ${body}`}>
          Each tenant adds {marinaName} from their own Moxie account. Nothing appears here until one of them does — this
          is how it starts, not a fault.
        </p>
        {code ? (
          <div className="mt-4 rounded-lg bg-[var(--cream2)] px-4 py-3 text-center">
            <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
              Your marina&apos;s code
            </p>
            <p className="mt-1 font-mono text-3xl font-bold tracking-[0.12em] text-[var(--navy)]">{formatJoinCode(code)}</p>
            <p className={`mt-1 ${body}`}>Tenants enter it at moxieyacht.com/marina/join, or scan the QR on your poster.</p>
          </div>
        ) : (
          <p className={`mt-3 ${body}`}>Your marina&apos;s code hasn&apos;t been issued yet — Moxie will send it with your poster.</p>
        )}
      </section>

      <section className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
        <h2 className="font-[family-name:var(--font-dm)] text-base font-semibold text-[var(--navy)]">What you&apos;ll have</h2>
        <ul className={`mt-2 list-disc space-y-1.5 pl-5 ${body}`}>
          <li>Every shared boat in one list, found by name or slip in a couple of taps.</li>
          <li>Scan a shared boat&apos;s badge, or tap it here, for the owner&apos;s phone and email and an emergency contact.</li>
          <li>Registration and insurance documents, where the owner chose to share them.</li>
          <li>A flag on every boat with no emergency contact or no documents, so you know who to ask.</li>
        </ul>
      </section>

      <section className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
        <h2 className="font-[family-name:var(--font-dm)] text-base font-semibold text-[var(--navy)]">Getting tenants to share</h2>
        <ul className={`mt-2 list-disc space-y-1.5 pl-5 ${body}`}>
          <li>Put the Moxie poster on the office counter — it has your code and a QR code.</li>
          <li>Mention it when tenants renew or check in. It takes them under a minute.</li>
          <li>Tenants choose to share, and can stop at any time. Moxie never contacts them on your behalf.</li>
        </ul>
      </section>
    </div>
  );
}
