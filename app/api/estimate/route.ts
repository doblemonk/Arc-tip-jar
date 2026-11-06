import { NextResponse } from "next/server";
import { estimateFee, isAddress, ZERO_ADDRESS } from "@/lib/gateway";
import { parseUsdcToBase } from "@/lib/money";
import { getCreator } from "@/lib/store";

/**
 * POST /api/estimate — live Gateway fee estimate for a tip amount.
 * Body: { amountUsdc?: string, amountBase?: string,
 *         depositor?: string, recipient?: string }
 * Returns the real estimate error instead of a generic line when it fails.
 */
export async function POST(req: Request) {
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
  const depositor =
    body.depositor && isAddress(body.depositor)
      ? body.depositor
      : ZERO_ADDRESS;
  const creator = await getCreator();
  const recipient =
    body.recipient && isAddress(body.recipient)
      ? body.recipient
      : creator?.recipientAddress ?? ZERO_ADDRESS;
  try {
    const est = await estimateFee({ amountBase, depositor, recipient });
    return NextResponse.json({ amountBase, ...est });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, amountBase },
      { status: 502 },
    );
  }
}
