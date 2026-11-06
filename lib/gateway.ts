import { ethers } from "ethers";
import {
  ARC_TESTNET,
  ARC_USDC_ADDRESS,
  EIP712_DOMAIN,
  GATEWAY,
} from "./constants";
import type {
  ArcDomainInfo,
  BurnIntent,
  EstimateResult,
  GatewayInfo,
  TransferSpec,
} from "./types";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x" + "00".repeat(32);

/** Left-pad a canonical 20-byte address to bytes32. */
export function toBytes32(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new Error(`Invalid EVM address for bytes32 padding: ${address}`);
  }
  return "0x" + "00".repeat(12) + clean;
}

/** Right-trim a bytes32 value back to a canonical 20-byte address. */
export function fromBytes32(bytes32: string): string {
  const clean = bytes32.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(clean)) return bytes32;
  return "0x" + clean.slice(24);
}

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function randomSalt(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

// ---------------------------------------------------------------------------
// Live Gateway info (GET /v1/info) — contract addresses are read live,
// never hardcoded. Only the token SYMBOL list comes from /v1/info; the Arc
// USDC token address itself is Circle's documented address (see constants).
// ---------------------------------------------------------------------------

let infoCache: { at: number; info: GatewayInfo } | null = null;

export async function fetchGatewayInfo(): Promise<GatewayInfo> {
  const now = Date.now();
  if (infoCache && now - infoCache.at < 60_000) return infoCache.info;
  const res = await fetch(`${GATEWAY.apiBase}/v1/info`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Gateway /v1/info failed: HTTP ${res.status}`);
  }
  const info = (await res.json()) as GatewayInfo;
  infoCache = { at: now, info };
  return info;
}

export async function getArcDomain(): Promise<ArcDomainInfo> {
  const info = await fetchGatewayInfo();
  const arc = info.domains.find(
    (d) => d.domain === GATEWAY.domain && d.chain === "Arc",
  );
  if (!arc) throw new Error("Arc Testnet (Gateway domain 26) not in /v1/info");
  const supportedTokens = arc.walletContract?.supportedTokens ?? [];
  if (!supportedTokens.includes(GATEWAY.tokenSymbol)) {
    throw new Error("USDC is not a supported token on Arc Testnet per /v1/info");
  }
  return {
    chain: arc.chain,
    network: arc.network,
    domain: arc.domain,
    walletContract: arc.walletContract.address,
    minterContract: arc.minterContract.address,
    supportedTokens,
    processedHeight: arc.processedHeight,
    burnIntentExpirationHeight: arc.burnIntentExpirationHeight,
  };
}

// ---------------------------------------------------------------------------
// EIP-712 burn intent (GatewayWallet v1)
// ---------------------------------------------------------------------------

export const TRANSFER_SPEC_TYPE =
  "TransferSpec(uint32 version,uint32 sourceDomain,uint32 destinationDomain," +
  "bytes32 sourceContract,bytes32 destinationContract,bytes32 sourceToken," +
  "bytes32 destinationToken,bytes32 sourceDepositor,bytes32 destinationRecipient," +
  "bytes32 sourceSigner,bytes32 destinationCaller,uint256 value,bytes32 salt,bytes hookData)";

export const EIP712_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

/**
 * keccak256 hash of the TransferSpec, exactly as Circle computes
 * `transferSpecHash` — and as the on-chain GatewayWallet uses it as the
 * cross-chain id / replay key.
 *
 * This is NOT the EIP-712 struct hash used for signing. Circle's
 * TransferSpec has a custom abi.encodePacked layout (see
 * circlefin/evm-gateway-contracts, src/lib/TransferSpecLib.sol):
 *   magic bytes4 0xca85def7 (= bytes4(keccak256("circle.gateway.TransferSpec")))
 *   version uint32, sourceDomain uint32, destinationDomain uint32,
 *   sourceContract/destinationContract/sourceToken/destinationToken/
 *   sourceDepositor/destinationRecipient/sourceSigner/destinationCaller
 *   (bytes32 each), value uint256, salt bytes32,
 *   hookDataLength uint32, hookData bytes.
 * Verified against a live estimate response (see tests/intent.test.ts).
 */
export function hashTransferSpec(spec: TransferSpec): string {
  const hookBytes = ethers.getBytes(spec.hookData);
  const packed = ethers.solidityPacked(
    [
      "bytes4",
      "uint32",
      "uint32",
      "uint32",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
      "uint256",
      "bytes32",
      "uint32",
      "bytes",
    ],
    [
      "0xca85def7",
      spec.version,
      spec.sourceDomain,
      spec.destinationDomain,
      spec.sourceContract,
      spec.destinationContract,
      spec.sourceToken,
      spec.destinationToken,
      spec.sourceDepositor,
      spec.destinationRecipient,
      spec.sourceSigner,
      spec.destinationCaller,
      spec.value,
      spec.salt,
      hookBytes.length,
      spec.hookData,
    ],
  );
  return ethers.keccak256(packed);
}

export function buildSpec(args: {
  depositor: string;
  recipient: string;
  valueBase: string;
  salt: string;
  walletContract: string;
  minterContract: string;
}): TransferSpec {
  return {
    version: 1,
    sourceDomain: GATEWAY.domain,
    destinationDomain: GATEWAY.domain,
    sourceContract: toBytes32(args.walletContract),
    destinationContract: toBytes32(args.minterContract),
    sourceToken: toBytes32(ARC_USDC_ADDRESS),
    destinationToken: toBytes32(ARC_USDC_ADDRESS),
    sourceDepositor: toBytes32(args.depositor),
    destinationRecipient: toBytes32(args.recipient),
    sourceSigner: toBytes32(args.depositor),
    destinationCaller: ZERO_BYTES32,
    value: args.valueBase,
    salt: args.salt,
    hookData: "0x",
  };
}

export function buildBurnIntent(args: {
  spec: TransferSpec;
  maxFeeBase: string;
  maxBlockHeight: string;
}): { burnIntent: BurnIntent; typedData: unknown } {
  const burnIntent: BurnIntent = {
    maxBlockHeight: args.maxBlockHeight,
    maxFee: args.maxFeeBase,
    spec: args.spec,
  };
  const typedData = {
    domain: { ...EIP712_DOMAIN },
    types: EIP712_TYPES,
    primaryType: "BurnIntent",
    message: burnIntent,
  };
  return { burnIntent, typedData };
}

/** Recover the signer of a burn-intent signature (throws on bad input). */
export function recoverIntentSigner(
  burnIntent: BurnIntent,
  signature: string,
): string {
  return ethers.verifyTypedData(
    { ...EIP712_DOMAIN },
    EIP712_TYPES as never,
    burnIntent as never,
    signature,
  );
}

// ---------------------------------------------------------------------------
// Live fee estimate (POST /v1/estimate?enableForwarder=true)
// The estimate request is an array of partial burn intents; every address
// in the spec must be bytes32-padded and destinationCaller is required.
// ---------------------------------------------------------------------------

export async function estimateFee(args: {
  amountBase: string;
  depositor: string;
  recipient: string;
}): Promise<EstimateResult> {
  const arc = await getArcDomain();
  const spec = buildSpec({
    depositor: args.depositor,
    recipient: args.recipient,
    valueBase: args.amountBase,
    salt: randomSalt(),
    walletContract: arc.walletContract,
    minterContract: arc.minterContract,
  });
  const res = await fetch(
    `${GATEWAY.apiBase}/v1/estimate?enableForwarder=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ spec }]),
      cache: "no-store",
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.body?.[0]?.burnIntent) {
    const msg =
      body?.message || `Gateway /v1/estimate failed: HTTP ${res.status}`;
    throw new Error(msg);
  }
  const intent = body.body[0].burnIntent;
  const fees = body.fees ?? {};
  const s = intent.spec;
  return {
    maxFeeBase: String(intent.maxFee),
    feeTotalUsdc: String(fees.total ?? "0"),
    forwardingFeeUsdc:
      fees.forwardingFee != null ? String(fees.forwardingFee) : null,
    maxBlockHeight: String(intent.maxBlockHeight),
    transferSpecHash: String(body.body[0].burnIntent
      ? fees.perIntent?.[0]?.transferSpecHash ?? hashTransferSpec(spec)
      : hashTransferSpec(spec)),
    spec: {
      sourceDomain: s.sourceDomain,
      destinationDomain: s.destinationDomain,
      sourceContract: s.sourceContract,
      destinationContract: s.destinationContract,
      sourceToken: s.sourceToken,
      destinationToken: s.destinationToken,
      sourceDepositor: s.sourceDepositor,
      destinationRecipient: s.destinationRecipient,
      sourceSigner: s.sourceSigner,
      destinationCaller: s.destinationCaller,
      value: String(s.value),
      salt: s.salt,
    },
  };
}

