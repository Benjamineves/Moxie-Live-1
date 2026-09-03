# Moxie Digital — Broker Role & Listing Records
### Design spec · not yet built

**Status:** Concept worked through, not specced to build-ready. Several open questions at the end need answers before Code touches this.
**Related:** `moxie_transaction_workflow_brief.docx` (escrow/title wedge), `moxie_digital_share_profile.md` (Trusted Contact Sharing — the delegated-access pattern this builds on), the ownership transfer feature (already built).
**Currently advertised as:** "Commercial / Broker — coming soon" on `/pricing`, with a `mailto:` inquiry button. There is a soft public commitment attached to this.

---

## 1. The central principle

**A vessel record always belongs to the boat's owner. Brokers get delegated access, never ownership.**

This is the thing that makes everything else fall out cleanly, and it's why the broker offering is *not* simply a third tier with a higher vessel cap.

A broker doesn't own the boats they list. Treating a broker account as "an account that holds 30 vessels" creates a data-ownership problem the moment anything changes:

| Situation | Under "broker owns the record" | Under delegated access |
|---|---|---|
| Listing expires unsold | Broker holds a record for a boat owned by someone else | Access lapses, seller keeps their record |
| Seller switches brokers | Ambiguous — who has the record? | Revoke one, grant another |
| Boat sells | Broker has to hand off something they own | Normal ownership transfer, seller → buyer |
| Boat already has a Moxie badge | Broker can't register it — conflict | Nothing special; seller grants access |

Delegated access resolves all four with one rule.

**This maps onto machinery that already exists.** Trusted Contact Sharing is scoped, revocable, delegated access to a vessel the sharer owns. A broker is essentially a persistent, higher-privilege version of that same pattern. Build on it rather than inventing a parallel system.

---

## 2. Two different objects: BXE and MXE

The insight that makes the unpaid-listing problem tractable is that **a listing and a vessel identity are different things**.

- **MXE ID** — the vessel. Permanent, tied to the hull, survives ownership changes, never reused. Bought once with the badge fee.
- **BXE ID** — the *listing/transaction*. Created by a broker, belongs to the brokerage workflow, exists to hold the paperwork of a sale in progress.

Format mirrors MXE deliberately so it's instantly legible: `BXE-01001`. Seeing a BXE prefix tells you immediately this is a broker listing record, not a vessel identity.

**A BXE record can exist in two relationships:**

1. **Standalone** — the boat has no Moxie identity yet. The BXE record holds vessel details and closing documents through the sale, then converts (see §4).
2. **Referencing an existing MXE** — the boat already has a Moxie identity. No new identity is created; the BXE record represents *this sale* of that vessel, and the broker works through delegated access to the owner's MXE record.

This also means a vessel can accumulate multiple BXE records over its life — one per brokered sale. That is a genuinely valuable artifact for the escrow/title wedge: a transaction history distinct from the ownership record.

---

## 3. Why a listing record exists at all

The problem it solves: **the seller is the least motivated party in the transaction.**

A seller who has already decided to sell is the hardest person to sell a subscription to. They are leaving the boat behind; a product about maintaining a permanent record is of no use to them. Pushing a badge fee or subscription at that moment is friction at the exact point of maximum reluctance.

The buyer is the opposite — acquiring, needs the documents, forming a relationship with the boat.

So: **don't sell to the seller.** The broker creates a listing record at no cost and with no seller decision required. It holds the closing paperwork during the sale. The purchase decision lands on the buyer, who wants it.

What this buys each party:
- **Broker** — a real, free tool that reduces paperwork on every listing. This is the actual pitch.
- **Seller** — no decision, no cost, no friction.
- **Buyer** — a vessel record already assembled, handed over at the moment they most want it.
- **Moxie** — a vessel registration and a warm, motivated new account.

**A broker fronting the badge fee to win a listing is still supported** — some will. That's a different payment path to the same outcome, not a different design.

---

## 4. Conversion: BXE → MXE

When a brokered sale closes on a standalone BXE record:

