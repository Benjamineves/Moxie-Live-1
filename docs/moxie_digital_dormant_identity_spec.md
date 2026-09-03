# Moxie Digital — Dormant Vessel Identity
### Build spec · unifies lapsed subscriptions, downgrade overflow, and decommissioned vessels

**Status:** Designed, not built.
**Replaces:** the separately-deferred "lapsed subscription QR resolution" item, which turned out to be one case of a broader concept.
**Touches:** existing decommission rendering (already built), tier limits, `/dashboard/upgrade`, the public `[mxeId]` page.

---

## 1. The principle

**The badge fee buys permanent identity. The subscription buys active management.**

These are cleanly separable, and separating them explicitly resolves several questions that have been handled ad hoc:

- A one-time badge fee ($29) permanently assigns an MXE ID to a hull. That ID is never reused, never revoked, and its public page always resolves.
- An annual subscription ($59 Basic / $149 Full) covers document storage, sharing, transfer, editing — the ongoing management layer.

An owner who stops paying doesn't lose the boat's identity. They lose the management layer. The badge on the hull keeps working, at a reduced level, forever.

**Why this matters commercially:** it makes the badge fee honest (you're buying permanent identity, not a sticker), it means a lapsed customer's badge is still a live billboard for Moxie rather than a dead link, and it creates an organic acquisition path — a seller can tell a buyer *"this boat is already registered with Moxie, just reactivate it under your own subscription."* That pitch happens at the exact moment a new owner is most receptive, delivered by someone who already used the product.

---

## 2. Three states, one concept

Three separate situations all produce the same underlying condition — *the vessel has permanent identity but is not actively managed*:

| State | Cause | Reversible by |
|---|---|---|
| **Lapsed** | Subscription expired, canceled, or payment failed | Owner resubscribing |
| **Locked (downgrade overflow)** | Account downgraded to Basic; this vessel is beyond the 2-vessel cap | Owner upgrading, or freeing a slot |
| **Decommissioned** | Owner requested archive; admin approved (already built) | Admin reactivation |

These should share **one dormant-state concept and one public rendering**, not three parallel implementations that drift apart as each gets patched separately. The decommissioned case already has a public "no longer active" page — that page is the seed of this, but its copy and behavior should be revisited per §4 rather than the other two cases being built to imitate it.

**Implementation note:** the three causes stay distinct in the data (they have different reversal paths and different admin semantics), but they resolve to a single computed `is_dormant` condition that the public page and any tier-gated feature check. Don't collapse the causes; do unify the effect.

---

## 3. What a dormant vessel keeps vs. loses

**Always retained, permanently, regardless of state:**
- MXE ID and its permanent uniqueness
- Public profile resolving at `moxieyacht.com/MXE-XXXXX`
- Core vessel identity: name, make, model, year, primary photo
- Ownership history record

**Suspended while dormant (locked, never deleted):**
- Document storage access (files stay in Storage, owner can't open or add)
- Trusted Contact Sharing (existing active shares revoked; no new ones)
- Vessel editing
- Ownership transfer initiation

**The lock-don't-delete principle is absolute here.** It's already established for Basic document limits and for tier changes at ownership transfer. Someone's registration PDF must not disappear because a card expired. Locked data is visible-but-unopenable, with a clear path to restore access.

---

## 4. The public page for a dormant vessel

Currently the decommissioned page renders a neutral "this vessel is no longer active" message. That's fine as a status, but it wastes the acquisition opportunity described in §1.

**The dormant public page should be an invitation, not an epitaph.** Someone scanning that badge is holding a physical object attached to a real boat — they are, almost by definition, either the owner or a prospective owner. The page should:

- Show the retained identity fields (§3) so the scan is still informative
- State plainly that the vessel has a Moxie identity that isn't currently active
- Offer a clear next step: **claim or reactivate this vessel**
- Never expose owner contact, documents, or anything in the suspended list

**Copy should differ by cause**, even though the layout is shared — "no longer active" is right for a decommissioned vessel, but wrong for one that's simply between subscriptions. Don't write one generic message for all three.

**Do not** expose *why* a vessel is dormant to the public (lapsed payment is the owner's business). The distinction above is about tone and next-step, not about disclosing account status.

---

## 5. Downgrade flow (Full → Basic)

**Timing:** takes effect at **end of the paid period**, not immediately. The customer paid for Full through a date; they keep Full through that date. This avoids proration/refund math entirely and matches standard SaaS practice.

**Vessel overflow — the grace window:**

When the downgrade lands and the account holds more vessels than Basic allows (2):

1. **Nothing locks immediately.** All vessels stay fully accessible.
2. The owner is prompted to choose which 2 remain active.
3. They have a **14-day grace window** to choose.
4. If they don't choose, the system falls back to keeping the **2 most recently active** vessels and locking the rest.

**Rationale for choosing at period end rather than at downgrade time:** asking someone in month 2 which vessels they want in month 12 is asking them to predict the future — they may own different boats by then. The grace window means nobody is stranded by inaction and nobody is forced to guess.

**Document overflow:** same principle. If they hold more documents than Basic allows (3, boater card exempt), excess documents lock rather than delete, with the owner able to choose which stay accessible under the same grace window.

**Storage overflow:** an account over Basic's needs after downgrade keeps its files; uploads are blocked until they're back under limit. Never auto-delete.

---

## 6. Reactivation paths

Each dormant cause has a distinct restore path — all should be frictionless, since every one of them is a revenue event:

- **Lapsed** → owner resubscribes; all vessels restore to their tier's limits.
- **Locked** → owner upgrades to Full (restores all), or actively swaps which vessels occupy their 2 Basic slots.
- **Decommissioned** → admin reactivation (already built, keeps the cap check).
- **New owner claiming a dormant vessel** → this is the acquisition path from §1. A scanned dormant badge should let a prospective owner start a claim. **Design consideration:** this must not become a way to hijack an active vessel — claiming should only be available on genuinely dormant vessels, and should likely route through admin verification or the existing ownership-transfer flow rather than being fully self-serve. Flag for careful design; do not build a self-serve claim without a verification path.

---

## 7. Open questions for build time

1. **How is "lapsed" detected?** Stripe's webhook already syncs `subscription_status`; the dunning sequence (`past_due` → `canceled`) needs a defined point at which dormancy begins. A grace period after first payment failure is standard — decide the length.
2. **Where does the dormant check sit** in `[mxeId]/page.tsx` relative to the existing `lifecycle_status` (decommissioned) and `qr_status` (pending payment) gates? Order matters; a pending-payment vessel is not dormant, it's unborn.
3. **Does a dormant vessel count against the cap?** It shouldn't — a locked vessel already isn't consuming an active slot, and a decommissioned one explicitly doesn't. Confirm this composes with the existing `qr_status = 'active'` and `lifecycle_status = 'active'` filters rather than adding a third parallel condition.
4. **Notification.** With no email infrastructure, lapse and grace-window warnings can only be in-app banners. That's weak for someone who's stopped logging in — which is exactly the population that lapses. Worth revisiting whether transactional email becomes necessary here, since this is the first feature where in-app-only notification has a real cost.
