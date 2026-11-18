import { NextResponse } from "next/server";
import { verifyDashboardPin } from "@/lib/auth";
import { getDonation } from "@/lib/store";
import { processWebhookEvent } from "@/lib/webhook";

/**
 * POST /api/simulate-webhook — the dashboard webhook simulator.
 * Body: { pin, donationId, notificationId?, overrides? }
 *
 * Builds a correct gateway.mint.finalized payload for the donation and
 * feeds it through the SAME processing as a real Circle webhook.
 *
 * The expected values are stated explicitly (this is the fix for the old
 * discoverability gap where three test donations failed TOKEN_MISMATCH
 * because nobody could tell what token value was expected):
 *   token: "USDC"  — the token SYMBOL as published by GET /v1/info.
 *   Real Circle events instead send the token contract address; the known
 *   Arc USDC address is accepted too, any other address fails with
 *   TOKEN_MISMATCH.
 *   env: "testnet"  — anything else fails with WRONG_ENV.
 *   domain: 26      — Arc Testnet; anything else fails with WRONG_DOMAIN.
 *   amount: the donation's exact amount in integer base units.
 *   attestations[].to: the creator's recipient address.
 *
 * `overrides` lets the dashboard deliberately send a wrong value
 * (e.g. { token: "0x3600…" }) to watch the failure path.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { getCreator } = await import("@/lib/store");
  const creator = await getCreator();
  const ok = await verifyDashboardPin(String(body.pin ?? ""), creator);
  if (!ok) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }
  const donationId = Number(body.donationId);
  if (!Number.isInteger(donationId) || donationId <= 0) {
    return NextResponse.json({ error: "Invalid donationId" }, { status: 400 });
  }
  const donation = await getDonation(donationId);
  if (!donation) {
    return NextResponse.json({ error: "Donation not found" }, { status: 404 });
  }
  if (!donation.transferId) {
    return NextResponse.json(
      { error: "Donation has no transferId yet — sign it first." },
      { status: 400 },
    );
  }
  const payload = {
    notificationId:
      String(body.notificationId ?? "").trim() ||
      `sim-${donation.id}-${Date.now()}`,
    notificationType: "gateway.mint.finalized",
    env: "testnet",
    domain: 26,
    token: "USDC",
    amount: donation.amountBase,
    transferId: donation.transferId,
    transferSpecHash: donation.transferSpecHash,
    attestations: [
      { to: donation.recipientAddress, amount: donation.amountBase },
    ],
    ...(body.overrides ?? {}),
  };
  const result = await processWebhookEvent(payload);
  return NextResponse.json({
    ...result,
    payload,
    expectedValues: {
      token: 'The symbol "USDC" (from GET /v1/info — never a token address).',
      env: '"testnet" — anything else fails with WRONG_ENV.',
      domain: "26 — Arc Testnet; anything else fails with WRONG_DOMAIN.",
      amount: "The donation's exact amount in integer base units.",
      attestationsTo: "The creator's recipient address.",
    },
  });
}
