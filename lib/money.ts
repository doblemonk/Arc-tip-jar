import { AMOUNT_LIMITS, GATEWAY } from "./constants";

/** Parse a human USDC amount ("2.5" or "2,5") into integer base units. */
export function parseUsdcToBase(
  input: string,
): { ok: true; base: string } | { ok: false; error: string } {
  const normalized = input.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { ok: false, error: "Enter a number, e.g. 2.5" };
  }
  const [whole, frac = ""] = normalized.split(".");
  if (frac.length > AMOUNT_LIMITS.maxDecimals) {
    return {
      ok: false,
      error: `At most ${AMOUNT_LIMITS.maxDecimals} decimal places`,
    };
  }
  const base =
    BigInt(whole || "0") * 1_000_000n +
    BigInt((frac + "000000").slice(0, 6) || "0");
  const minBase = BigInt(
    Math.round(parseFloat(AMOUNT_LIMITS.minUsdc) * 1_000_000),
  );
  const maxBase = BigInt(
    Math.round(parseFloat(AMOUNT_LIMITS.maxUsdc) * 1_000_000),
  );
  if (base < minBase) {
    return {
      ok: false,
      error: `Minimum tip is ${AMOUNT_LIMITS.minUsdc} USDC`,
    };
  }
  if (base > maxBase) {
    return {
      ok: false,
      error: `Maximum tip is ${AMOUNT_LIMITS.maxUsdc} USDC`,
    };
  }
  return { ok: true, base: base.toString() };
}

/** Format integer base units as en-US USDC, e.g. 1000000 -> "1.00". */
export function formatBaseToUsdc(base: string | bigint): string {
  const b = typeof base === "bigint" ? base : BigInt(base);
  const whole = b / 1_000_000n;
  const frac = (b % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${wholeStr}.${frac}` : `${wholeStr}.00`;
}

/** Short display form: "1.00 USDC". */
export function formatUsdc(base: string | bigint): string {
  return `${formatBaseToUsdc(base)} USDC`;
}

/** Fee warning: true when the estimated fee is as large as the tip itself. */
export function feeIsAsLargeAsTip(amountBase: string, feeTotalUsdc: string): boolean {
  const feeBase = BigInt(
    Math.round(parseFloat(feeTotalUsdc || "0") * 1_000_000),
  );
  return feeBase >= BigInt(amountBase);
}

export function isExpired(expiresAt: string, now = Date.now()): boolean {
  return now >= new Date(expiresAt).getTime();
}

export function expiryFrom(createdAt: string): string {
  return new Date(
    new Date(createdAt).getTime() + GATEWAY.donationExpiryMs,
  ).toISOString();
}
