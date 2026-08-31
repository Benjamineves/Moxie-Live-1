import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds, loadOwnedVessel } from "@/lib/vessel-ownership";
import { getOwnerBillingSummary } from "@/lib/billing-service";
import { generateShareToken } from "@/lib/share-token";
import { isShareFieldFlags, SHARE_PRESETS, type SharePreset } from "@/lib/share-filter";

const EXPIRY_OPTIONS = ["one_time", "24h", "7d", "none"] as const;
type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

function computeExpiresAt(expiresIn: ExpiryOption): string | null {
  const now = Date.now();
  if (expiresIn === "24h") return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (expiresIn === "7d") return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  return null; // 'one_time' is bound by view_count, not a time expiry; 'none' has no expiry
}

async function authorizeOwner(mxeId: string) {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: NextResponse.json({ error: "Missing Supabase auth configuration." }, { status: 503 }) };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const service = createSupabaseServiceClient();
  if (!service) return { error: NextResponse.json({ error: "Missing Supabase service role configuration." }, { status: 503 }) };

  const vessel = await loadOwnedVessel(service, mxeId, ownerIds);
  if (!vessel) return { error: NextResponse.json({ error: "Vessel not found." }, { status: 404 }) };

  return { service, vessel };
}

/**
 * Spec §5, §4: Full Access only, enforced here — not just hidden in the
 * UI. Basic gets an explicit 403 with the payload the share sheet uses
 * to render the upsell panel, never a silent downgrade to a public link.
 */
export async function POST(request: Request, context: { params: Promise<{ mxeId: string }> }) {
  const { mxeId } = await context.params;
  const auth = await authorizeOwner(mxeId);
  if ("error" in auth) return auth.error;
  const { service, vessel } = auth;

  const billing = await getOwnerBillingSummary(vessel.owner_id);
  if (billing?.subscriptionTier !== "full") {
    return NextResponse.json(
      { error: "Trusted Contact sharing is a Full Access feature.", code: "UPGRADE_REQUIRED", upsell: true },
      { status: 403 },
    );
  }

  let body: {
    label?: string;
    preset?: string;
    field_flags?: unknown;
    access_note?: string;
    expires_in?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isShareFieldFlags(body.field_flags)) {
    return NextResponse.json({ error: "Invalid field_flags." }, { status: 400 });
  }
  const preset = body.preset && (SHARE_PRESETS as readonly string[]).includes(body.preset) ? (body.preset as SharePreset) : "custom";
  const expiresIn = (EXPIRY_OPTIONS as readonly string[]).includes(body.expires_in ?? "")
    ? (body.expires_in as ExpiryOption)
    : "none";
  // one_time is derived from expires_in server-side, not trusted from
  // the client, so the two can't disagree.
  const oneTime = expiresIn === "one_time";

  const { token, tokenHash } = generateShareToken();

  const { data: inserted, error } = await service
    .from("vessel_shares")
    .insert({
      vessel_id: vessel.id,
      created_by: vessel.owner_id,
      label: body.label?.trim() || null,
      preset,
      token_hash: tokenHash,
      field_flags: body.field_flags,
      access_note: body.field_flags.access ? body.access_note?.trim() || null : null,
      expires_at: computeExpiresAt(expiresIn),
      one_time: oneTime,
    })
    .select("id, expires_at")
    .single();

  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? "Could not create share." }, { status: 500 });
  }

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://moxieyacht.com").replace(/\/$/, "");
  const url = `${baseUrl}/${encodeURIComponent(mxeId.toUpperCase())}?share=${token}`;

  return NextResponse.json({ id: inserted.id, url, expires_at: inserted.expires_at });
}

/** Spec §5: Shares dashboard reads active + recently-revoked/expired shares, with view_count/last_viewed_at. */
export async function GET(_request: Request, context: { params: Promise<{ mxeId: string }> }) {
  const { mxeId } = await context.params;
  const auth = await authorizeOwner(mxeId);
  if ("error" in auth) return auth.error;
  const { service, vessel } = auth;

  const { data: rows, error } = await service
    .from("vessel_shares")
    .select("id, label, preset, field_flags, expires_at, one_time, view_count, last_viewed_at, revoked_at, created_at")
    .eq("vessel_id", vessel.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const shares = (rows ?? []).map((row) => {
    const expired = row.expires_at ? new Date(row.expires_at).getTime() <= now : false;
    const status = row.revoked_at ? "revoked" : expired ? "expired" : "active";
    return { ...row, status };
  });

  return NextResponse.json({ shares });
}
