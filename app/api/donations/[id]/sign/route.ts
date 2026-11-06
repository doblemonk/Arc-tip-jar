import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getDonationChecked } from "@/lib/donations";
import {
  buildBurnIntent,
  buildSpec,
  getArcDomain,
  hashTransferSpec,
  recoverIntentSigner,
  submitTransfer,
} from "@/lib/gateway";
import { saveDonation } from "@/lib/store";

/**
 * POST /api/donations/:id/sign — accept a wallet signature for the latest
 * prepared burn intent and move the donation to processing.
 * Body: { signature: "0x…" } OR { simulated: true }
 *
 * Real path: the signature is verified by recovering the signer — it must
 * equal the connected donor address, otherwise 400 and nothing changes.
 * If CIRCLE_API_KEY is set, the signed intent is submitted to
 * POST /v1/transfer?enableForwarder=true and the REAL transferId is stored.
 * Without a key the donation still moves to processing with a clearly
 * local id (`local-pending-…`) and transferSubmitted=false — the app says
 * honestly that real submission is disabled, and never fakes a transferId.
 *
 * Simulated path (browsers with no wallet): clearly labelled, stored as
 * simulated=true with a `sim-…` id. It is a demo fallback, not a payment.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid donation id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const donation = await getDonationChecked(id);
  if (!donation) {
    return NextResponse.json({ error: "Donation not found" }, { status: 404 });
  }
  if (donation.status !== "awaiting_payment") {
    return NextResponse.json(
      { error: `Donation is ${donation.status} — it can no longer be signed.` },
      { status: 409 },
    );
  }
  if (!donation.donorAddress || !donation.maxFeeBase || !donation.maxBlockHeight) {
    return NextResponse.json(
      { error: "Donation has no prepared intent yet — call prepare first." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const apiKey = process.env.CIRCLE_API_KEY;

  if (body.simulated === true) {
    const updated = {
      ...donation,
      status: "processing" as const,
      simulated: true,
      walletSignature: null,
      transferId: `sim-${donation.id}-${randomBytes(4).toString("hex")}`,
      transferSubmitted: false,
      signedAt: now,
      updatedAt: now,
    };
    await saveDonation(updated);
    return NextResponse.json({
      donation: updated,
      note: "Simulated signing (no wallet in this browser). This is a demo path — no real transfer was submitted.",
    });
  }

  const signature = String(body.signature ?? "").trim();
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return NextResponse.json(
      { error: "signature must be a 0x-prefixed 65-byte hex string" },
      { status: 400 },
    );
  }

  // Rebuild the exact intent that was prepared (same salt) for verification.
  let burnIntent;
  try {
    const arc = await getArcDomain();
    const spec = buildSpec({
      depositor: donation.donorAddress,
      recipient: donation.recipientAddress,
      valueBase: donation.amountBase,
      salt: donation.salt,
      walletContract: arc.walletContract,
      minterContract: arc.minterContract,
    });
    burnIntent = buildBurnIntent({
      spec,
      maxFeeBase: donation.maxFeeBase,
      maxBlockHeight: donation.maxBlockHeight,
    }).burnIntent;
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }

  let recovered: string;
  try {
    recovered = recoverIntentSigner(burnIntent, signature);
  } catch {
    return NextResponse.json(
      { error: "Signature could not be verified against the burn intent." },
      { status: 400 },
    );
  }
  if (recovered.toLowerCase() !== donation.donorAddress.toLowerCase()) {
    return NextResponse.json(
      {
        error:
          "Signature does not match the connected donor address — donation left untouched.",
      },
      { status: 400 },
    );
  }

  let transferId: string;
  let transferSubmitted = false;
  if (apiKey) {
    try {
      const res = await submitTransfer({
        burnIntent,
        signature,
        apiKey,
      });
      transferId = res.transferId;
      transferSubmitted = true;
    } catch (err) {
      return NextResponse.json(
        {
          error: `Gateway /v1/transfer failed: ${(err as Error).message} — donation left awaiting_payment.`,
        },
        { status: 502 },
      );
    }
  } else {
    transferId = `local-pending-${donation.id}-${randomBytes(4).toString("hex")}`;
  }

  const updated = {
    ...donation,
    status: "processing" as const,
    walletSignature: signature,
    transferSpecHash: hashTransferSpec(burnIntent.spec),
    transferId,
    transferSubmitted,
    signedAt: now,
    updatedAt: now,
  };
  await saveDonation(updated);
  return NextResponse.json({
    donation: updated,
    transferSubmitted,
    note: transferSubmitted
      ? "Signed intent submitted to Circle Gateway (real transferId)."
      : "Signed, but CIRCLE_API_KEY is not set — real transfer submission is disabled. The donation stays in processing until a webhook (or the simulator / Test Lab) finalizes it. The transferId above is local only, not a Circle transfer.",
  });
}
