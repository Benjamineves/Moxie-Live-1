"use client";

import { useEffect, useRef, useState } from "react";
import { ScanSuccess } from "@/components/ScanSuccess";
import { APP_ORIGIN } from "@/lib/site-domains";

/**
 * The phone on the marketing home, showing what a scan actually does.
 *
 * The section is headed "What people see when they scan" and used to show
 * only the end state — a static card. The scan moment is the thing worth
 * showing, so this plays the REAL ScanSuccess component inside the phone
 * and then resolves into the profile, on a loop.
 *
 * Reusing ScanSuccess rather than reimplementing it is the point: a
 * hand-drawn imitation would drift the first time the real animation
 * changed, and the homepage would then be advertising something the
 * product no longer does. ScanSuccess gained exactly two optional props
 * for this (onSettled, fill); its real behaviour is untouched.
 *
 * POLARIS IS A REAL VESSEL — MXE-01016, registered and active, with the
 * owner's own photo. The old mockup invented "Discovery One", a 2023
 * Nimbus T8 at "Portobello Marina", none of which existed. The CTA is a
 * real link to the real public profile, so the homepage is a working demo
 * rather than a picture of one.
 *
 * REDUCED MOTION: no loop, no animation — the profile renders directly and
 * stays. A looping animation is exactly what that preference is about.
 *
 * OFF-SCREEN: the loop stops when the section is not visible, so a page
 * left open in a tab is not re-running an animation and re-fetching the
 * vessel preview every few seconds.
 */

export const DEMO_VESSEL = {
  mxeId: "MXE-01016",
  name: "Polaris",
  make: "Beneteau",
  model: "Oceanis 30.1",
  year: 2021,
  lengthFt: 31,
  type: "Sailboat",
  marina: "Marina Plaza Harbor",
  location: "Sausalito, CA",
  photo:
    "https://imhoeviehenluccjgnru.supabase.co/storage/v1/object/public/vessel-photos/2255a040-7300-407c-bc31-7fb35b383d14/MXE-01016/photo?v=mtnuzbac",
} as const;

/** How long the resolved profile holds before the scan replays. */
const PROFILE_MS = 5200;

export function ScanDemo() {
  const [phase, setPhase] = useState<"scan" | "profile">("profile");
  const [animate, setAnimate] = useState(false);
  const [cycle, setCycle] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(false);

  // Motion preference first: if it is set, nothing below ever starts.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setAnimate(!query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!animate || !host) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting) setPhase("scan");
      },
      { threshold: 0.35 },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [animate]);

  useEffect(() => {
    if (!animate || phase !== "profile") return;
    const t = window.setTimeout(() => {
      if (!visibleRef.current) return;
      setCycle((c) => c + 1);
      setPhase("scan");
    }, PROFILE_MS);
    return () => window.clearTimeout(t);
  }, [animate, phase, cycle]);

  return (
    <div ref={hostRef} className="mx-auto w-[320px] shrink-0">
      <div className="overflow-hidden rounded-[40px] border-8 border-[var(--navy2)] bg-[var(--navy)] shadow-[0_32px_80px_rgba(13,31,53,0.35)]">
        <div className="mx-auto h-[22px] w-24 rounded-b-[14px] bg-[var(--navy2)]" />
        <div className="h-[520px] overflow-hidden bg-[var(--white)]">
          {animate && phase === "scan" ? (
            // key: remounting is what restarts the CSS animations, and is
            // also why the loop pauses off-screen — one preview fetch per
            // visible cycle rather than one every few seconds forever.
            <ScanSuccess
              key={cycle}
              mxeId={DEMO_VESSEL.mxeId}
              destinationRole="public"
              exitHref={APP_ORIGIN}
              fill
              onSettled={() => setPhase("profile")}
            />
          ) : (
            <DemoProfile />
          )}
        </div>
      </div>
    </div>
  );
}

const specLabel = "font-[family-name:var(--font-dm)] text-[11px] uppercase tracking-[0.1em] text-[var(--text3)]";
const specValue = "font-[family-name:var(--font-dm)] text-[13px] font-semibold text-[var(--navy)]";

/**
 * The resolved profile. Every size here is 11px or larger — the old
 * mockup had six values at 7–9px, flagged in the contrast sweep as
 * unreadable for reasons no colour could fix. Fewer fields, bigger.
 *
 * Name and subtitle are stacked in normal flow inside the photo's
 * gradient footer rather than absolutely positioned. The old pair
 * collided: a 22px name at bottom-[18px] occupied 18–40px while the
 * subtitle sat at bottom-8 (32px).
 */
function DemoProfile() {
  return (
    <div className="flex h-full flex-col">
      <div className="relative h-[200px] shrink-0 overflow-hidden bg-[var(--navy)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={DEMO_VESSEL.photo}
          alt={`${DEMO_VESSEL.name}, a ${DEMO_VESSEL.year} ${DEMO_VESSEL.make} ${DEMO_VESSEL.model}`}
          width={320}
          height={200}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
        <span className="absolute left-4 top-3 font-[family-name:var(--font-display)] text-sm italic text-[var(--gold)] drop-shadow">
          Moxie
        </span>
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-[rgba(7,16,32,0.92)] to-transparent px-4 pb-3 pt-10">
          <p className="font-[family-name:var(--font-display)] text-[22px] font-light italic leading-tight text-white">
            {DEMO_VESSEL.name}
          </p>
          <p className="font-[family-name:var(--font-dm)] text-[11px] uppercase tracking-[0.12em] text-[rgba(255,255,255,0.72)]">
            {DEMO_VESSEL.year} {DEMO_VESSEL.make} · {DEMO_VESSEL.type}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {[
            ["Model", DEMO_VESSEL.model],
            ["Year", String(DEMO_VESSEL.year)],
            ["Length", `${DEMO_VESSEL.lengthFt} ft`],
            ["Type", DEMO_VESSEL.type],
          ].map(([k, v]) => (
            <div key={k}>
              <div className={`mb-0.5 ${specLabel}`}>{k}</div>
              <div className={specValue}>{v}</div>
            </div>
          ))}
        </div>

        <div className="my-4 h-px bg-[var(--divider)]" />

        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--gold-dim)]">
            <svg className="h-4 w-4 stroke-[var(--gold-deep)]" viewBox="0 0 24 24" fill="none" strokeWidth={1.5}>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="truncate font-[family-name:var(--font-dm)] text-[13px] font-semibold text-[var(--navy)]">
              {DEMO_VESSEL.marina}
            </div>
            <div className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
              Home marina · {DEMO_VESSEL.location}
            </div>
          </div>
        </div>

        <div className="mt-auto pt-4 text-center">
          {/*
            A real link to a real profile, so the homepage demonstrates the
            product rather than depicting it. Absolute to APP_ORIGIN: this
            page renders on the marketing domain, where a relative /MXE-…
            would be redirected rather than resolved.
          */}
          <a
            href={`${APP_ORIGIN}/${DEMO_VESSEL.mxeId}`}
            className="font-[family-name:var(--font-dm)] text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--gold-deep)] underline underline-offset-4"
          >
            {DEMO_VESSEL.mxeId} — see it live
          </a>
        </div>
      </div>
    </div>
  );
}
