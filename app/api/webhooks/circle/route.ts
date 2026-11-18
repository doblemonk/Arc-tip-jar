import { NextResponse } from "next/server";
import {
  isIgnorableWebhookPayload,
  processWebhookEvent,
  verifyWebhookSignature,
} from "@/lib/webhook";

/**
 * POST /api/webhooks/circle — Circle Gateway webhook endpoint.
 * Subscribe via Circle (environment TEST, domains ["26"], the creator's
 * addresses, notificationTypes gateway.deposit.finalized +
 * gateway.mint.finalized) and point it at:
 *   https://<your-domain>/api/webhooks/circle
 *
 * HEAD is required too: Circle validates the endpoint URL with a HEAD
 * request when a subscription is created or updated, and rejects the
 * subscription if it does not answer 2XX. (Without this handler the
 * route answered 405 and no subscription could be created.)
 * GET answers a small status object for manual checks; it never
 * processes events.
 *
 * Signature: the X-Circle-Signature header (ECDSA SHA-256 over the raw
 * body) is verified against Circle's public key for the X-Circle-Key-Id,
 * fetched once from GET /v2/notifications/publicKey/{keyId} and cached;
 * CIRCLE_WEBHOOK_SIGNING_KEY (PEM) is an optional override. Verification
 * is enforced whenever a key can be resolved — an invalid or missing
 * signature is rejected with 401. It is skipped only when no key material
 * exists at all (development mode), and the response says so plainly.
 * Always 200 for valid events, including duplicates.
 */
export async function HEAD() {
  return new Response(null, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "circle-webhook" });
}

export async function POST(req: Request) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON" },
      { status: 400 },
    );
  }
  // Payloads that are not recognizable Gateway events — no notificationId,
  // or a notificationType outside the three Gateway types — get a plain
  // 200 and change nothing. Circle's subscription-validation probe falls
  // here, and it only accepts 2XX. This runs before signature
  // verification on purpose: the probe is unsigned, and a 401 here would
  // make subscription creation fail even after the signing key is set.
  // Real Gateway events still go through verification below.
  if (isIgnorableWebhookPayload(payload)) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const signature = req.headers.get("x-circle-signature");
  const keyId = req.headers.get("x-circle-key-id");
  const check = await verifyWebhookSignature({
    rawBody,
    signatureB64: signature,
    keyId,
  });
  if (!check.skipped && !check.ok) {
    return NextResponse.json(
      { error: "Invalid webhook signature", detail: check.reason },
      { status: 401 },
    );
  }
  if (check.skipped) {
    console.warn(
      "[webhook] Signature verification skipped — no signing key available (development mode).",
    );
  }
  const result = await processWebhookEvent(payload);
  return NextResponse.json(
    {
      outcome: result.outcome,
      donationId: result.donationId,
      detail: result.detail,
      signatureVerified: !check.skipped,
      signatureNote: check.reason,
    },
    { status: result.httpStatus },
  );
}
