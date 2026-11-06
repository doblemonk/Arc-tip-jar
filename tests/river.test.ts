import { describe, expect, it, vi } from "vitest";

describe("River fallback (no API key configured)", () => {
  it("generateThankYou returns a saved River variant, clearly labelled", async () => {
    vi.stubEnv("RIVER_API_KEY", "");
    const { generateThankYou } = await import("../lib/river");
    const res = await generateThankYou({
      amount: "5.00 USDC",
      creatorName: "Test Creator",
    });
    expect(res.source).toBe("river-saved-default");
    expect(res.text).toContain("5.00 USDC");
    expect(res.text).toContain("Test Creator");
    expect(res.text).not.toContain("{amount}");
    expect(res.text).not.toContain("{creator}");
    expect(res.note).toMatch(/not configured/i);
    vi.unstubAllEnvs();
  });

  it("polishText returns the original text unchanged without a key", async () => {
    vi.stubEnv("RIVER_API_KEY", "");
    const { polishText } = await import("../lib/river");
    const res = await polishText({
      text: "I make stuff, tip me.",
      kind: "bio",
      creatorName: "Test Creator",
    });
    expect(res.source).toBe("river-saved-default");
    expect(res.text).toBe("I make stuff, tip me.");
    expect(res.note).toMatch(/not configured/i);
    vi.unstubAllEnvs();
  });

  it("defaults to deepseek-ai/DeepSeek-V4.1-Flash, never Qwen", async () => {
    vi.stubEnv("RIVER_MODEL", "");
    const { riverModel, DEFAULT_RIVER_MODEL } = await import("../lib/river");
    expect(DEFAULT_RIVER_MODEL).toBe("deepseek-ai/DeepSeek-V4.1-Flash");
    expect(riverModel()).toBe("deepseek-ai/DeepSeek-V4.1-Flash");
    vi.unstubAllEnvs();
  });
});
