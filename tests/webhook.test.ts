import { describe, expect, it } from "vitest";
import {
  extractEventFields,
  validateMintFinalized,
} from "../lib/webhook";
import type { Donation } from "../lib/types";

const CREATOR = "0xCfc8A7C5227e078ef5FeAA3d0DE9457B479b6aBd";

function donation(over: Partial<Donation> = {}): Donation {
  return {
    id: 1,
    amountBase: "1000000",
    message: "",
    donorAddress: CREATOR,
    donorChainId: 5042002,
    status: "processing",
    failureReason: null,
    needsManualReview: false,
    salt: "0x" + "00".repeat(32),
    maxFeeBase: "18479",
    feeTotalUsdc: "0.018479",
    maxBlockHeight: "72266242",
    transferId: "transfer-1",
    transferSubmitted: false,
    transferSpecHash: "0xabc",
    walletSignature: null,
    simulated: false,
    recipientAddress: CREATOR,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    signedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isTest: false,
    ...over,
  };
}

function goodEvent(over: Record<string, unknown> = {}) {
  return extractEventFields({
    notificationId: "notif-1",
    notificationType: "gateway.mint.finalized",
    env: "testnet",
    domain: 26,
    token: "USDC",
    amount: "1000000",
    transferId: "transfer-1",
    transferSpecHash: "0xabc",
    attestations: [{ to: CREATOR, amount: "1000000" }],
    ...over,
  });
}

describe("validateMintFinalized", () => {
  it("accepts a correct mint.finalized event", () => {
    expect(
      validateMintFinalized({
        ev: goodEvent(),
        donation: donation(),
        creatorRecipient: CREATOR,
      }),
    ).toBeNull();
  });

  it("rejects wrong env", () => {
    expect(
      validateMintFinalized({
        ev: goodEvent({ env: "production" }),
        donation: donation(),
        creatorRecipient: CREATOR,
      }),
    ).toBe("WRONG_ENV");
  });

  it("rejects wrong domain", () => {
    expect(
      validateMintFinalized({
        ev: goodEvent({ domain: 0 }),
        donation: donation(),
        creatorRecipient: CREATOR,
      }),
    ).toBe("WRONG_DOMAIN");
  });

  it("rejects a token address where the symbol belongs (the old gap)", () => {
    // /v1/info publishes only the symbol "USDC" — an address here is wrong.
    expect(
      validateMintFinalized({
        ev: goodEvent({
          token: "0x3600000000000000000000000000000000000000",
        }),
        donation: donation(),
        creatorRecipient: CREATOR,
      }),
    ).toBe("TOKEN_MISMATCH");
  });

  it("rejects amount under and over", () => {
    expect(
      validateMintFinalized({
        ev: goodEvent({ amount: "999999" }),
        donation: donation(),
        creatorRecipient: CREATOR,
      }),
    ).toBe("AMOUNT_MISMATCH");
    expect(
      validateMintFinalized({
        ev: goodEvent({ amount: "1000001" }),
        donation: donation(),
        creatorRecipient: CREATOR,
      }),
    ).toBe("AMOUNT_MISMATCH");
  });

  it("rejects a wrong attestation recipient", () => {
    expect(
      validateMintFinalized({
        ev: goodEvent({
          attestations: [
            { to: "0x1111111111111111111111111111111111111111", amount: "1000000" },
          ],
        }),
        donation: donation(),
        creatorRecipient: CREATOR,
      }),
    ).toBe("RECIPIENT_MISMATCH");
  });
});

describe("extractEventFields", () => {
  it("reads the canonical shape", () => {
    const ev = goodEvent();
    expect(ev.notificationId).toBe("notif-1");
    expect(ev.notificationType).toBe("gateway.mint.finalized");
    expect(ev.token).toBe("USDC");
    expect(ev.amount).toBe("1000000");
  });

  it("accepts common aliases", () => {
    const ev = extractEventFields({
      notificationId: "n2",
      notificationType: "gateway.mint.finalized",
      environment: "testnet",
      domainId: 26,
      tokenSymbol: "USDC",
      mintAmount: "500000",
      transfer: { transferId: "t-9" },
    });
    expect(ev.env).toBe("testnet");
    expect(ev.domain).toBe(26);
    expect(ev.token).toBe("USDC");
    expect(ev.amount).toBe("500000");
    expect(ev.transferId).toBe("t-9");
  });

  it("returns nulls for an empty payload", () => {
    const ev = extractEventFields({});
    expect(ev.notificationId).toBeNull();
    expect(ev.token).toBeNull();
  });
});
