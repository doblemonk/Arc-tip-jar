import { createPublicKey, createVerify, type KeyObject } from "crypto";
import { GATEWAY } from "./constants";
import {
  findDonationByTransfer,
  getDonation,
  hasWebhookEvent,
  recordWebhookEvent,
  saveDonation,
} from "./store";
import type {
  Donation,
  FailureReason,
  WebhookEvent,
  WebhookEventType,
} from "./types";

// ---------------------------------------------------------------------------
// Circle Gateway webhook processing (POST /webhooks/circle).
// Canonical event shape (also what the in-app simulator sends):
//   {
//     "notificationId": "notif-…",            // stable across Circle retries
//     "notificationType": "gateway.mint.finalized",
//     "env": "testnet",                        // MUST be testnet
//     "domain": 26,                           // MUST be 26 (Arc Testnet)
//     "token": "USDC",                        // token SYMBOL, as published by
//                                             // GET /v1/info (it publishes no
//                                             // token addresses — see README)
//     "amount": "1000000",                    // integer base units (6 decimals)
//     "transferId": "…",
//     "transferSpecHash": "0x…",
//     "attestations": [{ "to": "0x…", "amount": "1000000" }]
//   }
// Tolerant aliases are accepted for env/domain/token/amount/transferId so a
// real Circle payload with a slightly different field layout still validates
// instead of failing on a field name. Validation itself is strict.
// ---------------------------------------------------------------------------

export interface ExtractedEvent {
  notificationId: string | null;
  notificationType: string | null;
  transferId: string | null;
  transferSpecHash: string | null;
  env: string | null;
  domain: number | null;
  token: string | null;
  amount: string | null;
  attestations: { to: string; amount: string | null }[];
}

export function extractEventFields(raw: unknown): ExtractedEvent {
  const p = (raw ?? {}) as Record<string, any>;
  const nested = (p.data ?? p.payload ?? p.event ?? {}) as Record<string, any>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      if (p[k] !== undefined && p[k] !== null) return p[k];
      if (nested[k] !== undefined && nested[k] !== null) return nested[k];
    }
    return null;
  };
  const transfer = (p.transfer ?? nested.transfer ?? {}) as Record<
    string,
    any
  >;
  const attestRaw =
    pick("attestations") ??
    (p.attestation ? [p.attestation] : null) ??
    (transfer.attestations ?? null) ??
    [];
  const attestations = (Array.isArray(attestRaw) ? attestRaw : []).map(
    (a: any) => ({
      to: String(a?.to ?? a?.recipient ?? a?.destinationRecipient ?? ""),
      amount:
        a?.amount != null ? String(a.amount) : null,
    }),
  );
  const domainRaw = pick("domain", "domainId", "destinationDomain");
  return {
    notificationId: pick("notificationId", "id") != null ? String(pick("notificationId", "id")) : null,
    notificationType:
      pick("notificationType", "type") != null
        ? String(pick("notificationType", "type"))
        : null,
    transferId:
      pick("transferId") ?? transfer.transferId ?? transfer.id ?? null,
    transferSpecHash:
      pick("transferSpecHash", "specHash") != null
        ? String(pick("transferSpecHash", "specHash"))
        : null,
    env: pick("env", "environment") != null ? String(pick("env", "environment")) : null,
    domain: domainRaw != null ? Number(domainRaw) : null,
    token:
      pick("token", "tokenSymbol") != null
        ? String(pick("token", "tokenSymbol"))
        : null,
    amount:
      pick("amount", "mintAmount", "value") != null
        ? String(pick("amount", "mintAmount", "value"))
        : null,
    attestations,
  };
}

const KNOWN_GATEWAY_TYPES = [
  "gateway.deposit.finalized",
  "gateway.mint.finalized",
  "gateway.mint.forwarded",
] as const;

/**
 * True when a payload is not a recognizable Gateway event: no
 * notificationId, or a notificationType outside the three Gateway types.
 * Circle's subscription-validation probe falls here; the public route
 * answers it 200 (ignored) instead of 400 so the subscription can be
 * created. Changes no state.
 */
export function isIgnorableWebhookPayload(raw: unknown): boolean {
  const ev = extractEventFields(raw);
  if (!ev.notificationId) return true;
  return !(KNOWN_GATEWAY_TYPES as readonly string[]).includes(
    ev.notificationType as string,
  );
}

/**
 * Validate a mint.finalized event against a donation + creator.
 * Returns null when the event is valid, otherwise the failure reason.
 * Order matters: env and domain are checked before token/amount/recipient,
 * matching the blueprint's failure-reason priority.
 */