1. Buyer creates (or signs into) a Moxie account.
2. Buyer pays the badge fee — this is the moment a real MXE identity is minted.
3. Vessel details and transferable documents move from the BXE record to the new MXE record, following the **same vessel-intrinsic vs. owner-specific split already defined for ownership transfer**. Do not invent a second mapping.
4. The BXE record persists, closed, as the transaction artifact.
5. Buyer chooses a subscription (or doesn't — see open questions).

When the sale closes on a BXE that references an existing MXE, this is just the **existing ownership transfer flow**, with the broker facilitating and the BXE record closing out alongside it. No new mechanism.

---

## 5. Broker access mechanics

- A broker requests access to a vessel; the **owner grants it**. Access is scoped, time-bound where appropriate, and revocable by the owner at any time.
- Broker access should be a distinct, higher-privilege grant than a Trusted Contact share (a broker needs to upload and organize documents, not just view), but built on the same underlying delegation model.
- Vessels accessed via delegation **do not count against the broker's vessel cap** — the broker doesn't own them. This is why the cap conversation mostly evaporates for this role.
- Standalone BXE listing records are a separate count from delegated MXE access; both may need their own limits.
- Every grant, revocation, and document action by a broker should be auditable — this is a professional context with real money and real liability.

---

## 6. Pricing shape

**Seat-based, not per-vessel.** A broker pays for the role; they aren't penalized for having a large book. Simpler to explain, and aligns incentives — you *want* brokers registering more listings.

**Price it aggressively.** The revenue model makes this clear: at $59–149/year, brokers as subscription revenue barely register. As distribution, they're transformative — every listing becomes a vessel whose next owner inherits a Moxie profile they didn't create. **You are buying vessel registrations, not ARR.** Price accordingly and don't over-engineer qualification.

Actual number: undecided. Should be informed by a conversation with a working broker, not guessed.

---

## 7. Strategic context

**On the competitive question** (does Moxie eventually compete with brokers?):

What Moxie owns is the *record*, not the transaction. A broker's moat is relationships, pricing knowledge, sea trials, negotiation, closing coordination — none of which a document vault threatens. Classifieds and brokerage are genuinely different businesses; high-value boats are hard to sell and will continue to need brokers.

The real risk is **perception, not substance**. Precedent: Zillow began as data-and-listings partnered with agents, later moved into iBuying and agent services, and lost agent trust — not because it became a better broker, but because the *transition* broke the relationship. The lesson isn't "never add a for-sale feature." It's that drifting into it accidentally is what costs you. If that move is ever made, make it deliberately.

**The aligned path is escrow and title**, per the transaction workflow brief. Escrow serves brokered transactions — leaning there makes brokers' lives easier rather than threatening them, which is the right posture while brokers are a distribution channel. Escrow and title should be well developed as a revenue stream long before any move toward a sales platform.

---

## 8. Open questions — answer before building

1. **Does a broker need a Moxie-verified license?** Ben holds a CA Yacht Salesperson license and knows the space. Is broker status self-declared, or verified? Verification adds friction to a channel we want frictionless; no verification means anyone can claim the role.
2. **What are the limits on a free BXE listing record?** Unpaid records cost storage and admin surface. Cap per broker? Expire after N months unsold? Currently unbounded, which won't hold.
3. **What happens to a BXE record that never sells?** Broker keeps it? Expires? Converts to nothing?
4. **Does the buyer have to subscribe at conversion, or only pay the badge fee?** §3 argues the buyer is motivated — but "motivated" may only extend to the one-time fee. Decide whether a subscription is required, offered, or optional at that moment.
5. **Can a broker create a BXE record without any seller involvement at all?** §3 implies yes (that's the friction removal). Confirm — and decide what the seller can do if they later object to a listing record existing for their boat.
6. **BXE numbering** — separate sequence from MXE, presumably starting at a similar offset. Confirm whether BXE IDs should also reserve a low block.
7. **Does a broker seat include a normal owner account?** Many brokers own boats personally.
8. **Multi-agent brokerages** — is a seat per agent, or per brokerage with sub-accounts? Affects the pricing model materially.

---

## 9. What not to build yet

This spec is a design direction, not a build order. The delegated-access model and the BXE/MXE split are settled enough to design against; nothing in §8 is. In particular, do not build broker license verification, multi-agent brokerage structures, or any pricing enforcement until those questions are answered.
