// Arc Tip Jar — hard constants. Arc Testnet ONLY. No mainnet, no Sepolia.
// Chain parameters verified against https://docs.arc.io/arc/references/rpc-endpoints
// and https://chainlist.org/chain/5042002.

export const ARC_TESTNET = {
  chainId: 5042002,
  chainIdHex: "0x4cef52",
  name: "Arc Testnet",
  rpcUrl: "https://rpc.testnet.arc.io",
  explorerUrl: "https://explorer.testnet.arc.io",
  chainListUrl: "https://chainlist.org/chain/5042002",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
} as const;

export const GATEWAY = {
  /** Circle Gateway testnet API base. Mainnet base is never used here. */
  apiBase: "https://gateway-api-testnet.circle.com",
  /** Gateway domain id for Arc Testnet. Source AND destination. */
  domain: 26,
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  /** Donation expiry: unsigned donations expire after 15 minutes. */
  donationExpiryMs: 15 * 60 * 1000,
  /** Reconcile: poll Gateway for donations in `processing` older than 60s. */
  reconcileAfterMs: 60 * 1000,
  /** Buffer added to the live burnIntentExpirationHeight for maxBlockHeight. */
  maxBlockHeightBuffer: 1000,
} as const;

/**
 * Arc Testnet USDC token address (canonical 20-byte form).
 *
 * Honest sourcing note: live GET /v1/info publishes ONLY token symbols
 * (USDC / cirBTC / EURC) per domain — it does not publish token addresses.
 * This address is Circle's documented Arc Testnet USDC address
 * (see https://developers.circle.com/stablecoins/usdc-contract-addresses.md
 * and the Gateway docs); the Gateway Wallet and Minter contract addresses
 * ARE read live from /v1/info at runtime and never hardcoded here.
 */
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";

export const EIP712_DOMAIN = {
  name: "GatewayWallet",
  version: "1",
} as const;

/** Amount limits in USDC (human units). Stored values are integer base units. */
export const AMOUNT_LIMITS = {
  minUsdc: "0.01",
  maxUsdc: "1000",
  maxDecimals: 6,
  presetsUsdc: ["1", "5", "10"],
} as const;
