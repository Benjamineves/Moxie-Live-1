import { NextResponse } from "next/server";
import { fetchVesselByMxeId, toPreview } from "@/lib/vessel-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ mxeId: string }> },
) {
  const { mxeId } = await context.params;
  const vessel = await fetchVesselByMxeId(mxeId);
  if (!vessel) {
    return NextResponse.json({ error: "Vessel not found" }, { status: 404 });
  }
  // Same reasoning as the pending_payment check below, checked first
  // since it's the more definitive state: a decommissioned vessel's
  // identity isn't public anymore either, so the scan preview withholds
  // it too rather than leaking name/make/model through a side door the
  // "no longer active" gate on the profile page is meant to close.
  if (vessel.lifecycle_status === "decommissioned") {
    return NextResponse.json({ status: "decommissioned", mxe_id: vessel.mxe_id }, { status: 200 });
  }
  // Payment gate: a pending vessel's identity isn't public yet, so the scan
  // preview withholds it too rather than leaking name/make/model through a
  // side door the "not yet active" gate on the profile page is meant to close.
  if (vessel.qr_status !== "active") {
    return NextResponse.json({ status: "pending_payment", mxe_id: vessel.mxe_id }, { status: 200 });
  }
  return NextResponse.json(toPreview(vessel));
}
