import { NextResponse } from "next/server";
import { verifyDashboardPin } from "@/lib/auth";
import { expireIfNeeded } from "@/lib/donations";
import { getCreator, listDonations, listWebhookEvents } from "@/lib/store";

/**
 * POST /api/dashboard — PIN-protected creator dashboard data.
 * Body: { pin }
 * Totals exclude Test Lab donations. Orphan count covers the whole webhook
 * log, not just the latest page.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const creator = await getCreator();
  const ok = await verifyDashboardPin(String(body.pin ?? ""), creator);
  if (!ok) {
    return NextResponse.json(
      { error: "Wrong PIN" },
      { status: 401 },
    );
  }
  const all = await listDonations();
  // Expire stale awaiting_payment rows so totals are current.
  for (const d of all) {
    if (d.status === "awaiting_payment") await expireIfNeeded(d);
  }
  const fresh = await listDonations();
  const real = fresh.filter((d) => !d.isTest);
  const received = real.filter((d) => d.status === "received");
  const failed = real.filter((d) => d.status === "failed");
  const totalReceivedBase = received.reduce(
    (sum, d) => sum + BigInt(d.amountBase),
    0n,
  );
  const events = await listWebhookEvents();
  const orphans = events.filter((e) => e.outcome === "orphan");
  return NextResponse.json({
    creator: creator
      ? {
          name: creator.name,
          description: creator.description,
          avatarUrl: creator.avatarUrl,
          thankYouMessage: creator.thankYouMessage,
          recipientAddress: creator.recipientAddress,
        }
      : null,
    totals: {
      receivedCount: received.length,
      totalReceivedBase: totalReceivedBase.toString(),
      failedCount: failed.length,
      reviewCount: failed.filter((d) => d.needsManualReview).length,
      processingCount: real.filter((d) => d.status === "processing").length,
      awaitingCount: real.filter((d) => d.status === "awaiting_payment")
        .length,
      orphanCount: orphans.length,
      testDonationCount: fresh.filter((d) => d.isTest).length,
    },
    donations: fresh.slice(0, 100),
    webhookEvents: events.slice(0, 100),
    storage: (await import("@/lib/store")).storageMode(),
    realTransferEnabled: Boolean(process.env.CIRCLE_API_KEY),
    riverConfigured: (await import("@/lib/river")).isRiverConfigured(),
  });
}
