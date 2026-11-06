import { GATEWAY } from "./constants";
import { estimateFee, getArcDomain, randomSalt } from "./gateway";
import { expiryFrom, isExpired } from "./money";
import {
  getDonation,
  nextDonationId,
  saveDonation,
} from "./store";
import type { CreatorProfile, Donation } from "./types";

/** Mark an awaiting_payment donation failed if past its 15-minute expiry. */
export async function expireIfNeeded(d: Donation): Promise<Donation> {
  if (d.status === "awaiting_payment" && isExpired(d.expiresAt)) {
    const failed: Donation = {
      ...d,
      status: "failed",
      failureReason: "TRANSFER_EXPIRED",
      needsManualReview: false,
      updatedAt: new Date().toISOString(),
    };
    await saveDonation(failed);
    return failed;
  }
  return d;
}

export async function getDonationChecked(
  id: number,
): Promise<Donation | null> {
  const d = await getDonation(id);
  if (!d) return null;
  return expireIfNeeded(d);
}

export async function createDonationRecord(args: {
  amountBase: string;
  message: string;
  creator: CreatorProfile;
  isTest?: boolean;
}): Promise<{ donation: Donation; estimateError: string | null }> {
  const now = new Date().toISOString();
  const id = await nextDonationId();
  let maxFeeBase: string | null = null;
  let feeTotalUsdc: string | null = null;
  let maxBlockHeight: string | null = null;
  let estimateError: string | null = null;
  try {
    // Estimate with a placeholder depositor; prepare() re-estimates with
    // the real donor address and rebuilds the intent (new salt each time).
    await getArcDomain();
    const est = await estimateFee({
      amountBase: args.amountBase,
      depositor:
        "0x0000000000000000000000000000000000000000",
      recipient: args.creator.recipientAddress,
    });
    maxFeeBase = est.maxFeeBase;
    feeTotalUsdc = est.feeTotalUsdc;
    maxBlockHeight = est.maxBlockHeight;
  } catch (err) {
    estimateError = (err as Error).message;
  }
  const donation: Donation = {
    id,
    amountBase: args.amountBase,
    message: args.message,
    donorAddress: null,
    donorChainId: null,
    status: "awaiting_payment",
    failureReason: null,
    needsManualReview: false,
    salt: randomSalt(),
    maxFeeBase,
    feeTotalUsdc,
    maxBlockHeight,
    transferId: null,
    transferSubmitted: false,
    transferSpecHash: null,
    walletSignature: null,
    simulated: false,
    recipientAddress: args.creator.recipientAddress,
    createdAt: now,
    expiresAt: expiryFrom(now),
    signedAt: null,
    updatedAt: now,
    isTest: args.isTest ?? false,
  };
  await saveDonation(donation);
  return { donation, estimateError };
}

export { GATEWAY };
