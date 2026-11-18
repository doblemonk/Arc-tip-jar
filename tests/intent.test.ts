import { describe, expect, it } from "vitest";
import {
  applyFeeMargin,
  buildBurnIntent,
  buildSpec,
  fromBytes32,
  hashTransferSpec,
  toBytes32,
  ZERO_BYTES32,
} from "../lib/gateway";
import { GATEWAY } from "../lib/constants";

const WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const DONOR = "0xCfc8A7C5227e078ef5FeAA3d0DE9457B479b6aBd";
const SALT = "0x" + "00".repeat(31) + "01";

describe("address padding", () => {
  it("pads a 20-byte address to bytes32 and back", () => {
    const padded = toBytes32(DONOR);
    expect(padded).toBe(
      "0x000000000000000000000000cfc8a7c5227e078ef5feaa3d0de9457b479b6abd",
    );
    expect(fromBytes32(padded)).toBe(DONOR.toLowerCase());
  });

  it("rejects a non-address", () => {
    expect(() => toBytes32("USDC")).toThrow();
    expect(() => toBytes32("0x1234")).toThrow();
  });
});

describe("burn intent spec", () => {
  it("is Arc Testnet end-to-end: sourceDomain 26 -> destinationDomain 26", () => {
    const spec = buildSpec({
      depositor: DONOR,
      recipient: DONOR,
      valueBase: "1000000",
      salt: SALT,
      walletContract: WALLET,
      minterContract: MINTER,
    });
    expect(spec.sourceDomain).toBe(26);
    expect(spec.destinationDomain).toBe(26);
    expect(spec.sourceDomain).toBe(GATEWAY.domain);
    // No Sepolia anywhere: domain 0 must never appear.
    expect(spec.sourceDomain).not.toBe(0);
    expect(spec.destinationDomain).not.toBe(0);
    expect(spec.sourceToken).toBe(toBytes32(ARC_USDC));
    expect(spec.destinationToken).toBe(toBytes32(ARC_USDC));
    expect(spec.destinationCaller).toBe(ZERO_BYTES32);
  });

  it("hashes the TransferSpec exactly like Circle's live estimate", () => {
    // Ground truth: live POST /v1/estimate (enableForwarder=true) for this
    // exact spec returned transferSpecHash
    // 0x7f8b8e25bdcd081c3f6c237e027306496919ef4a038a43fed1455dd2fd615c29
    // (verified 2026-11-05, domain 26 -> 26, value 1,000,000 base units).
    const spec = buildSpec({
      depositor: DONOR,
      recipient: DONOR,
      valueBase: "1000000",
      salt: SALT,
      walletContract: WALLET,
      minterContract: MINTER,
    });
    expect(hashTransferSpec(spec)).toBe(
      "0x7f8b8e25bdcd081c3f6c237e027306496919ef4a038a43fed1455dd2fd615c29",
    );
  });

  it("sends wallets an explicit EIP712Domain type (MetaMask fix)", () => {
    // MetaMask (eth-sig-util) hashes the domain with an EMPTY type
    // ("EIP712Domain()") when no explicit EIP712Domain type is present, so
    // it signs a different digest than ethers — the server then rejects the
    // signature as not matching the donor address (seen 2026-11-18 on tips
    // #58/#63/#69). The wallet-facing typedData must carry the explicit
    // type; the server-side verify path (ethers) keeps using EIP712_TYPES
    // without it, since ethers auto-derives the domain type and rejects an
    // extra EIP712Domain entry.
    const spec = buildSpec({
      depositor: DONOR,
      recipient: DONOR,
      valueBase: "1000000",
      salt: SALT,
      walletContract: WALLET,
      minterContract: MINTER,
    });
    const { typedData } = buildBurnIntent({
      spec,
      maxFeeBase: "19854",
      maxBlockHeight: "74181140",
    });
    const td = typedData as {
      domain: { name: string; version: string };
      types: Record<string, { name: string; type: string }[]>;
      primaryType: string;
    };
    expect(td.primaryType).toBe("BurnIntent");
    expect(td.domain).toEqual({ name: "GatewayWallet", version: "1" });
    expect(td.types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "version", type: "string" },
    ]);
    expect(td.types.TransferSpec).toBeDefined();
    expect(td.types.BurnIntent).toBeDefined();
  });

  it("margins the signed maxFee cap 25% over the estimate", () => {
    // 2026-11-18: estimate maxFee 19331, transfer required 21539 (short
    // 2208, ~11%). The cap is rounded up, never down.
    expect(applyFeeMargin("19331")).toBe("24164");
    expect(applyFeeMargin("100")).toBe("125");
    expect(applyFeeMargin("0")).toBe("0");
  });
});
