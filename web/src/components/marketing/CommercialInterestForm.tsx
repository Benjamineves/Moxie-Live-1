"use client";

import { useActionState } from "react";
import { submitCommercialInterest, type InterestState } from "@/lib/commercial-interest-actions";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS } from "@/lib/commercial-interest";

/**
 * Interest capture for the commercial/broker tier, in place of the mailto:
 * button that was there before — which asked someone to write an email
 * themselves, and recorded nothing when they didn't.
 *
 * Two fields, one of them optional. Every field costs signups, and the only
 * thing actually needed is a way to reach them when the tier opens.
 *
 * The page says what signing up means before the button, not after.
 */
export function CommercialInterestForm({ sourcePage = "/pricing" }: { sourcePage?: string }) {
  const [state, action, pending] = useActionState<InterestState, FormData>(submitCommercialInterest, { status: "idle" });

  if (state.status === "done") {
    return (
      <div className="rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] p-5">
        <p className="font-[family-name:var(--font-dm)] text-[15px] font-semibold text-[var(--navy)]">
          You&rsquo;re on the list.
        </p>
        <p className="mt-1 font-[family-name:var(--font-dm)] text-[14px] font-light leading-relaxed text-[var(--text2)]">
          We&rsquo;ll email you when the commercial tier opens. Nothing else — no newsletter, and we won&rsquo;t pass
          your address on.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
      <input type="hidden" name="source_page" value={sourcePage} />
      {/* Honeypot: off-screen, unfocusable, and unlabelled for people. */}
      <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="company_website">Company website</label>
        <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <label
        htmlFor="commercial-email"
        className="block font-[family-name:var(--font-dm)] text-[13px] font-medium text-[var(--navy)]"
      >
        Email
      </label>
      <input
        id="commercial-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        inputMode="email"
        defaultValue={state.status === "error" ? state.email : ""}
        placeholder="you@yourbrokerage.com"
        className="mt-1.5 w-full rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-3 font-[family-name:var(--font-dm)] text-[15px] text-[var(--navy)]"
      />

      <label
        htmlFor="commercial-type"
        className="mt-4 block font-[family-name:var(--font-dm)] text-[13px] font-medium text-[var(--navy)]"
      >
        What&rsquo;s your business? <span className="font-normal text-[var(--text3)]">Optional</span>
      </label>
      <select
        id="commercial-type"
        name="business_type"
        defaultValue=""
        className="mt-1.5 w-full rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-3 font-[family-name:var(--font-dm)] text-[15px] text-[var(--navy)]"
      >
        <option value="">Rather not say</option>
        {BUSINESS_TYPES.map((t) => (
          <option key={t} value={t}>
            {BUSINESS_TYPE_LABELS[t]}
          </option>
        ))}
      </select>

      <p className="mt-4 font-[family-name:var(--font-dm)] text-[13px] font-light leading-relaxed text-[var(--text2)]">
        We&rsquo;ll email you once, when the commercial tier is available. That&rsquo;s all this is for.
      </p>

      {state.status === "error" ? (
        <p role="alert" className="mt-3 font-[family-name:var(--font-dm)] text-[14px] text-[var(--red-fg)]">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex w-full items-center justify-center border border-[var(--navy)] bg-[var(--navy)] px-6 py-3 font-[family-name:var(--font-dm)] text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--gold)] disabled:opacity-60"
      >
        {pending ? "Adding you…" : "Tell me when it opens"}
      </button>
    </form>
  );
}
