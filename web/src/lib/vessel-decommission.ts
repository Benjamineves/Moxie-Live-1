export type DecommissionReason =
  | "wrong_vessel"
  | "duplicate"
  | "sale_fell_through"
  | "sold_outside_moxie"
  | "destroyed_scrapped"
  | "other";

export const DECOMMISSION_REASONS: DecommissionReason[] = [
  "wrong_vessel",
  "duplicate",
  "sale_fell_through",
  "sold_outside_moxie",
  "destroyed_scrapped",
  "other",
];

export const DECOMMISSION_REASON_LABELS: Record<DecommissionReason, string> = {
  wrong_vessel: "Wrong vessel registered",
  duplicate: "Duplicate registration",
  sale_fell_through: "Sale fell through",
  sold_outside_moxie: "Vessel sold outside Moxie",
  destroyed_scrapped: "Vessel destroyed or scrapped",
  other: "Other",
};

export function isDecommissionReason(value: string): value is DecommissionReason {
  return (DECOMMISSION_REASONS as string[]).includes(value);
}
