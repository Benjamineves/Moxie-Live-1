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
  return NextResponse.json(toPreview(vessel));
}
