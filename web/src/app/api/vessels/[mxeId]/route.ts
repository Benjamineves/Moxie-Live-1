import { NextResponse } from "next/server";
import {
  fetchVesselByMxeId,
  filterVesselForRole,
} from "@/lib/vessel-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emailsMatch, getOwnerEmailByUserId } from "@/lib/owner-verify";
import type { ProfileRole } from "@/types/vessel";

export async function GET(
  request: Request,
  context: { params: Promise<{ mxeId: string }> },
) {
  const { mxeId } = await context.params;
  const url = new URL(request.url);
  const raw = url.searchParams.get("role") ?? "public";
  const role = raw.toLowerCase() as ProfileRole;

  if (!["public", "owner", "marina", "coastguard"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const vessel = await fetchVesselByMxeId(mxeId);
  if (!vessel) {
    return NextResponse.json({ error: "Vessel not found" }, { status: 404 });
  }

  if (role === "public") {
    if (vessel.qr_status !== "active") {
      return NextResponse.json({ status: "pending_payment", mxe_id: vessel.mxe_id }, { status: 200 });
    }
    return NextResponse.json(filterVesselForRole(vessel, "public"));
  }

  if (role === "marina" || role === "coastguard") {
    return NextResponse.json(
      {
        error: "Authentication required for this role tier.",
        code: "AUTH_REQUIRED",
        role,
      },
      { status: 401 },
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Server misconfigured (missing Supabase env)." },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json(
      { error: "Unauthorized", code: "AUTH_REQUIRED", role: "owner" },
      { status: 401 },
    );
  }

  const ownerEmail = await getOwnerEmailByUserId(vessel.owner_id);
  if (!ownerEmail) {
    return NextResponse.json(
      {
        error:
          "Cannot verify ownership (add SUPABASE_SERVICE_ROLE_KEY on server or relax RLS on users).",
        code: "OWNER_LOOKUP_FAILED",
      },
      { status: 503 },
    );
  }

  if (!emailsMatch(user.email, ownerEmail)) {
    return NextResponse.json(
      { error: "Forbidden — sign in as the vessel owner.", code: "NOT_OWNER" },
      { status: 403 },
    );
  }

  return NextResponse.json(filterVesselForRole(vessel, "owner"));
}
