"use client";

import { useState } from "react";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage(null);
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string; warning?: string };
      if (!r.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong");
        return;
      }
      setStatus("done");
      setMessage(data.warning ?? "You're on the list.");
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("Network error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="mb-4 flex flex-wrap gap-0 border border-[var(--divider)] bg-[var(--white)] shadow-sm">
      <input
        type="email"
        required
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === "loading" || status === "done"}
        className="min-w-[200px] flex-1 border-none bg-transparent px-5 py-4 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)] outline-none placeholder:text-[var(--text3)] disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className="bg-[var(--navy)] px-7 py-4 font-[family-name:var(--font-dm)] text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--gold)] transition hover:bg-[var(--navy2)] disabled:opacity-60"
      >
        {status === "done" ? "✓ Done" : status === "loading" ? "…" : "Join waitlist"}
      </button>
      {message ? (
        <p className="w-full px-2 py-2 text-center font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
          {message}
        </p>
      ) : null}
      {status === "error" && !message ? (
        <p className="w-full py-2 text-center font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">
          Could not save — try again
        </p>
      ) : null}
    </form>
  );
}
