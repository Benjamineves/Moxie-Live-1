"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PixelM } from "@/components/PixelM";
import type { VesselPreview } from "@/types/vessel";

const REDIRECT_MS = 2400;

type Props = { mxeId: string };

type PreviewResponse = VesselPreview | { status: "pending_payment" | "decommissioned"; mxe_id: string };

function previewStatus(data: PreviewResponse): "pending_payment" | "decommissioned" | null {
  if ("status" in data && (data.status === "pending_payment" || data.status === "decommissioned")) {
    return data.status;
  }
  return null;
}

export function ScanSuccess({ mxeId }: Props) {
  const router = useRouter();
  const [preview, setPreview] = useState<VesselPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [decommissioned, setDecommissioned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/vessels/${encodeURIComponent(mxeId)}/preview`);
        if (!r.ok) return;
        const data = (await r.json()) as PreviewResponse;
        if (cancelled) return;
        const status = previewStatus(data);
        if (status === "pending_payment") {
          setPending(true);
        } else if (status === "decommissioned") {
          setDecommissioned(true);
        } else {
          setPreview(data as VesselPreview);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mxeId]);

  useEffect(() => {
    // Neither a not-yet-active nor a decommissioned vessel has anywhere
    // useful to redirect to — the destination would just show the same
    // terminal state.
    if (pending || decommissioned) return;
    const t = window.setTimeout(() => {
      router.replace(`/${encodeURIComponent(mxeId)}?role=public`);
    }, REDIRECT_MS);
    return () => window.clearTimeout(t);
  }, [mxeId, router, pending, decommissioned]);

  if (pending) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--navy-deep)] px-6 text-center">
        <PixelM size={56} />
        <p className="mt-3 font-[family-name:var(--font-display)] text-2xl font-light italic text-white">
          Not yet active
        </p>
        <p className="max-w-xs font-[family-name:var(--font-dm)] text-sm text-[#6b8299]">
          {`${mxeId} hasn't completed registration yet — there's no profile to show.`}
        </p>
      </div>
    );
  }

  if (decommissioned) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--navy-deep)] px-6 text-center">
        <PixelM size={56} />
        <p className="mt-3 font-[family-name:var(--font-display)] text-2xl font-light italic text-white">
          No longer active
        </p>
        <p className="max-w-xs font-[family-name:var(--font-dm)] text-sm text-[#6b8299]">
          {`${mxeId} is no longer part of Moxie's active fleet.`}
        </p>
      </div>
    );
  }

  const displayName = preview?.vessel_name ?? "…";

  const ringDelays = ["0.1s", "0.3s", "0.5s", "0.7s", "0.9s"];
  const ringSizes = [120, 240, 400, 600, 900];
  const ringColors = [
    undefined,
    undefined,
    undefined,
    "rgba(23,195,178,0.3)",
    "rgba(23,195,178,0.1)",
  ];

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[var(--navy-deep)]">
      <div className="pointer-events-none scan-glow absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(23,195,178,.18)_0%,rgba(19,241,209,.06)_30%,transparent_70%)]" />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {ringSizes.map((w, i) => (
          <div
            key={w}
            className="scan-ring absolute rounded-full border border-[#17C3B2] opacity-0"
            style={{
              width: w,
              height: w,
              animationDelay: ringDelays[i],
              borderColor: ringColors[i] ?? "#17C3B2",
            }}
          />
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center gap-2 px-6 text-center">
        <div className="scan-mark relative mb-7">
          <PixelM size={64} />
          <span className="scan-signal absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-[#17C3B2]" />
        </div>

        <div className="scan-check flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(23,195,178,.12)]">
          <svg
            className="h-6 w-6 text-[#17C3B2]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <p className="mt-3 font-[family-name:var(--font-dm)] text-sm font-medium tracking-wide text-[#dfc06a]">
          Verified vessel
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-white md:text-4xl">
          {displayName}
        </h1>
        <p className="font-[family-name:var(--font-dm)] text-sm text-[#6b8299]">Opening profile…</p>

        <div className="mx-auto mt-10 h-0.5 w-48 overflow-hidden rounded-full bg-[rgba(255,255,255,.08)]">
          <div className="scan-load-inner h-full w-full bg-[#17C3B2]" />
        </div>
      </div>
    </div>
  );
}