// ---------------------------------------------------------------------------
// Real transfer submission — ONLY when a Circle API key is configured.
// ---------------------------------------------------------------------------

export async function submitTransfer(args: {
  burnIntent: BurnIntent;
  signature: string;
  apiKey: string;
}): Promise<{ transferId: string; raw: unknown }> {
  const res = await fetch(
    `${GATEWAY.apiBase}/v1/transfer?enableForwarder=true`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify([
        { burnIntent: args.burnIntent, signature: args.signature },
      ]),
      cache: "no-store",
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.message || `Gateway /v1/transfer failed: HTTP ${res.status}`,
    );
  }
  const first = Array.isArray(body) ? body[0] : body;
  const transferId =
    first?.transferId ?? first?.transfer?.transferId ?? first?.id;
  if (!transferId) {
    throw new Error("Gateway /v1/transfer returned no transferId");
  }
  return { transferId: String(transferId), raw: body };
}

/** Poll Gateway for a transfer's status (needs a Circle API key). */
export async function getTransfer(args: {
  transferId: string;
  apiKey: string;
}): Promise<{ status: string; raw: unknown }> {
  const res = await fetch(
    `${GATEWAY.apiBase}/v1/transfer/${encodeURIComponent(args.transferId)}`,
    {
      headers: { Authorization: `Bearer ${args.apiKey}` },
      cache: "no-store",
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.message || `Gateway GET /v1/transfer failed: HTTP ${res.status}`,
    );
  }
  const status =
    body?.status ?? body?.transfer?.status ?? body?.state ?? "unknown";
  return { status: String(status), raw: body };
}

export { ARC_TESTNET };
