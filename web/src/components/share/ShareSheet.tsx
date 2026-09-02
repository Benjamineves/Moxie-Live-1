"use client";

import { useState } from "react";
import { PRESET_FLAGS, type ShareFieldFlags, type SharePreset } from "@/lib/share-filter";

type Mode = "trusted" | "public";
type ExpiryOption = "one_time" | "24h" | "7d" | "none";

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "one_time", label: "One-time" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "none", label: "No expiry" },
];

const PRESET_OPTIONS: { value: Exclude<SharePreset, "custom">; label: string }[] = [
  { value: "escrow", label: "Title & Escrow" },
  { value: "marina", label: "Marina / Dock Staff" },
  { value: "vendor", label: "Cleaner / Caterer" },
];

const VIS_ITEMS: { key: keyof ShareFieldFlags; label: string; sub: string }[] = [
  { key: "location", label: "Location details", sub: "Marina, slip number, address" },
  { key: "contact", label: "Owner contact", sub: "Your name and phone number" },
  { key: "docs", label: "Documents", sub: "Insurance, registration, uploaded files" },
  { key: "ownership", label: "Ownership record", sub: "HIN, registration #, title status" },
  { key: "access", label: "Access & instructions", sub: "Lockbox code, gate code, notes for this contact" },
];

const DEFAULT_FLAGS: ShareFieldFlags = { location: true, contact: true, docs: false, ownership: false, access: false };

