"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { shareVesselWithMarina } from "@/lib/marina-actions";
import { marinaSharingSummary } from "@/lib/marina-copy";

export type JoinVessel = {
  mxeId: string;
  name: string;
  eligible: boolean;
  hasRegistration: boolean;
  hasInsurance: boolean;
  existing: { share_registration: boolean; share_insurance: boolean } | null;
};

const body = "font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]";
const small = "font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]";

export function ShareWithMarinaForm({
  joinCode,
  marinaName,
  vessels,
}: {
  joinCode: string;
  marinaName: string;
  vessels: JoinVessel[];
}) {
  return (
    <div className="space-y-4">
      {vessels.map((v) => (
        <VesselCard key={v.mxeId} joinCode={joinCode} marinaName={marinaName} vessel={v} />
      ))}
    </div>
  );
}

function DocChoice({
  label,
  onFile,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  onFile: boolean;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-[var(--navy)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">Include my {label} document</span>
        {/* The owner sees "none on file" before the harbormaster does. */}
        <span className={`block ${small}`}>
          {onFile ? "On file." : `You haven't uploaded one — the marina will see "No ${label} document on file".`}
        </span>
      </span>
    </label>
  );
}

function VesselCard({ joinCode, marinaName, vessel }: { joinCode: string; marinaName: string; vessel: JoinVessel }) {
  const [reg, setReg] = useState(vessel.existing?.share_registration ?? vessel.hasRegistration);
  const [ins, setIns] = useState(vessel.existing?.share_insurance ?? vessel.hasInsurance);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<"created" | "updated" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const profileHref = `/${encodeURIComponent(vessel.mxeId)}?role=owner`;

  if (done) {
    return (
      <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
        <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
          {done === "created" ? `${vessel.name} is shared with ${marinaName}.` : `Updated what ${marinaName} sees for ${vessel.name}.`}
        </p>
        <p className={`mt-1 ${body}`}>
          You can change or remove this at any time from{" "}
          <Link href={profileHref} className="text-[var(--gold-deep)] underline underline-offset-2">
            {vessel.name}&apos;s page
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <p className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">{vessel.mxeId}</p>
      <p className="font-[family-name:var(--font-display)] text-xl font-light text-[var(--navy)]">{vessel.name}</p>
      {vessel.existing ? <p className={`mt-1 ${small}`}>Already shared with {marinaName}. Change the documents below.</p> : null}

      {!vessel.eligible ? (
        <p className={`mt-3 ${body}`}>
          This vessel isn&apos;t active, so it can&apos;t be shared right now.
        </p>
      ) : (
        <>
          <div className="mt-4 space-y-3">
            <DocChoice label="registration" onFile={vessel.hasRegistration} checked={reg} onChange={setReg} disabled={pending || confirming} />
            <DocChoice label="insurance" onFile={vessel.hasInsurance} checked={ins} onChange={setIns} disabled={pending || confirming} />
          </div>

          {confirming ? (
            <div className="mt-4 rounded-lg border border-[var(--gold-line)] bg-[var(--gold-dim)] p-4">
              <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
                {marinaSharingSummary(marinaName, vessel.name, reg, ins)}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
                <li>This access doesn&apos;t expire.</li>
                <li>You can remove it at any time from {vessel.name}&apos;s page.</li>
                <li>{marinaName} isn&apos;t notified — not now, and not if you remove it.</li>
              </ul>
              {error ? <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
              <div className="mt-4 flex gap-2.5">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border border-[var(--divider)] bg-[var(--white)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError(null);
                      const result = await shareVesselWithMarina(joinCode, vessel.mxeId, reg, ins);
                      if (result.error) {
                        setError(result.error);
                        return;
                      }
                      setDone(result.created ? "created" : "updated");
                    })
                  }
                  className="flex-1 rounded-lg bg-[var(--navy)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold leading-snug text-[var(--gold)]"
                >
                  {pending ? "Sharing…" : `Confirm — share with ${marinaName}`}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              // Sentence case, wrapping: marina and vessel names are long and
              // an uppercase tracked label overflowed at phone width.
              className="mt-4 w-full rounded-lg bg-[var(--navy)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-semibold leading-snug text-[var(--gold)]"
            >
              {vessel.existing ? "Update what they see" : `Share ${vessel.name} with ${marinaName}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
