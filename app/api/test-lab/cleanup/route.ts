import { NextResponse } from "next/server";
import { verifyDashboardPin } from "@/lib/auth";
import { deleteTestData } from "@/lib/store";

/**
 * POST /api/test-lab/cleanup — PIN-guarded removal of Test Lab data.
 * Body: { pin }
 * Deletes Test Lab donations and their linked webhook events only.
 * Real tips and the creator profile are never touched.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { getCreator } = await import("@/lib/store");
  const creator = await getCreator();
  const ok = await verifyDashboardPin(String(body.pin ?? ""), creator);
  if (!ok) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }
  const { removedDonations, removedEvents } = await deleteTestData();
  return NextResponse.json({
    ok: true,
    removedDonations,
    removedEvents,
    note: "Only Test Lab donations and their webhook events were removed. Real tips and the creator profile are untouched.",
  });
}
