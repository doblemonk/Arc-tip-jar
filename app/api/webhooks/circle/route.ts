import { NextResponse } from "next/server";
import {
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
 * Signature: when CIRCLE_WEBHOOK_SIGNING_KEY is configured the
 * X-Circle-Signature header (ECDSA SHA-256 over the raw body) is verified
 * and an invalid signature is rejected with 401. Without a key,
 * verification is skipped (development mode) and the event is still
 * processed — the response says so plainly.
 * Always 200 for valid events, including duplicates.
 */
export async function POST(req: Request) {
  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get("x-circle-signature");
  const keyId = req.headers.get("x-circle-key-id");
  const check = verifyWebhookSignature({
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
      "[webhook] Signature verification skipped — CIRCLE_WEBHOOK_SIGNING_KEY is not configured (development mode).",
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json(
      { error: "Request body is not valid JSON" },
      { status: 400 },
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