export function validateMintFinalized(args: {
  ev: ExtractedEvent;
  donation: Donation;
  creatorRecipient: string;
}): FailureReason | null {
  const { ev, donation, creatorRecipient } = args;
  if (ev.env !== "testnet") return "WRONG_ENV";
  if (ev.domain !== GATEWAY.domain) return "WRONG_DOMAIN";
  if (ev.token !== GATEWAY.tokenSymbol) return "TOKEN_MISMATCH";
  if (ev.amount !== null && ev.amount !== donation.amountBase) {
    return "AMOUNT_MISMATCH";
  }
  if (ev.attestations.length > 0) {
    const ok = ev.attestations.some(
      (a) => a.to.toLowerCase() === creatorRecipient.toLowerCase(),
    );
    if (!ok) return "RECIPIENT_MISMATCH";
  }
  return null;
}

export interface ProcessResult {
  httpStatus: 200 | 400;
  outcome:
    | "applied"
    | "duplicate"
    | "orphan"
    | "informational"
    | "already_final"
    | "rejected";
  donationId: number | null;
  detail: string;
}

/**
 * Process one webhook event through the same logic the real endpoint and
 * the simulator share. Always returns 200 for valid events (including
 * duplicates) so Circle does not retry. Final donation states never change.
 */
export async function processWebhookEvent(
  raw: unknown,
): Promise<ProcessResult> {
  const ev = extractEventFields(raw);
  const now = new Date().toISOString();

  if (!ev.notificationId) {
    return {
      httpStatus: 400,
      outcome: "rejected",
      donationId: null,
      detail: "Missing notificationId — cannot deduplicate, event rejected.",
    };
  }
  const type = ev.notificationType as WebhookEventType | null;
  if (
    type !== "gateway.deposit.finalized" &&
    type !== "gateway.mint.finalized" &&
    type !== "gateway.mint.forwarded"
  ) {
    return {
      httpStatus: 400,
      outcome: "rejected",
      donationId: null,
      detail: `Unknown notificationType: ${ev.notificationType}`,
    };
  }

  const record = async (
    outcome: WebhookEvent["outcome"],
    donationId: number | null,
    detail: string,
  ) => {
    await recordWebhookEvent({
      notificationId: ev.notificationId as string,
      notificationType: type,
      receivedAt: now,
      donationId,
      transferId: ev.transferId,
      transferSpecHash: ev.transferSpecHash,
      outcome,
      detail,
      raw,
    });
  };

  // Idempotency first: same notificationId twice must change nothing.
  if (await hasWebhookEvent(ev.notificationId)) {
    return {
      httpStatus: 200,
      outcome: "duplicate",
      donationId: null,
      detail: `Duplicate notificationId ${ev.notificationId} — ignored, nothing changed.`,
    };
  }

  if (type === "gateway.deposit.finalized") {
    await record(
      "informational",
      null,
      "Deposit finalized: Gateway balance is ready. This is NOT a tip received.",
    );
    return {
      httpStatus: 200,
      outcome: "informational",
      donationId: null,
      detail:
        "Deposit finalized — Gateway balance ready. No donation was marked received.",
    };
  }

  if (type === "gateway.mint.forwarded") {
    await record(
      "informational",
      null,
      "Mint forwarded: informational only, never finalizes a donation.",
    );
    return {
      httpStatus: 200,
      outcome: "informational",
      donationId: null,
      detail: "Mint forwarded — informational only, no donation finalized.",
    };
  }

  // gateway.mint.finalized
  const donation = await findDonationByTransfer(
    ev.transferId,
    ev.transferSpecHash,
  );
  if (!donation) {
    await record(
      "orphan",
      null,
      `No donation matches transferId ${ev.transferId ?? "(none)"} / spec hash ${ev.transferSpecHash ?? "(none)"} — stored as orphan, nothing changed.`,
    );
    return {
      httpStatus: 200,
      outcome: "orphan",
      donationId: null,
      detail:
        "Unknown transferId — stored as an orphan. No donation was changed.",
    };
  }

  if (donation.status === "received" || donation.status === "failed") {
    await record(
      "duplicate",
      donation.id,
      `Donation #${donation.id} is already ${donation.status} (final) — event ignored.`,
    );
    return {
      httpStatus: 200,
      outcome: "already_final",
      donationId: donation.id,
      detail: `Donation #${donation.id} is already ${donation.status} (final state, never changes).`,
    };
  }

  const reason = validateMintFinalized({
    ev,
    donation,
    creatorRecipient: donation.recipientAddress,
  });
  if (reason) {
    const failed: Donation = {
      ...donation,
      status: "failed",
      failureReason: reason,
      needsManualReview:
        reason === "AMOUNT_MISMATCH" ||
        reason === "TOKEN_MISMATCH" ||
        reason === "RECIPIENT_MISMATCH",
      updatedAt: now,
    };
    await saveDonation(failed);
    await record(
      "applied",
      donation.id,
      `Donation #${donation.id} failed: ${reason}. Flagged for manual review — funds may already be minted.`,
    );
    return {
      httpStatus: 200,
      outcome: "applied",
      donationId: donation.id,
      detail: `Donation #${donation.id} failed: ${reason}.`,
    };
  }

  const received: Donation = {
    ...donation,
    status: "received",
    updatedAt: now,
  };
  await saveDonation(received);
  await record(
    "applied",
    donation.id,
    `Donation #${donation.id} received.`,
  );
  return {
    httpStatus: 200,
    outcome: "applied",
    donationId: donation.id,
    detail: `Donation #${donation.id} received.`,
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification (X-Circle-Signature, ECDSA SHA-256 over the
// raw body). The public key comes from one of two places, in order:
//   1. CIRCLE_WEBHOOK_SIGNING_KEY (PEM) — an explicit override, kept for
//      tests and manual setups.
//   2. Circle's public-key endpoint GET /v2/notifications/publicKey/{keyId}
//      (Bearer CIRCLE_API_KEY), using the X-Circle-Key-Id header. A key is
//      static per keyId, so it is fetched once and cached in memory.
// Verification is SKIPPED (dev mode) only when no key material exists at
// all — no PEM, and no API key to fetch with. Whenever verification is
// possible it is enforced: a missing signature/keyId, an unresolvable key,
// or an invalid signature is rejected (401). The caller must log a skip
// clearly and never claim the event was verified.
// ---------------------------------------------------------------------------

// Cache of Circle public keys by keyId (module-level; a key is static per
// keyId, so one fetch suffices until it rotates).
const circlePublicKeyCache = new Map<string, KeyObject>();

async function getCirclePublicKey(keyId: string): Promise<KeyObject | null> {
  const cached = circlePublicKeyCache.get(keyId);
  if (cached) return cached;
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://api.circle.com/v2/notifications/publicKey/${encodeURIComponent(keyId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { publicKey?: unknown; algorithm?: unknown };
    };
    const b64 = json?.data?.publicKey;
    if (typeof b64 !== "string" || !b64) return null;
    const key = createPublicKey({
      key: Buffer.from(b64, "base64"),
      format: "der",
      type: "spki",
    });
    circlePublicKeyCache.set(keyId, key);
    return key;
  } catch {
    return null;
  }
}

function verifyWithKey(
  args: { rawBody: Buffer; signatureB64: string; keyId: string | null },
  key: KeyObject | string,
  source: string,
): { ok: boolean; skipped: boolean; reason: string } {
  try {
    const verifier = createVerify("SHA256");
    verifier.update(args.rawBody);
    const ok = verifier.verify(
      key,
      Buffer.from(args.signatureB64, "base64"),
    );
    return {
      ok,
      skipped: false,
      reason: ok
        ? `Signature verified (${source}, key id ${args.keyId ?? "unknown"}).`
        : "Signature verification failed.",
    };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      reason: `Signature verification error: ${(err as Error).message}`,
    };
  }
}

