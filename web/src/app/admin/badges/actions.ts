"use server";

import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { generateUniqueBadgeTokens } from "@/lib/badge-token";
import { badgeScanUrlProbe } from "@/lib/badge-url";
import { assertBadgeQrVersionWithinBudget, getQrModules } from "@/lib/qr-render";

/**
 * Upper bound on a single mint. Not a business rule — the spec's working
 * batch size is 100 (§3.2) and may shrink to fit a press sheet once a
 * supplier is chosen (§7 item 1). This exists so a typo in the count
 * field can't allocate ten thousand permanent MXE IDs that can never be
 * recycled, and so the token uniqueness pre-check stays one reasonable
 * `IN (...)` rather than an enormous one.
 */
const MAX_BATCH_SIZE = 500;

export type MintResult = { batchId?: string; error?: string };

/**
 * Mints a batch of badge identities — spec §5.0.2 steps 1-4 only.
 * Artwork (steps 5-7) is rendered separately and resumably; every
 * identity created here has artwork_path NULL and status 'minted', which
 * is both correct and the reason none of them is pickable yet: the
 * assignment query only ever selects 'in_stock' (§3.1).
 *
 * The transaction itself lives in mint_badge_batch() — PostgREST has no
 * multi-statement transaction, and steps 1-4 have to be atomic.
 */
export async function mintBadgeBatch(input: {
  label: string;
  count: number;
  copiesPerIdentity: number;
}): Promise<MintResult> {
  // Re-checked here rather than trusting that only the gated page can
  // reach this action — same defense-in-depth the other admin actions
  // apply (see stickers/actions.ts).
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const label = input.label.trim();
  if (!label) return { error: "A batch label is required — it's the double-submission guard." };
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_BATCH_SIZE) {
    return { error: `Identity count must be a whole number between 1 and ${MAX_BATCH_SIZE}.` };
  }
  if (!Number.isInteger(input.copiesPerIdentity) || input.copiesPerIdentity < 1 || input.copiesPerIdentity > 10) {
    return { error: "Copies per identity must be a whole number between 1 and 10." };
  }

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  // QR density, measured before a single token exists. Only possible
  // because tokens are fixed-length, so every identity in this batch
  // encodes a URL of identical length and therefore the same version
  // (§5.0.5). Throws if a change to the URL or the token length ever
  // pushes past the print spec's ceiling — deliberately loud, since a
  // denser badge cannot be un-printed.
  const probe = badgeScanUrlProbe();
  try {
    assertBadgeQrVersionWithinBudget(probe);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Badge QR exceeds the print budget." };
  }
  const qrVersion = getQrModules(probe).version;

  let tokens: string[];
  try {
    tokens = await generateUniqueBadgeTokens(input.count, async (candidates) => {
      const { data, error } = await service.from("badge_identities").select("token").in("token", candidates);
      if (error) throw new Error(`Token uniqueness check failed: ${error.message}`);
      return (data ?? []).map((row) => (row as { token: string }).token);
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not generate badge tokens." };
  }

  const { data, error } = await service.rpc("mint_badge_batch", {
    p_label: label,
    p_count: input.count,
    p_copies_per_identity: input.copiesPerIdentity,
    p_qr_version: qrVersion,
    p_tokens: tokens,
  });

  if (error) {
    // The guard firing is a normal outcome, not a crash — a double-click
    // or a retry lands here. Say so in words rather than surfacing a
    // constraint name, and say the part that matters: nothing was
    // consumed, because the batch insert is the first statement in the
    // function and it never reached next_mxe_id().
    if (error.code === "23505" || /badge_print_batches_label_key|duplicate key/i.test(error.message)) {
      return {
        error: `A batch labelled "${label}" already exists. Nothing was minted and no MXE IDs were used — pick a different label.`,
      };
    }
    return { error: `Mint failed: ${error.message}` };
  }

  return { batchId: typeof data === "string" ? data : undefined };
}
