import { NextResponse } from "next/server";
import { hashPin } from "@/lib/auth";
import { isAddress } from "@/lib/gateway";
import { getCreator, saveCreator } from "@/lib/store";
import type { CreatorProfile } from "@/lib/types";

/** GET /api/creator — public creator profile (no PIN, ever). */
export async function GET() {
  const creator = await getCreator();
  if (!creator) {
    return NextResponse.json({ creator: null });
  }
  const { pinHash: _pinHash, ...pub } = creator;
  return NextResponse.json({ creator: pub });
}

/**
 * POST /api/creator — set up (or replace) the creator profile.
 * Body: { name, description?, avatarUrl?, thankYouMessage?, recipientAddress,
 *         pin? }
 * The recipient address is the Arc Testnet address that receives every tip.
 * If DASHBOARD_PIN is set in the environment it stays authoritative and the
 * in-app PIN is ignored (the response says so).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const recipientAddress = String(body.recipientAddress ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!isAddress(recipientAddress)) {
    return NextResponse.json(
      { error: "recipientAddress must be a valid 0x address (Arc Testnet)" },
      { status: 400 },
    );
  }
  const pin = String(body.pin ?? "").trim();
  const now = new Date().toISOString();
  const existing = await getCreator();
  const profile: CreatorProfile = {
    name,
    description: String(body.description ?? "").trim(),
    avatarUrl: String(body.avatarUrl ?? "").trim(),
    thankYouMessage: String(body.thankYouMessage ?? "").trim(),
    recipientAddress,
    pinHash: pin ? hashPin(pin) : (existing?.pinHash ?? null),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await saveCreator(profile);
  const { pinHash: _pinHash, ...pub } = profile;
  return NextResponse.json({
    creator: pub,
    pinFromEnv: Boolean(process.env.DASHBOARD_PIN),
    note: process.env.DASHBOARD_PIN
      ? "Dashboard PIN comes from the DASHBOARD_PIN environment variable; the in-app PIN was not stored."
      : pin
        ? "Dashboard PIN saved (hashed)."
        : "No dashboard PIN set — set one in the creator setup form or via DASHBOARD_PIN.",
  });
}
