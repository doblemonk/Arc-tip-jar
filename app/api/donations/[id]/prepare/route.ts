import { NextResponse } from "next/server";
import { ARC_TESTNET } from "@/lib/constants";
import { getDonationChecked } from "@/lib/donations";
import {
  applyFeeMargin,
  buildBurnIntent,
  buildSpec,
  estimateFee,
  getArcDomain,
  hashTransferSpec,
  isAddress,
  randomSalt,
} from "@/lib/gateway";
import { saveDonation } from "@/lib/store";

/**
 * POST /api/donations/:id/prepare — rebuild the burn intent with the
 * connected wallet as sourceDepositor/sourceSigner.
 * Body: { donorAddress }
 * The salt regenerates on EVERY prepare: always sign the intent returned
 * by the latest prepare call, never an older one.
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
  const donorAddress = String(body.donorAddress ?? "").trim();
  if (!isAddress(donorAddress)) {
    return NextResponse.json(
      { error: "donorAddress must be a valid 0x address" },
      { status: 400 },
    );
  }
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
  try {
    const arc = await getArcDomain();
    const est = await estimateFee({
      amountBase: donation.amountBase,
      depositor: donorAddress,
      recipient: donation.recipientAddress,
    });
    const salt = randomSalt();
    const spec = buildSpec({
      depositor: donorAddress,
      recipient: donation.recipientAddress,
      valueBase: donation.amountBase,
      salt,
      walletContract: arc.walletContract,
      minterContract: arc.minterContract,
    });
    // Signed maxFee carries a safety margin over the estimate (see
    // applyFeeMargin): Gateway's forwarding fee can rise between prepare
    // and submit. The displayed feeTotalUsdc below stays the plain
    // estimate — only the cap is margined.
    const maxFeeBase = applyFeeMargin(est.maxFeeBase);
    const { burnIntent, typedData } = buildBurnIntent({
      spec,
      maxFeeBase,
      maxBlockHeight: est.maxBlockHeight,
    });
    const updated = {
      ...donation,
      donorAddress,
      donorChainId: ARC_TESTNET.chainId,
      salt,
      maxFeeBase,
      feeTotalUsdc: est.feeTotalUsdc,
      maxBlockHeight: est.maxBlockHeight,
      transferSpecHash: hashTransferSpec(spec),
      updatedAt: new Date().toISOString(),
    };
    await saveDonation(updated);
    return NextResponse.json({
      donation: updated,
      burnIntent,
      typedData,
      transferSpecHash: updated.transferSpecHash,
      feeNote:
        "Source and destination are both Arc Testnet (Gateway domain 26).",
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
