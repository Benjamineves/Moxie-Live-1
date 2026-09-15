import type Stripe from "stripe";
import { paidTierFromInvoices } from "./decide.ts";
import type { StripeAccountFacts } from "./types.ts";

/**
 * EVERYTHING THE SCHEDULER ASKS STRIPE. Reads only — this interface has no
 * method that creates, updates, cancels or charges anything, and the
 * scheduler never sees the Stripe client itself.
 *
 * Reads per account: subscriptions.list, invoices.retrieve (the live
 * subscription's latest invoice, plus invoices.listLineItems if its lines
 * don't fit one page), invoices.list (paid invoices since then, for
 * tier_upgrade). Spec §3.1.
 */
export interface StripeReads {
  accountFacts(customerId: string): Promise<StripeAccountFacts>;
}

const LIVE = new Set(["active", "past_due", "trialing"]);

function isMissing(err: unknown): err is { code: string; message: string } {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "resource_missing";
}

export function createStripeReads(stripe: Stripe): StripeReads {
  return {
    async accountFacts(customerId) {
      let subscriptions: Stripe.Subscription[];
      try {
        subscriptions = [];
        for await (const s of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) subscriptions.push(s);
      } catch (err) {
        if (isMissing(err)) return { kind: "customer_missing", detail: err.message };
        throw err;
      }

      const liveSubs = subscriptions.filter((s) => LIVE.has(s.status));
      const summary = subscriptions.map((s) => ({ id: s.id, status: s.status, created: s.created }));
      if (liveSubs.length !== 1) {
        return { kind: "found", subscriptions: summary, live: null, multipleLive: liveSubs.length > 1, paidTier: null, paidTierSource: null };
      }

      const live = liveSubs[0];
      const latestId = typeof live.latest_invoice === "string" ? live.latest_invoice : live.latest_invoice?.id;
      let latestInvoice: Stripe.Invoice | null = null;
      if (latestId) {
        latestInvoice = await stripe.invoices.retrieve(latestId);
        if (latestInvoice.lines?.has_more) {
          const lines: Stripe.InvoiceLineItem[] = [];
          for await (const line of stripe.invoices.listLineItems(latestId, { limit: 100 })) lines.push(line);
          latestInvoice = { ...latestInvoice, lines: { ...latestInvoice.lines, data: lines, has_more: false } };
        }
      }

      const upgradeInvoices: Stripe.Invoice[] = [];
      for await (const inv of stripe.invoices.list({
        customer: customerId,
        status: "paid",
        created: { gte: latestInvoice?.created ?? live.created },
        limit: 100,
      })) {
        if (inv.metadata?.payment_type === "tier_upgrade") upgradeInvoices.push(inv);
      }

      const paid = paidTierFromInvoices({ subscription: live, latestInvoice, upgradeInvoices });
      return {
        kind: "found",
        subscriptions: summary,
        live: { id: live.id, status: live.status },
        multipleLive: false,
        paidTier: paid.tier,
        paidTierSource: paid.source,
      };
    },
  };
}
