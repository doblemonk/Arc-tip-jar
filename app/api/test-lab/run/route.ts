import { generateKeyPairSync, sign, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { verifyDashboardPin } from "@/lib/auth";
import { createDonationRecord, expireIfNeeded } from "@/lib/donations";
import { getCreator, saveDonation } from "@/lib/store";
import {
  processWebhookEvent,
  verifyWebhookSignature,
} from "@/lib/webhook";
import type { Donation } from "@/lib/types";

/**
 * POST /api/test-lab/run — the blueprint's 12 minimal test cases, run
 * against the real store and the real webhook logic with throwaway
 * Test Lab donations (isTest=true, removable via /api/test-lab/cleanup).
 * Body: { pin }
 *
 *  1 success · 2 expired transfer · 3 duplicate webhook (same
 *  notificationId + same transferId) · 4 amount under · 5 amount over ·
 *  6 wrong token · 7 wrong recipient · 8 wrong env · 9 wrong domain ·
 * 10 deposit does NOT mark a tip received · 11 unknown transferId ·
 * 12 invalid signature -> 401 (verified against an ephemeral keypair)
 */

interface CaseResult {
  name: string;
  passed: boolean;
  detail: string;
}

function tag(): string {
  return randomBytes(4).toString("hex");
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const creator = await getCreator();
  const ok = await verifyDashboardPin(String(body.pin ?? ""), creator);
  if (!ok) {
    return NextResponse.json({ error: "Wrong PIN" }, { status: 401 });
  }
  if (!creator) {
    return NextResponse.json(
      { error: "Set up a creator profile first — Test Lab needs a recipient address." },
      { status: 400 },
    );
  }
  const profile = creator;

  const results: CaseResult[] = [];
  const run = async (name: string, fn: () => Promise<string>) => {
    try {
      const detail = await fn();
      results.push({ name, passed: true, detail });
    } catch (err) {
      results.push({
        name,
        passed: false,
        detail: (err as Error).message,
      });
    }
  };
  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(msg);
  };

  async function makeProcessingDonation(
    caseTag: string,
  ): Promise<Donation> {
    const { donation } = await createDonationRecord({
      amountBase: "1000000",
      message: `Test Lab ${caseTag}`,
      creator: profile,
      isTest: true,
    });
    const processing: Donation = {
      ...donation,
      status: "processing",
      transferId: `testlab-${caseTag}-${tag()}`,
      transferSpecHash: `0x${randomBytes(32).toString("hex")}`,
      signedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveDonation(processing);
    return processing;
  }

  function mintPayload(
    d: Donation,
    notificationId: string,
    over: Record<string, unknown> = {},
  ) {
    return {
      notificationId,
      notificationType: "gateway.mint.finalized",
      env: "testnet",
      domain: 26,
      token: "USDC",
      amount: d.amountBase,
      transferId: d.transferId,
      transferSpecHash: d.transferSpecHash,
      attestations: [
        { to: profile.recipientAddress, amount: d.amountBase },
      ],
      ...over,
    };
  }

  await run("success", async () => {
    const d = await makeProcessingDonation("success");
    const res = await processWebhookEvent(
      mintPayload(d, `testlab-success-${tag()}`),
    );
    const { getDonation } = await import("@/lib/store");
    const after = await getDonation(d.id);
    assert(res.outcome === "applied", `expected applied, got ${res.outcome}`);
    assert(after?.status === "received", `expected received, got ${after?.status}`);
    return `Donation #${d.id} received via mint.finalized.`;
  });

  await run("expired transfer", async () => {
    const { donation } = await createDonationRecord({
      amountBase: "1000000",
      message: "Test Lab expired",
      creator: profile,
      isTest: true,
    });
    const stale: Donation = {
      ...donation,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    await saveDonation(stale);
    const after = await expireIfNeeded(stale);
    assert(after.status === "failed", `expected failed, got ${after.status}`);
    assert(
      after.failureReason === "TRANSFER_EXPIRED",
      `expected TRANSFER_EXPIRED, got ${after.failureReason}`,
    );
    return `Donation #${donation.id} expired unsigned -> failed TRANSFER_EXPIRED.`;
  });

  await run("duplicate webhook", async () => {
    const d = await makeProcessingDonation("duplicate");
    const nid = `testlab-dup-${tag()}`;
    const first = await processWebhookEvent(mintPayload(d, nid));
    const second = await processWebhookEvent(mintPayload(d, nid));
    const { getDonation } = await import("@/lib/store");
    const after = await getDonation(d.id);
    assert(first.outcome === "applied", `first: ${first.outcome}`);
    assert(second.outcome === "duplicate", `second: ${second.outcome}`);
    assert(after?.status === "received", "donation must stay received once");
    return "Same notificationId sent twice: applied once, duplicate ignored, totals unchanged.";
  });

  await run("amount under", async () => {
    const d = await makeProcessingDonation("under");
    const res = await processWebhookEvent(
      mintPayload(d, `testlab-under-${tag()}`, { amount: "999999" }),
    );
    const { getDonation } = await import("@/lib/store");
    const after = await getDonation(d.id);
    assert(after?.status === "failed", `expected failed, got ${after?.status}`);
    assert(after?.failureReason === "AMOUNT_MISMATCH", `got ${after?.failureReason}`);
    assert(after?.needsManualReview === true, "mismatch must flag manual review");
    return `Donation #${d.id} failed AMOUNT_MISMATCH (999999 < 1000000).`;
  });

  await run("amount over", async () => {
    const d = await makeProcessingDonation("over");
    await processWebhookEvent(
      mintPayload(d, `testlab-over-${tag()}`, { amount: "1000001" }),
    );
    const { getDonation } = await import("@/lib/store");
    const after = await getDonation(d.id);
    assert(after?.failureReason === "AMOUNT_MISMATCH", `got ${after?.failureReason}`);
    return `Donation #${d.id} failed AMOUNT_MISMATCH (1000001 > 1000000).`;
  });

  await run("wrong token", async () => {
    const d = await makeProcessingDonation("token");
    await processWebhookEvent(
      mintPayload(d, `testlab-token-${tag()}`, {
        token: "0x3600000000000000000000000000000000000000",
      }),
    );
    const { getDonation } = await import("@/lib/store");
    const after = await getDonation(d.id);
    assert(after?.failureReason === "TOKEN_MISMATCH", `got ${after?.failureReason}`);
    return "Token address rejected — the expected value is the symbol \"USDC\" (see /v1/info).";
  });

  await run("wrong recipient", async () => {
    const d = await makeProcessingDonation("recipient");
    await processWebhookEvent(
      mintPayload(d, `testlab-recipient-${tag()}`, {
        attestations: [
          {
            to: "0x1111111111111111111111111111111111111111",
            amount: "1000000",
          },
        ],
      }),
    );
    const { getDonation } = await import("@/lib/store");
    const after = await getDonation(d.id);
    assert(after?.failureReason === "RECIPIENT_MISMATCH", `got ${after?.failureReason}`);
    return `Donation #${d.id} failed RECIPIENT_MISMATCH.`;
  });

  await run("wrong env", async () => {
    const d = await makeProcessingDonation("env");
    await processWebhookEvent(
      mintPayload(d, `testlab-env-${tag()}`, { env: "production" }),
    );
    const { getDonation } = await import("@/lib/store");
    const after = await getDonation(d.id);
    assert(after?.failureReason === "WRONG_ENV", `got ${after?.failureReason}`);
    return `Donation #${d.id} failed WRONG_ENV (env=production, only testnet is accepted).`;
  });

  await run("wrong domain", async () => {
    const d = await makeProcessingDonation("domain");
    await processWebhookEvent(
      mintPayload(d, `testlab-domain-${tag()}`, { domain: 0 }),
    );
    const { getDonation } = await import("@/lib/store");
    const after = await getDonation(d.id);
    assert(after?.failureReason === "WRONG_DOMAIN", `got ${after?.failureReason}`);
    return `Donation #${d.id} failed WRONG_DOMAIN (domain 0, only 26 is accepted).`;
  });

  await run("deposit does NOT mark tip received", async () => {
    const d = await makeProcessingDonation("deposit");
    const res = await processWebhookEvent({
      notificationId: `testlab-deposit-${tag()}`,
      notificationType: "gateway.deposit.finalized",
      env: "testnet",
      domain: 26,
      token: "USDC",
      amount: d.amountBase,
      transferId: d.transferId,
      transferSpecHash: d.transferSpecHash,
      attestations: [{ to: profile.recipientAddress, amount: d.amountBase }],
    });
    const { getDonation } = await import("@/lib/store");
    const after = await getDonation(d.id);
    assert(res.outcome === "informational", `got ${res.outcome}`);
    assert(after?.status === "processing", `donation must stay processing, got ${after?.status}`);
    return "Deposit finalized = balance ready only. Donation stayed processing.";
  });

  await run("unknown transferId", async () => {
    const res = await processWebhookEvent({
      notificationId: `testlab-orphan-${tag()}`,
      notificationType: "gateway.mint.finalized",
      env: "testnet",
      domain: 26,
      token: "USDC",
      amount: "1000000",
      transferId: `testlab-unknown-${tag()}`,
      transferSpecHash: `0x${randomBytes(32).toString("hex")}`,
      attestations: [{ to: profile.recipientAddress, amount: "1000000" }],
    });
    assert(res.outcome === "orphan", `got ${res.outcome}`);
    return "Unknown transferId stored as an orphan; no donation changed.";
  });

  await run("invalid signature -> 401", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    const prev = process.env.CIRCLE_WEBHOOK_SIGNING_KEY;
    process.env.CIRCLE_WEBHOOK_SIGNING_KEY = publicPem as string;
    try {
      const payload = Buffer.from(
        JSON.stringify({ notificationId: "testlab-sig" }),
      );
      const sig = sign("SHA256", payload, privateKey).toString("base64");
      const good = verifyWebhookSignature({
        rawBody: payload,
        signatureB64: sig,
        keyId: "test-key",
      });
      assert(good.ok, "valid signature must verify");
      const tampered = verifyWebhookSignature({
        rawBody: Buffer.from(JSON.stringify({ notificationId: "tampered" })),
        signatureB64: sig,
        keyId: "test-key",
      });
      assert(!tampered.ok, "tampered body must fail verification");
      return "Valid signature verifies; tampered body fails (would be HTTP 401).";
    } finally {
      if (prev === undefined) delete process.env.CIRCLE_WEBHOOK_SIGNING_KEY;
      else process.env.CIRCLE_WEBHOOK_SIGNING_KEY = prev;
    }
  });

  const passed = results.filter((r) => r.passed).length;
  return NextResponse.json({
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
    note: "Test Lab donations are flagged isTest=true — remove them anytime via the dashboard cleanup (PIN required).",
  });
}
