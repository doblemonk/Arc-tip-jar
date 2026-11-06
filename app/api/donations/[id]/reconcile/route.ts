import { NextResponse } from "next/server";
import { GATEWAY } from "@/lib/constants";
import { expireIfNeeded, getDonationChecked } from "@/lib/donations";
import { getTransfer } from "@/lib/gateway";
import { saveDonation } from "@/lib/store";

/**
 * POST /api/donations/:id/reconcile — poll Gateway for a processing donation.
 * Gateway has no "failed" webhook, so this is the failure path.
 * - awaiting_payment past 15 min -> failed TRANSFER_EXPIRED.
 * - processing + real transfer submitted + CIRCLE_API_KEY -> GET /v1/transfer.
 *   A failed/expired transfer -> failed; a completed transfer stays
 *   processing until its mint.finalized webhook arrives.
 * - processing without a real submission -> cannot poll; honest about it.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid donation id" }, { status: 400 });
  }
  let donation = await getDonationChecked(id);
  if (!donation) {
    return NextResponse.json({ error: "Donation not found" }, { status: 404 });
  }
  if (donation.status === "awaiting_payment") {
    donation = await expireIfNeeded(donation);
    return NextResponse.json({
      donation,
      reconciled: donation.status === "failed",
      detail:
        donation.status === "failed"
          ? "Donation expired unsigned (15-minute limit)."
          : "Donation is still awaiting payment.",
    });
  }
  if (donation.status === "received" || donation.status === "failed") {
    return NextResponse.json({
      donation,
      reconciled: false,
      detail: `Donation is already ${donation.status} (final state).`,
    });
  }

  // status === "processing"
  const ageMs = Date.now() - new Date(donation.createdAt).getTime();
  if (ageMs < GATEWAY.reconcileAfterMs) {
    return NextResponse.json({
      donation,
      reconciled: false,
      detail: `Too early to reconcile (processing for ${Math.round(ageMs / 1000)}s, reconcile after 60s).`,
    });
  }
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!donation.transferSubmitted || !donation.transferId || !apiKey) {
    return NextResponse.json({
      donation,
      reconciled: false,
      detail:
        "Cannot poll Gateway: no real transfer was submitted (CIRCLE_API_KEY is not set). The donation stays in processing until a webhook — or the dashboard simulator — finalizes it.",
    });
  }
  try {
    const { status } = await getTransfer({
      transferId: donation.transferId,
      apiKey,
    });
    const lower = status.toLowerCase();
    if (lower.includes("fail") || lower.includes("error")) {
      const failed = {
        ...donation,
        status: "failed" as const,
        failureReason: "TRANSFER_FAILED" as const,
        needsManualReview: true,
        updatedAt: new Date().toISOString(),
      };
      await saveDonation(failed);
      return NextResponse.json({
        donation: failed,
        reconciled: true,
        detail: `Gateway reports transfer status "${status}" — marked failed.`,
      });
    }
    if (lower.includes("expir")) {
      const failed = {
        ...donation,
        status: "failed" as const,
        failureReason: "TRANSFER_EXPIRED" as const,
        needsManualReview: false,
        updatedAt: new Date().toISOString(),
      };
      await saveDonation(failed);
      return NextResponse.json({
        donation: failed,
        reconciled: true,
        detail: `Gateway reports transfer status "${status}" — marked failed (expired).`,
      });
    }
    return NextResponse.json({
      donation,
      reconciled: false,
      detail: `Gateway reports transfer status "${status}" — still processing; the mint.finalized webhook finalizes it.`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, donation },
      { status: 502 },
    );
  }
}
