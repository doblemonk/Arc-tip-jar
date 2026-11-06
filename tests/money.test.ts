import { describe, expect, it } from "vitest";
import {
  feeIsAsLargeAsTip,
  formatBaseToUsdc,
  parseUsdcToBase,
} from "../lib/money";

describe("parseUsdcToBase", () => {
  it("parses dot and comma decimals to integer base units", () => {
    expect(parseUsdcToBase("1")).toEqual({ ok: true, base: "1000000" });
    expect(parseUsdcToBase("2.5")).toEqual({ ok: true, base: "2500000" });
    expect(parseUsdcToBase("2,5")).toEqual({ ok: true, base: "2500000" });
    expect(parseUsdcToBase("0.01")).toEqual({ ok: true, base: "10000" });
    expect(parseUsdcToBase("1000")).toEqual({
      ok: true,
      base: "1000000000",
    });
  });

  it("rejects out-of-range and over-precise amounts", () => {
    expect(parseUsdcToBase("0.001").ok).toBe(false);
    expect(parseUsdcToBase("1000.01").ok).toBe(false);
    expect(parseUsdcToBase("1.1234567").ok).toBe(false);
    expect(parseUsdcToBase("abc").ok).toBe(false);
    expect(parseUsdcToBase("").ok).toBe(false);
  });
});

describe("formatBaseToUsdc", () => {
  it("formats base units as en-US USDC", () => {
    expect(formatBaseToUsdc("1000000")).toBe("1.00");
    expect(formatBaseToUsdc("2500000")).toBe("2.5");
    expect(formatBaseToUsdc("101000000")).toBe("101.00");
    expect(formatBaseToUsdc("1234567")).toBe("1.234567");
  });
});

describe("feeIsAsLargeAsTip", () => {
  it("flags the old Sepolia-era fee, not the Arc-era fee", () => {
    // ~1.016 USDC fee on a 1 USDC tip: warn.
    expect(feeIsAsLargeAsTip("1000000", "1.016")).toBe(true);
    // ~0.018 USDC fee on a 1 USDC tip: no warning.
    expect(feeIsAsLargeAsTip("1000000", "0.018479")).toBe(false);
  });
});
