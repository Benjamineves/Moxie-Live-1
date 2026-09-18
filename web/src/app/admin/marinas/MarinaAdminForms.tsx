"use client";

import { useState, useTransition } from "react";
import { attachMarinaStaff, createMarinaWithCode, detachMarinaStaff, issueMarinaCode } from "./actions";

export type AdminMarina = {
  id: string;
  name: string;
  place: string | null;
  code: string | null;
  vessels: number;
  staff: { id: string; email: string }[];
};

const field =
  "rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-3 font-[family-name:var(--font-dm)] text-base text-[var(--navy)]";
const input = `w-full ${field}`;
const primary =
  "rounded-lg bg-[var(--navy)] px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)] disabled:opacity-60";
const secondary =
  "rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]";
const errorText = "font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]";

/** Name, city, state → marina + code, shown large enough to read out or copy onto a card. */
export function CreateMarinaForm() {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("CA");
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ name: string; code: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <h2 className="font-[family-name:var(--font-dm)] text-base font-semibold text-[var(--navy)]">New marina</h2>
      {made ? (
        <div className="mt-3 rounded-lg bg-[var(--cream2)] p-4 text-center">
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">{made.name} — join code</p>
          <p className="mt-1 select-all font-mono text-4xl font-bold tracking-[0.1em] text-[var(--navy)]">{made.code}</p>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
            Next: attach their staff below once they&apos;ve signed up, and make the poster.
          </p>
          <button type="button" onClick={() => setMade(null)} className={`mt-3 ${secondary}`}>
            Add another marina
          </button>
        </div>
      ) : (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await createMarinaWithCode({ name, city, state });
              if (result.error) return setError(result.error);
              setMade({ name: result.name!, code: result.code! });
              setName("");
              setCity("");
            });
          }}
        >
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Marina name" autoCapitalize="words" required />
          <div className="flex gap-2">
            <input className={`min-w-0 flex-1 ${field}`} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" autoCapitalize="words" />
            <input
              className={`w-20 shrink-0 uppercase ${field}`}
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="ST"
              maxLength={2}
              aria-label="State"
            />
          </div>
          {error ? <p className={errorText}>{error}</p> : null}
          <button type="submit" disabled={pending} className={`w-full ${primary}`}>
            {pending ? "Creating…" : "Create marina and issue code"}
          </button>
        </form>
      )}
    </section>
  );
}

export function MarinaAdminCard({ marina }: { marina: AdminMarina }) {
  const [email, setEmail] = useState("");
  const [confirmReissue, setConfirmReissue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) return setError(result.error);
      after?.();
    });
  }

  return (
    <article className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-dm)] text-base font-semibold text-[var(--navy)]">{marina.name}</p>
          <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            {[marina.place, `${marina.vessels} vessel${marina.vessels === 1 ? "" : "s"} shared`].filter(Boolean).join(" · ")}
          </p>
        </div>
        {marina.code ? (
          <p className="shrink-0 select-all font-mono text-lg font-bold tracking-[0.08em] text-[var(--navy)]">{marina.code}</p>
        ) : null}
      </div>

      <div className="mt-3">
        {!marina.code ? (
          <button type="button" disabled={pending} className={primary} onClick={() => run(() => issueMarinaCode(marina.id, false))}>
            Issue code
          </button>
        ) : confirmReissue ? (
          <div className="rounded-lg border border-[var(--divider)] bg-[var(--cream)] p-3">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
              Issue a new code? {marina.code} and any poster showing it stop working. Boats already shared stay shared.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" className={secondary} onClick={() => setConfirmReissue(false)}>
                Keep {marina.code}
              </button>
              <button
                type="button"
                disabled={pending}
                className={primary}
                onClick={() => run(() => issueMarinaCode(marina.id, true), () => setConfirmReissue(false))}
              >
                Issue new code
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={secondary} onClick={() => setConfirmReissue(true)}>
            Issue a new code…
          </button>
        )}
      </div>

      <div className="mt-4 border-t border-[var(--divider)] pt-3">
        <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">Staff</p>
        {marina.staff.length === 0 ? (
          <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {marina.staff.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">{s.email}</span>
                <button
                  type="button"
                  disabled={pending}
                  className="shrink-0 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)] underline"
                  onClick={() => run(() => detachMarinaStaff(s.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => attachMarinaStaff(marina.id, email), () => setEmail(""));
          }}
        >
          <input
            className={`min-w-0 flex-1 ${field}`}
            type="email"
            inputMode="email"
            autoCapitalize="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Staff email (they sign up first)"
          />
          <button type="submit" disabled={pending || !email.trim()} className={`shrink-0 ${primary}`}>
            Add
          </button>
        </form>
      </div>
      {error ? <p className={`mt-2 ${errorText}`}>{error}</p> : null}
    </article>
  );
}
