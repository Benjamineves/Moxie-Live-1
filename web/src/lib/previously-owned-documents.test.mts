import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decidePreviouslyOwnedDocument,
  previouslyOwnedDocumentHref,
} from "./previously-owned-documents.ts";

const SELLER = "seller-uid";
const transfer = (over: Partial<Parameters<typeof decidePreviouslyOwnedDocument>[0] & object> = {}) => ({
  seller_id: SELLER,
  status: "completed",
  vessel_snapshot: {
    doc_registration_url: "seller-uid/MXE-01020/registration.pdf",
    doc_insurance_url: "seller-uid/MXE-01020/insurance.pdf",
    doc_boater_card_url: null,
  } as Record<string, unknown>,
  ...over,
});

test("the seller gets the snapshot's path", () => {
  assert.deepEqual(decidePreviouslyOwnedDocument(transfer(), [SELLER], "insurance"), {
    ok: true,
    path: "seller-uid/MXE-01020/insurance.pdf",
  });
});

test("the email-matched placeholder id counts as the seller too", () => {
  const d = decidePreviouslyOwnedDocument(transfer({ seller_id: "placeholder" }), ["auth-uid", "placeholder"], "registration");
  assert.equal(d.ok, true);
});

test("anyone else gets the same 404 as a missing transfer", () => {
  assert.deepEqual(decidePreviouslyOwnedDocument(transfer(), ["buyer-uid"], "insurance"), decidePreviouslyOwnedDocument(null, ["buyer-uid"], "insurance"));
  assert.equal(decidePreviouslyOwnedDocument(transfer(), ["buyer-uid"], "insurance").ok, false);
});

test("a transfer that never completed froze nothing to read", () => {
  for (const status of ["pending", "reversed", "cancelled"]) {
    assert.equal(decidePreviouslyOwnedDocument(transfer({ status }), [SELLER], "insurance").ok, false, status);
  }
  assert.equal(decidePreviouslyOwnedDocument(transfer({ vessel_snapshot: null }), [SELLER], "insurance").ok, false);
});

test("an empty slot or an unknown type is refused, never signed", () => {
  assert.deepEqual(decidePreviouslyOwnedDocument(transfer(), [SELLER], "boater_card"), { ok: false, status: 404, error: "No document on file." });
  assert.equal(decidePreviouslyOwnedDocument(transfer(), [SELLER], "../users").ok, false);
});

// The defect this replaces: DocLink put the raw storage path in href, a
// relative URL that 404s. Links must go through the seller-checked route.
test("the previously-owned page links to the route, never to a stored path", () => {
  const src = readFileSync(new URL("../app/dashboard/transfer/[transferId]/previously-owned/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /url=\{s\.doc_/, "a snapshot path must not be handed to a link");
  assert.match(src, /previouslyOwnedDocumentHref\(/);
  assert.equal(previouslyOwnedDocumentHref("t-1", "insurance"), "/api/transfers/t-1/documents/insurance");
});