export async function verifyWebhookSignature(args: {
  rawBody: Buffer;
  signatureB64: string | null;
  keyId: string | null;
}): Promise<{ ok: boolean; skipped: boolean; reason: string }> {
  const pemRaw = process.env.CIRCLE_WEBHOOK_SIGNING_KEY;
  const apiKey = process.env.CIRCLE_API_KEY;

  // Production path: with a Circle API key we can always fetch the public
  // key for the event's keyId, so verification is enforced — a missing
  // signature/keyId or an unresolvable key is a rejection, not a skip.
  if (!pemRaw && apiKey) {
    if (!args.signatureB64) {
      return {
        ok: false,
        skipped: false,
        reason: "Missing X-Circle-Signature header.",
      };
    }
    if (!args.keyId) {
      return {
        ok: false,
        skipped: false,
        reason: "Missing X-Circle-Key-Id header.",
      };
    }
    const key = await getCirclePublicKey(args.keyId);
    if (!key) {
      return {
        ok: false,
        skipped: false,
        reason: `Could not fetch Circle public key for key id ${args.keyId}.`,
      };
    }
    return verifyWithKey(
      { ...args, signatureB64: args.signatureB64 },
      key,
      `Circle public key ${args.keyId}`,
    );
  }

  // Explicit PEM override (tests, manual setups).
  if (pemRaw) {
    if (!args.signatureB64) {
      return {
        ok: false,
        skipped: false,
        reason: "Missing X-Circle-Signature header.",
      };
    }
    return verifyWithKey(
      { ...args, signatureB64: args.signatureB64 },
      pemRaw.replace(/\\n/g, "\n"),
      "configured signing key",
    );
  }

  // No key material at all (development mode).
  return {
    ok: false,
    skipped: true,
    reason:
      "No signing key available — signature verification skipped (development mode).",
  };
}

export async function getDonationById(id: number): Promise<Donation | null> {
  return getDonation(id);
}
