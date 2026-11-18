import { generateKeyPairSync, sign } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractEventFields,
  isIgnorableWebhookPayload,
  normalizeAmountToBaseUnits,
  validateMintFinalized,
  verifyWebhookSignature,
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

  it("accepts the known Arc USDC address (what real Circle events send)", () => {
    // Real Circle events carry tokenAddress, not the symbol — the known
    // Arc USDC address normalizes to "USDC" and validates.
    expect(
      validateMintFinalized({
        ev: goodEvent({
          token: "0x3600000000000000000000000000000000000000",
        }),
        donation: donation(),
        creatorRecipient: CREATOR,
      }),
    ).toBeNull();
  });

  it("rejects an unknown token address", () => {
    expect(
      validateMintFinalized({
        ev: goodEvent({
          token: "0x0000000000000000000000000000000000000001",
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

describe("verifyWebhookSignature", () => {
  afterEach(() => {
    delete process.env.CIRCLE_WEBHOOK_SIGNING_KEY;
    delete process.env.CIRCLE_API_KEY;
    vi.unstubAllGlobals();
  });

  it("verifies a valid signature against the configured PEM key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    process.env.CIRCLE_WEBHOOK_SIGNING_KEY = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    const payload = Buffer.from(JSON.stringify({ notificationId: "t1" }));
    const sig = sign("SHA256", payload, privateKey).toString("base64");
    const good = await verifyWebhookSignature({
      rawBody: payload,
      signatureB64: sig,
      keyId: "k1",
    });
    expect(good.ok).toBe(true);
    const tampered = await verifyWebhookSignature({
      rawBody: Buffer.from(JSON.stringify({ notificationId: "t2" })),
      signatureB64: sig,
      keyId: "k1",
    });
    expect(tampered.ok).toBe(false);
  });

  it("rejects a missing signature when a key is configured", async () => {
    const { publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    process.env.CIRCLE_WEBHOOK_SIGNING_KEY = publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
    const res = await verifyWebhookSignature({
      rawBody: Buffer.from("{}"),
      signatureB64: null,
      keyId: "k1",
    });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(false);
  });

  it("skips verification when no key material exists (development mode)", async () => {
    const res = await verifyWebhookSignature({
      rawBody: Buffer.from("{}"),
      signatureB64: null,
      keyId: null,
    });
    expect(res.skipped).toBe(true);
  });

  it("fetches Circle's public key by keyId, verifies, and caches it", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const derB64 = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          id: "key-1",
          algorithm: "ECDSA_SHA_256",
          publicKey: derB64,
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.CIRCLE_API_KEY = "test-api-key";
    const payload = Buffer.from(JSON.stringify({ notificationId: "t1" }));
    const sig = sign("SHA256", payload, privateKey).toString("base64");
    const res = await verifyWebhookSignature({
      rawBody: payload,
      signatureB64: sig,
      keyId: "key-1",
    });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Same keyId again uses the cache — no second fetch.
    const res2 = await verifyWebhookSignature({
      rawBody: payload,
      signatureB64: sig,
      keyId: "key-1",
    });
    expect(res2.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects when Circle's key endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    process.env.CIRCLE_API_KEY = "test-api-key";
    const res = await verifyWebhookSignature({
      rawBody: Buffer.from("{}"),
      signatureB64: "AAAA",
      keyId: "key-9",
    });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(false);
  });
});

describe("extractEventFields with the real Circle payload", () => {
  // Exact payload Circle sent for Tip #82 (notification
  // 7ce9bd90-a18f-4683-bf9b-6856d2c76112), as stored in the webhook log.
  const realPayload = {
    subscriptionId: "eda209bd-eb59-4a8d-a69c-c1b218bb963e",
    notificationId: "7ce9bd90-a18f-4683-bf9b-6856d2c76112",
    notificationType: "gateway.mint.finalized",
    notification: {
      env: "testnet",
      domain: "26",
      txHash:
        "0xe3fb79ac16f253462fff22f44d992d40e9699b7e214f2500b8e4924d0b9f103c",
      transferId: "a05e0461-5c2f-4281-a9d0-2d320d24636f",
      attestations: [
        {
          to: "0xdb1691026351ee75f170daddc2ff000382a9feb4",
          from: "0xdb1691026351ee75f170daddc2ff000382a9feb4",
          amount: "0.500000",
          transferSpecHash:
            "0x9dc329e80b9cc8247adc198c21382721bce1d9cc60ee87798146313009e2c5b5",
        },
      ],
      tokenAddress: "0x3600000000000000000000000000000000000000",
      wasForwarded: true,
      walletAddress: "0xdb1691026351ee75f170daddc2ff000382a9feb4",
    },
    timestamp: "2026-11-18T07:42:40.568333246Z",
    version: 2,
  };

  it("reads the transfer out of the notification envelope", () => {
    const ev = extractEventFields(realPayload);
    expect(ev.notificationId).toBe("7ce9bd90-a18f-4683-bf9b-6856d2c76112");
    expect(ev.notificationType).toBe("gateway.mint.finalized");
    expect(ev.transferId).toBe("a05e0461-5c2f-4281-a9d0-2d320d24636f");
    expect(ev.transferSpecHash).toBe(
      "0x9dc329e80b9cc8247adc198c21382721bce1d9cc60ee87798146313009e2c5b5",
    );
    expect(ev.env).toBe("testnet");
    expect(ev.domain).toBe(26);
    expect(ev.token).toBe("USDC");
    expect(ev.amount).toBe("500000");
    expect(ev.attestations[0].to).toBe(
      "0xdb1691026351ee75f170daddc2ff000382a9feb4",
    );
  });

  it("validates the real event against the matching donation", () => {
    const ev = extractEventFields(realPayload);
    expect(
      validateMintFinalized({
        ev,
        donation: donation({
          id: 82,
          amountBase: "500000",
          transferId: "a05e0461-5c2f-4281-a9d0-2d320d24636f",
          transferSpecHash:
            "0x9dc329e80b9cc8247adc198c21382721bce1d9cc60ee87798146313009e2c5b5",
          recipientAddress:
            "0xDB1691026351EE75f170DaddC2Ff000382a9Feb4",
        }),
        creatorRecipient: "0xDB1691026351EE75f170DaddC2Ff000382a9Feb4",
      }),
    ).toBeNull();
  });
});

describe("normalizeAmountToBaseUnits", () => {
  it("converts Circle decimal USDC strings to base units", () => {
    expect(normalizeAmountToBaseUnits("0.500000")).toBe("500000");
    expect(normalizeAmountToBaseUnits("1.000000")).toBe("1000000");
    expect(normalizeAmountToBaseUnits("10.25")).toBe("10250000");
    expect(normalizeAmountToBaseUnits("0.000001")).toBe("1");
  });

  it("passes integer base units through unchanged", () => {
    expect(normalizeAmountToBaseUnits("500000")).toBe("500000");
    expect(normalizeAmountToBaseUnits("1000000")).toBe("1000000");
    expect(normalizeAmountToBaseUnits(null)).toBeNull();
  });
});

describe("isIgnorableWebhookPayload", () => {
  it("ignores an empty payload (Circle's subscription-validation probe)", () => {
    expect(isIgnorableWebhookPayload({})).toBe(true);
  });

  it("ignores a payload with no notificationId", () => {
    expect(
      isIgnorableWebhookPayload({
        notificationType: "gateway.mint.finalized",
      }),
    ).toBe(true);
  });

  it("ignores an unknown notification type", () => {
    expect(
      isIgnorableWebhookPayload({
        notificationId: "n1",
        notificationType: "something.else",
      }),
    ).toBe(true);
  });

  it("does not ignore real Gateway events", () => {
    for (const t of [
      "gateway.deposit.finalized",
      "gateway.mint.finalized",
      "gateway.mint.forwarded",
    ]) {
      expect(
        isIgnorableWebhookPayload({
          notificationId: "n1",
          notificationType: t,
        }),
      ).toBe(false);
    }
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
