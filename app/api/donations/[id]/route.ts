import { NextResponse } from "next/server";
import { getDonationChecked } from "@/lib/donations";

/** GET /api/donations/:id — donation status (expires awaiting_payment inline). */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid donation id" }, { status: 400 });
  }
  const donation = await getDonationChecked(id);
  if (!donation) {
    return NextResponse.json({ error: "Donation not found" }, { status: 404 });
  }
  return NextResponse.json({ donation });
}