export function ShareSheet({
  mxeId,
  vesselName,
}: {
  mxeId: string;
  vesselName: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("trusted");
  const [preset, setPreset] = useState<SharePreset>("custom");
  const [label, setLabel] = useState("");
  const [expiresIn, setExpiresIn] = useState<ExpiryOption>("24h");
  const [flags, setFlags] = useState<ShareFieldFlags>(DEFAULT_FLAGS);
  const [accessNote, setAccessNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const publicUrl =
    typeof window !== "undefined" ? `${window.location.origin}/${encodeURIComponent(mxeId)}` : `moxieyacht.com/${mxeId}`;

  function reset() {
    setMode("trusted");
    setPreset("custom");
    setLabel("");
    setExpiresIn("24h");
    setFlags(DEFAULT_FLAGS);
    setAccessNote("");
    setError(null);
    setGeneratedUrl(null);
    setCopied(false);
  }

  function close() {
    setOpen(false);
    reset();
  }

  function applyPreset(next: Exclude<SharePreset, "custom">) {
    setPreset(next);
    setFlags(PRESET_FLAGS[next]);
  }

  async function onGenerate() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/vessels/${encodeURIComponent(mxeId)}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label || null,
          preset,
          field_flags: flags,
          access_note: flags.access ? accessNote : undefined,
          expires_in: expiresIn,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Could not generate share link.");
      setGeneratedUrl(result.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate share link.");
    } finally {
      setPending(false);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select and copy the link manually.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-5 z-[200] flex items-center gap-2 rounded-full bg-[var(--aqua-bright)] px-5 py-3 font-[family-name:var(--font-dm)] text-xs font-bold uppercase tracking-[0.1em] text-[var(--navy)] shadow-[0_4px_20px_rgba(23,195,178,.4)] transition hover:bg-[var(--aqua-vapor)]"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 stroke-current" fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        Share Profile
      </button>

      {open ? (
        <div className="fixed inset-0 z-[300] bg-[rgba(7,16,32,.75)] backdrop-blur-sm" onClick={close}>
          <div
            className="absolute bottom-0 left-0 right-0 mx-auto max-h-[92vh] max-w-lg overflow-y-auto rounded-t-[20px] bg-[var(--white)] pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-3 h-1 w-9 rounded-full bg-[var(--divider)]" />

            <div className="border-b border-[var(--divider)] px-5 pb-4 pt-4">
              <p className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
                Share <em className="text-[var(--gold)] not-italic">{vesselName}</em>
              </p>
              <p className="mt-1 font-[family-name:var(--font-dm)] text-[13px] font-light text-[var(--text2)]">
                Choose what to share and with whom. You control access — revoke any link instantly.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 border-b border-[var(--divider)] p-4">
              <button
                type="button"
                onClick={() => {
                  setMode("trusted");
                  setGeneratedUrl(null);
                }}
                className={`relative rounded-[10px] border-[1.5px] p-3.5 text-left transition ${
                  mode === "trusted" ? "border-[var(--aqua-bright)] bg-[rgba(23,195,178,.04)]" : "border-[var(--divider)]"
                }`}
              >
                <p className="mb-0.5 font-[family-name:var(--font-dm)] text-xs font-semibold text-[var(--navy)]">
                  Trusted Contact
                </p>
                <p className="font-[family-name:var(--font-dm)] text-[10px] leading-tight text-[var(--text3)]">
                  Share selected details. Unique link, expiry, revokable.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("public");
                  setGeneratedUrl(null);
                }}
                className={`rounded-[10px] border-[1.5px] p-3.5 text-left transition ${
                  mode === "public" ? "border-[var(--aqua-bright)] bg-[rgba(23,195,178,.04)]" : "border-[var(--divider)]"
                }`}
              >
                <p className="mb-0.5 font-[family-name:var(--font-dm)] text-xs font-semibold text-[var(--navy)]">Public Link</p>
                <p className="font-[family-name:var(--font-dm)] text-[10px] leading-tight text-[var(--text3)]">
                  Copy your public profile URL. No login required.
                </p>
              </button>
            </div>

            {mode === "trusted" ? (
              <>
                <div className="border-b border-[var(--divider)] px-5 pb-1 pt-3.5">
                  <label className="mb-2 block font-[family-name:var(--font-dm)] text-[11px] font-medium text-[var(--text2)]">
                    Quick setup for a common vendor{" "}
                    <span className="font-normal text-[var(--text3)]">(optional — sets suggested fields below)</span>
                  </label>
                  <div className="mb-3.5 flex flex-wrap gap-1.5">
                    {PRESET_OPTIONS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => applyPreset(p.value)}
                        className={`rounded-full border px-3 py-1.5 font-[family-name:var(--font-dm)] text-[11px] font-medium transition ${
                          preset === p.value
                            ? "border-[var(--navy)] bg-[var(--navy)] text-[var(--gold)]"
                            : "border-[var(--divider)] text-[var(--text2)] hover:border-[var(--navy)]"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPreset("custom")}
                      className={`rounded-full border px-3 py-1.5 font-[family-name:var(--font-dm)] text-[11px] font-medium transition ${
                        preset === "custom"
                          ? "border-[var(--navy)] bg-[var(--navy)] text-[var(--gold)]"
                          : "border-[var(--divider)] text-[var(--text2)] hover:border-[var(--navy)]"
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                </div>

                <div className="border-b border-[var(--divider)] px-5 py-3.5">
                  <label className="mb-1.5 block font-[family-name:var(--font-dm)] text-[11px] font-medium text-[var(--text2)]">
                    Label this share <span className="font-normal text-[var(--text3)]">(so you remember who it&apos;s for)</span>
                  </label>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Diver — Juan, Catering — Sarah, Captain Mike…"
                    className="w-full border border-[var(--divider)] bg-[var(--cream)] px-3.5 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)] outline-none focus:border-[var(--aqua-bright)]"
                  />
                </div>

                <div className="border-b border-[var(--divider)] px-5 py-3.5">
                  <label className="mb-1.5 block font-[family-name:var(--font-dm)] text-[11px] font-medium text-[var(--text2)]">
                    Link expires
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {EXPIRY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setExpiresIn(opt.value)}
                        className={`rounded-full border px-3.5 py-1.5 font-[family-name:var(--font-dm)] text-[11px] font-medium transition ${
                          expiresIn === opt.value
                            ? "border-[var(--navy)] bg-[var(--navy)] text-[var(--gold)]"
                            : "border-[var(--divider)] bg-[var(--cream)] text-[var(--text2)] hover:border-[var(--navy)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-b border-[var(--divider)] px-5 py-4">
                  <p className="mb-2.5 flex items-center gap-2 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--text3)]">
                    What they&apos;ll see
                  </p>

                  <div className="flex items-center justify-between border-b border-[var(--divider)] py-2.5">
                    <div>
                      <p className="font-[family-name:var(--font-dm)] text-[13px] font-medium text-[var(--navy)]">Vessel specs</p>
                      <p className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">Make, model, year, length, type</p>
                    </div>
                    <span className="font-[family-name:var(--font-dm)] text-[10px] uppercase tracking-[0.08em] text-[var(--text3)]">Always</span>
                  </div>

                  {VIS_ITEMS.map((item) => (
                    <div key={item.key} className="flex items-center justify-between border-b border-[var(--divider)] py-2.5 last:border-0">
                      <div>
                        <p className="font-[family-name:var(--font-dm)] text-[13px] font-medium text-[var(--navy)]">{item.label}</p>
                        <p className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">{item.sub}</p>
                      </div>
                      <label className="relative inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center">
                        <input
                          type="checkbox"
                          checked={flags[item.key]}
                          onChange={(e) => {
                            setPreset("custom");
                            setFlags((p) => ({ ...p, [item.key]: e.target.checked }));
                          }}
                          className="peer sr-only"
                        />
                        <span className="absolute inset-0 rounded-full bg-[#d1d1d6] transition peer-checked:bg-[var(--aqua-bright)]" />
                        <span className="absolute left-[3px] h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-[18px]" />
                      </label>
                    </div>
                  ))}
                </div>

                {flags.access ? (
                  <div className="px-5 pt-4">
                    <textarea
                      value={accessNote}
                      onChange={(e) => setAccessNote(e.target.value)}
                      placeholder="e.g. Lockbox code: 4471 · Dock gate code: #2298 · Boat is second cleat on the left, cover strap is on the bow rail"
                      className="min-h-16 w-full resize-y border border-[var(--divider)] bg-[var(--cream)] px-3.5 py-2.5 font-[family-name:var(--font-dm)] text-[13px] leading-relaxed text-[var(--navy)] outline-none focus:border-[var(--amber-fg)]"
                    />
                    <p className="mt-1.5 font-[family-name:var(--font-dm)] text-[10px] leading-relaxed text-[var(--text3)]">
                      Visible only to this contact, only while the link is active. Not stored as part of the vessel&apos;s
                      permanent record.
                    </p>
                  </div>
                ) : null}

                <div className="px-5 pt-3.5">
                  <div className="border-l-2 border-[var(--aqua-bright)] bg-[rgba(23,195,178,.06)] p-3.5 font-[family-name:var(--font-dm)] text-xs leading-relaxed text-[var(--text2)]">
                    <strong className="text-[var(--navy)]">They won&apos;t see:</strong> emergency contacts, billing info, or
                    anything you haven&apos;t toggled on. You can revoke this link at any time from your Shares dashboard.
                  </div>
                </div>

                {generatedUrl ? (
                  <div className="mx-5 mt-4 border border-[rgba(8,80,65,.2)] bg-[var(--green-bg)] p-4">
                    <p className="mb-2 font-[family-name:var(--font-dm)] text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--green-fg)]">
                      Share link ready
                    </p>
                    <p className="mb-2.5 break-all border border-[rgba(8,80,65,.15)] bg-[var(--white)] px-3 py-2.5 font-mono text-xs text-[var(--navy)]">
                      {generatedUrl}
                    </p>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(generatedUrl)}
                      className="w-full bg-[var(--green-fg)] py-2.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-white"
                    >
                      {copied ? "Copied!" : "Copy link"}
                    </button>
                  </div>
                ) : null}

                {error ? (
                  <p className="px-5 pt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p>
                ) : null}

                <div className="flex flex-col gap-2.5 px-5 pt-4">
                  {generatedUrl ? (
                    <button
                      type="button"
                      onClick={close}
                      className="w-full border border-[var(--divider)] bg-[var(--cream)] py-3 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text2)]"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onGenerate}
                      disabled={pending}
                      className="w-full bg-[var(--navy)] py-3.5 font-[family-name:var(--font-dm)] text-xs font-bold uppercase tracking-[0.14em] text-[var(--gold)] transition hover:bg-[var(--navy2)] disabled:opacity-50"
                    >
                      {pending ? "Generating…" : "Generate share link"}
                    </button>
                  )}
                </div>
              </>
            ) : null}

            {mode === "public" ? (
              <div className="px-5 pt-5">
                <p className="mb-4 font-[family-name:var(--font-dm)] text-sm font-light leading-relaxed text-[var(--text2)]">
                  This is your public profile — anyone with the link can view your vessel&apos;s basic information. No
                  account required.
                </p>
                <p className="mb-3.5 break-all border border-[var(--divider)] bg-[var(--cream)] px-3.5 py-3 font-mono text-[13px] text-[var(--navy)]">
                  {publicUrl}
                </p>
                <div className="flex flex-col gap-2.5">
                  <button
                    type="button"
                    onClick={() => copyToClipboard(publicUrl)}
                    className="w-full bg-[var(--navy)] py-3.5 font-[family-name:var(--font-dm)] text-xs font-bold uppercase tracking-[0.14em] text-[var(--gold)] transition hover:bg-[var(--navy2)]"
                  >
                    {copied ? "Copied!" : "Copy public link"}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="w-full border border-[var(--divider)] bg-[var(--cream)] py-3 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text2)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
