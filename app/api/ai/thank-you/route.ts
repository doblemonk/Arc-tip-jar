import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/auth";
import {
  generateThankYou,
  isRiverConfigured,
  polishText,
  riverModel,
} from "@/lib/river";

/**
 * POST /api/ai/thank-you — River-powered copy.
 * Body:
 *   { mode: "thank-you", amount: "5.00 USDC", creatorName: "…",
 *     donorMessage?: "…" }
 *   { mode: "polish", text: "…", kind: "bio" | "thank-you",
 *     creatorName?: "…" }
 *
 * Live River chat completions when RIVER_API_KEY is set (model from
 * RIVER_MODEL, default deepseek-ai/DeepSeek-V4.1-Flash). Without a key the
 * response falls back to saved defaults that River itself generated
 * earlier — and says so in `note` / `source`. A live call is never faked.
 * River usage bills the account owner's River account.
 */
export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = rateLimit(`ai:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many AI requests — please wait a moment." },
      { status: 429 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const mode = body.mode === "polish" ? "polish" : "thank-you";
  try {
    if (mode === "polish") {
      const text = String(body.text ?? "").trim();
      if (!text) {
        return NextResponse.json(
          { error: "Provide text to polish" },
          { status: 400 },
        );
      }
      const kind = body.kind === "thank-you" ? "thank-you" : "bio";
      const res = await polishText({
        text,
        kind,
        creatorName: String(body.creatorName ?? "").trim() || undefined,
      });
      return NextResponse.json({
        ...res,
        live: res.source === "river-live",
        riverConfigured: isRiverConfigured(),
        model: riverModel(),
      });
    }
    const amount = String(body.amount ?? "").trim();
    const creatorName = String(body.creatorName ?? "").trim();
    if (!amount || !creatorName) {
      return NextResponse.json(
        { error: "Provide amount and creatorName" },
        { status: 400 },
      );
    }
    const res = await generateThankYou({
      amount,
      creatorName,
      donorMessage: String(body.donorMessage ?? "").trim() || undefined,
    });
    return NextResponse.json({
      ...res,
      live: res.source === "river-live",
      riverConfigured: isRiverConfigured(),
      model: riverModel(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }
}
