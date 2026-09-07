"use client";

import { AddressElement } from "@stripe/react-stripe-js";
import type { StripeElements } from "@stripe/stripe-js";
import { updateVesselOwnerFields } from "@/lib/owner-actions";

/**
 * Badge shipping address, collected at checkout.
 *
 * Shared by both checkout forms on this page — PaymentForm (an existing
 * subscriber adding another vessel) and SignupBundleForm (a brand-new
 * signup, which is the path most first badges actually take). They had
 * near-identical CheckoutInner bodies already; putting this in one place
 * stops a third copy of the same address handling appearing.
 *
 * allowedCountries is US-only, matching the rest of the app's footprint
 * (US_STATES, the CA boater card, CDFW licenses) and the practical reality
 * that a badge is a physical object someone has to post. Widening it is a
 * one-line change here, not a schema one — the columns are plain text.
 */
export function ShippingAddressSection() {
  return (
    <>
      <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        Badge shipping address
      </p>
      <AddressElement options={{ mode: "shipping", allowedCountries: ["US"] }} />
      <p className="mb-6 mt-2 font-[family-name:var(--font-dm)] text-[11px] leading-relaxed text-[var(--text3)]">
        Where the physical badge gets posted. You can change it later from your vessel&apos;s Contact section.
      </p>
    </>
  );
}

/**
 * Reads the entered address, refuses to continue without a complete one,
 * and persists it to the vessel before any charge is made.
 *
 * Order is the point: an owner should never end up having paid for a
 * badge with nowhere recorded to send it. If this returns a message the
 * caller must not call confirmPayment.
 *
 * Returns null on success, or a message to show the owner.
 */
export async function saveShippingAddress(elements: StripeElements, mxeId: string): Promise<string | null> {
  const element = elements.getElement("address");
  if (!element) {
    return "The shipping address form didn't load. Refresh the page and try again.";
  }

  const { complete, value } = await element.getValue();
  if (!complete) {
    return "Add a complete shipping address — this is where your badge gets posted.";
  }

  const address = value.address;
  const result = await updateVesselOwnerFields(mxeId, {
    mailing_line1: address.line1?.trim() || null,
    mailing_line2: address.line2?.trim() || null,
    mailing_city: address.city?.trim() || null,
    mailing_state: address.state?.trim() || null,
    mailing_zip: address.postal_code?.trim() || null,
  });

  return result.error ?? null;
}
