import { createHash, timingSafeEqual } from "crypto";
import type { CreatorProfile } from "./types";

export function hashPin(pin: string): string {
  return createHash("sha256").update(pin, "utf8").digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Dashboard PIN check.
 * If DASHBOARD_PIN is set in the environment it is authoritative.
 * Otherwise the PIN chosen in the in-app creator setup (stored hashed) is used.
 * Returns false when no PIN is configured anywhere.
 */
export async function verifyDashboardPin(
  pin: string,
  creator: CreatorProfile | null,
): Promise<boolean> {
  if (!pin) return false;
  const envPin = process.env.DASHBOARD_PIN;
  if (envPin) return safeEqual(pin, envPin);
  if (creator?.pinHash) return safeEqual(hashPin(pin), creator.pinHash);
  return false;
}

export function isDashboardPinConfigured(
  creator: CreatorProfile | null,
): boolean {
  return Boolean(process.env.DASHBOARD_PIN || creator?.pinHash);
}

// --- tiny in-memory rate limiter (per key, fixed window) -------------------

const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    return { ok: false, retryAfterMs: windowMs - (now - list[0]) };
  }
  list.push(now);
  hits.set(key, list);
  return { ok: true, retryAfterMs: 0 };
}
