import type { StepName } from "./config.ts";
import type { SubscriptionTier } from "../tier-config.ts";

/** A users row as the scheduler reads it. Columns added by 20261004 are null before it runs. */
export type AccountRow = {
  id: string;
  email: string | null;
  role: string | null;
  subscription_status: string | null;
  subscription_tier: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  past_due_since: string | null;
  downgrade_grace_until: string | null;
  no_plan_since: string | null;
  expiry_reminders_opt_out_at: string | null;
};

/** A vessel with qr_status = 'active' AND lifecycle_status = 'active' — the set every cap check counts. */
export type ActiveVesselRow = {
  id: string;
  owner_id: string;
  mxe_id: string | null;
  vessel_name: string | null;
  updated_at: string;
  reg_expiry: string | null;
  ins_expiry: string | null;
  fishing_license_expiry: string | null;
  fishing_license_lifetime: boolean | null;
};

/**
 * What Stripe says about one customer, reduced to what the tier step decides
 * on. Built by stripe-reads.ts from reads only.
 */
export type StripeAccountFacts =
  | { kind: "customer_missing"; detail: string }
  | {
      kind: "found";
      /** Every subscription on the customer, any status. */
      subscriptions: { id: string; status: string; created: number }[];
      /** The live subscription (active, past_due, trialing), if exactly one. */
      live: { id: string; status: string } | null;
      /** More than one live subscription — an anomaly, not something to pick between. */
      multipleLive: boolean;
      /** The tier the account has PAID for, or null if nothing paid decides it. */
      paidTier: SubscriptionTier | null;
      /** Which invoice decided paidTier, for the event detail. */
      paidTierSource: string | null;
    };

/** The account as the next step should see it: stored values, with corrections that would apply this run. */
export type EffectiveState = {
  status: string;
  tier: SubscriptionTier;
  /** Active vessel ids, most recently updated first (the order apply_overflow_fallback ranks by). */
  activeVesselIds: string[];
};

export type FindingKind = "changed" | "would_change" | "exempt" | "skipped" | "failed" | "anomaly";

export type Finding = {
  step: StepName | "run";
  kind: FindingKind;
  /** Stable across runs for the same finding — the two-run rule compares these. */
  signature: string | null;
  vesselId?: string | null;
  detail: Record<string, unknown>;
  /** The account would lose access (lapse, downgrade, lock). Feeds the breaker. */
  removesAccess?: boolean;
  /** Vessels this would pause. Feeds the breaker. */
  pausesVessels?: number;
  /** A reminder email this would send. Feeds the breaker. */
  sendsReminder?: boolean;
};

export type StepResult = {
  findings: Finding[];
  next: EffectiveState;
  /** Later steps for this account must not run: this step couldn't establish the state they read. */
  stop?: string;
};
