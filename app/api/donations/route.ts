import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/auth";
import { createDonationRecord } from "@/lib/donations";
import { parseUsdcToBase } from "@/lib/money";
import { getCreator } from "@/lib/store";

/**
 * POST /api/donations — create a donation (status awaiting_payment).
 * Body: { amountUsdc?: string, amountBase?: string, message?: string,
 *         isTest?: boolean }
 * The recipient always comes from the server creator DB, never the client.
 * Rate-limited: 10 creations per minute per IP.
 */
export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rl = rateLimit(`donations:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many donations — please wait a moment and try again." },
      { status: 429 },
    );
  }
  const creator = await getCreator();
  if (!creator) {
    return NextResponse.json(
      { error: "No creator profile yet — set one up on /creator first." },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => ({}));
  let amountBase: string;
  if (body.amountBase) {
    if (!/^\d+$/.test(String(body.amountBase))) {
      return NextResponse.json(
        { error: "amountBase must be an integer string" },
        { status: 400 },
      );
    }
    amountBase = String(body.amountBase);
  } else if (body.amountUsdc) {
    const parsed = parseUsdcToBase(String(body.amountUsdc));
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    amountBase = parsed.base;
  } else {
    return NextResponse.json(
      { error: "Provide amountUsdc or amountBase" },
      { status: 400 },
    );
  }
  const message = String(body.message ?? "").slice(0, 280);
  const { donation, estimateError } = await createDonationRecord({
    amountBase,
    message,
    creator,
    isTest: body.isTest === true,
  });
  return NextResponse.json({
    donation,
    estimateError,
    feeNote:
      "Fee estimate is live from Gateway /v1/estimate (Arc Testnet, domain 26 -> 26).",
  });
}
