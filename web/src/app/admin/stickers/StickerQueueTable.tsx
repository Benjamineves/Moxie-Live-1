"use client";

import { useState } from "react";
import { StickerStatusSelect } from "./StickerStatusSelect";
import type { StickerOrderStatus } from "./actions";

export type StickerRow = {
  mxe_id: string;
  vessel_name: string;
  owner_name: string | null;
  owner_email: string | null;
  qr_generated_at: string | null;
  sticker_order_status: string | null;
  mailing_line1: string | null;
  mailing_line2: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
};

/**
 * The whole reason the address is collected — a fulfillment queue that
 * can't tell you where to post the badge isn't one.
 *
 * A missing address is rendered as an explicit gap, not an empty cell:
 * every vessel from this point on collects one at checkout, so a blank
 * here means something needs chasing rather than "not applicable".
 */
function ShipTo({ vessel }: { vessel: StickerRow }) {
  const street = [vessel.mailing_line1, vessel.mailing_line2].filter(Boolean);
  const region = [vessel.mailing_city, [vessel.mailing_state, vessel.mailing_zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  if (street.length === 0 && !region) {
    return (
      <span className="inline-flex rounded-lg bg-[var(--amber-bg)] px-2 py-0.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--amber-fg)]">
        No address on file
      </span>
    );
  }

  return (
    <span className="block whitespace-normal font-[family-name:var(--font-dm)] text-[13px] leading-snug text-[var(--text)]">
      {street.map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
      {region ? <span className="block text-[var(--text2)]">{region}</span> : null}
    </span>
  );
}

const COLUMNS = ["MXE ID", "Vessel", "Owner", "Ship to", "Owner email", "Paid", "Status"];

export function StickerQueueTable({ initialVessels }: { initialVessels: StickerRow[] }) {
  const [vessels, setVessels] = useState(initialVessels);

  const shippedCount = vessels.filter((v) => v.sticker_order_status === "shipped").length;

  function handleStatusChange(mxeId: string, status: StickerOrderStatus) {
    setVessels((prev) => prev.map((v) => (v.mxe_id === mxeId ? { ...v, sticker_order_status: status } : v)));
  }

  function hideShipped() {
    setVessels((prev) => prev.filter((v) => v.sticker_order_status !== "shipped"));
  }

  if (vessels.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-8 text-center">
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">Nothing in the queue.</p>
      </section>
    );
  }

  return (
    <div>
      {shippedCount > 0 ? (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={hideShipped}
            className="rounded-md border border-[var(--divider)] bg-[var(--white)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-xs font-medium text-[var(--text2)] transition hover:bg-[var(--cream2)]"
          >
            Hide shipped ({shippedCount})
          </button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--divider)] bg-[var(--white)]">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--divider)]">
              {COLUMNS.map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text3)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vessels.map((v) => {
              const shipped = v.sticker_order_status === "shipped";
              return (
                <tr
                  key={v.mxe_id}
                  className={`border-b border-[var(--divider)] last:border-0 ${shipped ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                    <span className="inline-flex items-center gap-2">
                      {v.mxe_id}
                      {shipped ? (
                        <span className="inline-flex items-center rounded-full bg-[var(--green-bg)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--green-fg)]">
                          Shipped
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
                    {v.vessel_name}
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
                    {v.owner_name || "—"}
                  </td>
                  <td className="min-w-[180px] px-4 py-3 align-top">
                    <ShipTo vessel={v} />
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                    {v.owner_email || "—"}
                  </td>
                  <td className="px-4 py-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                    {v.qr_generated_at ? new Date(v.qr_generated_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StickerStatusSelect
                      mxeId={v.mxe_id}
                      status={v.sticker_order_status ?? "not_ordered"}
                      onChanged={handleStatusChange}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
