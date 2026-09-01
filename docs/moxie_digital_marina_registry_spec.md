# Moxie Digital — Marina Registry
### Future-build spec · not yet implemented

**Status:** Planned, not built. Parked here so the thinking is ready when we pick it up.
**Prerequisite context:** The `/admin` overview dashboard already does *region-level* geographic tracking (SF Bay / Central Coast / SoCal / Unclassified) from free-text city/state. This spec is the follow-on that adds *marina-level* precision.
**Why it's deferred, not skipped:** Region tracking works today with zero data changes. Marina-level precision needs a structured registry + a registration form change, and is far cheaper to build before a large pile of free-text marina entries accumulates than to retrofit after. Build this before pushing hard on marina partnerships.

---

## 1. The core reframe: this is a CRM seed, not a dropdown

The obvious version of this feature is "make the marina field a pick-list so vessel counts group cleanly." That's the mechanical benefit, and it's real — free text means "Emery Cove", "Emery Cove Marina", and "emery cove, emeryville" register as three different marinas each with one boat, which quietly destroys the single most valuable metric (concentration at a named marina).

But the strategic value is bigger than clean grouping. Every marina catalogued with a website, phone, and eventually a contact name becomes a **relationship record**. The accumulating vessel count against each marina is the *reason to make the call* — "I have 28 of your ~300 slips already registered, let's talk about the rest." That pitch only works if the count is a real, defensible number tied to a real, contactable marina.

So the registry should be built as a lightweight CRM of marinas from the start, not a static reference list. Ben's firsthand knowledge of California marinas (especially SF Bay) is the actual moat here — anyone can scrape a list; almost no one knows which harbormaster is receptive. Capturing that relationship intelligence is the point.

---

## 2. Marina record — proposed fields

Each marina is an admin-maintained profile, editable over time (marinas get renamed, change management, occasionally close — this is not fixed reference data):

| Field | Purpose | Notes |
|---|---|---|
| `id` | Stable internal ID | What vessels reference — never changes even if the name does |
| `name` | Display name | e.g. "Emery Cove Marina" |
| `address` | Physical location | Street / city / state — enables accurate mapping |
| `city`, `state` | Normalized location | Structured, not free text — feeds the region rollups cleanly |
| `region` | Which target region it belongs to | SF Bay / Central Coast / SoCal / etc. — assigned by admin, removes the free-text guessing |
| `latitude`, `longitude` | Precise map placement | Optional but enables a true marina-level heat map later |
| `website` | Marina's site | Relationship/reference |
| `phone` | Marina office / harbormaster line | Relationship |
| `slip_count_estimate` | Approx. total slips | The denominator for "X of Y slips" pitches — Ben's estimate is fine |
| `contact_name` | Key person | e.g. "Diane (harbormaster)" |
| `contact_notes` | Ben's relationship intelligence | Freeform — who's receptive, pilot-worthy, history. **This is the moat field.** |
| `status` | e.g. prospect / in-conversation / partner / closed | Lightweight pipeline tracking |
| `created_at`, `updated_at` | Bookkeeping | |

**Privacy note:** `contact_name`, `contact_notes`, `phone`, and `status` are **internal admin-only** — they must never render on a public vessel profile or leak through any owner-facing surface. Only `name` (and possibly `city/state`) should ever be publicly visible as a vessel's location. Keep the CRM fields strictly behind the `requireAdmin()` gate.

---

## 3. Registration form change

Change the marina field at vessel registration from free text to a **searchable pick-list**:

- Owner starts typing ("Emer…"), sees matching marinas from the registry, picks the real one.
- Stores the marina's stable `id`, not a typed string.
- **Critical escape hatch:** if the owner's marina isn't in the registry yet, they must be able to enter it manually rather than being blocked. Blocking signups over a missing marina is a worse outcome than slightly messy data.
- Manually-entered marinas flow into an **admin verification queue** — candidate marinas for Ben to confirm (address, website, phone) and formally add to the registry. Usefully, this queue doubles as a growth signal: it shows exactly which marinas Moxie's adoption is pulling toward next, i.e. where to focus outreach.

Keep the existing non-marina storage types (mooring / trailer / home / boatyard) working exactly as they do now — this change only affects the "marina / slip" path.

---

## 4. Admin surfaces (extends the existing `/admin` area)

- **Marina registry manager** — CRUD for marina records (add / edit / retire), admin-gated. Editable over time per the "not fixed reference data" point above.
- **Marina verification queue** — the manually-entered candidates awaiting confirmation, same pattern as the existing sticker / correction-request queues.
- **Marina-level view on the geographic dashboard** — once vessels reference stable marina IDs, the overview can show a ranked list of marinas by registered-vessel count, and (with lat/long) a true marina-level map. This is what makes the "% of a marina's slips" number real. Pair each marina's registered count against its `slip_count_estimate` to show penetration (e.g. "28 / ~300").

---

## 5. Migration consideration for existing free-text entries

By the time this is built, there will be some existing vessels with free-text marina names. Plan a one-time reconciliation pass: surface the distinct free-text marina strings, let admin map each to a registry marina (or create one), and backfill the stable IDs. The earlier this is built, the smaller that pile — another reason not to defer indefinitely.

---

## 6. Open questions for when we build

1. **Region assignment authority** — regions should be assigned per-marina by admin in the registry (removing free-text guessing entirely for marina-based vessels), while non-marina vessels still fall back to city/state normalization. Confirm that split when building.
2. **Marina boundaries are a judgment call** — is Monterey "Bay Area" or "Central Coast"? Is Santa Cruz its own thing? Ben's local knowledge decides these, not a default. Worth finalizing the region taxonomy at build time.
3. **Slip-count source** — Ben's estimates are fine to start; no need to source official numbers. Flag the field as an estimate in the UI so the penetration % is understood as approximate.
