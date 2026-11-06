export type DonationStatus =
  | "awaiting_payment"
  | "processing"
  | "received"
  | "failed";

export type FailureReason =
  | "AMOUNT_MISMATCH"
  | "TOKEN_MISMATCH"
  | "RECIPIENT_MISMATCH"
  | "WRONG_ENV"
  | "WRONG_DOMAIN"
  | "TRANSFER_FAILED"
  | "TRANSFER_EXPIRED";

export interface CreatorProfile {
  name: string;
  description: string;
  avatarUrl: string;
  thankYouMessage: string;
  /** Arc Testnet recipient address (canonical 0x address). */
  recipientAddress: string;
  /** SHA-256 hex of the dashboard PIN chosen at setup (if no env PIN). */
  pinHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BurnIntent {
  maxBlockHeight: string;
  maxFee: string;
  spec: TransferSpec;
}

export interface TransferSpec {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  /** Bytes32-padded hex (0x + 64 hex chars). */
  sourceContract: string;
  destinationContract: string;
  sourceToken: string;
  destinationToken: string;
  sourceDepositor: string;
  destinationRecipient: string;
  sourceSigner: string;
  destinationCaller: string;
  value: string;
  salt: string;
  hookData: string;
}

export interface Donation {
  id: number;
  /** Amount in integer USDC base units (6 decimals). Never a float. */
  amountBase: string;
  message: string;
  donorAddress: string | null;
  donorChainId: number | null;
  status: DonationStatus;
  failureReason: FailureReason | null;
  needsManualReview: boolean;
  /** Unique per-donation salt (bytes32 hex). Regenerated on every prepare. */
  salt: string;
  maxFeeBase: string | null;
  feeTotalUsdc: string | null;
  maxBlockHeight: string | null;
  transferId: string | null;
  /** True only when Circle's API actually returned this transferId. */
  transferSubmitted: boolean;
  transferSpecHash: string | null;
  walletSignature: string | null;
  /** True when the signature was the clearly-labelled simulated fallback. */
  simulated: boolean;
  recipientAddress: string;
  createdAt: string;
  expiresAt: string;
  signedAt: string | null;
  updatedAt: string;
  /** True for Test Lab throwaway donations (excluded from real totals). */
  isTest: boolean;
}

export type WebhookEventType =
  | "gateway.deposit.finalized"
  | "gateway.mint.finalized"
  | "gateway.mint.forwarded";

export interface WebhookEvent {
  notificationId: string;
  notificationType: WebhookEventType;
  receivedAt: string;
  /** Donation id it was correlated to, or null for orphans. */
  donationId: number | null;
  transferId: string | null;
  transferSpecHash: string | null;
  /** "applied" | "duplicate" | "orphan" | "informational" | "rejected" */
  outcome: string;
  detail: string;
  raw: unknown;
}

export interface GatewayDomainInfo {
  chain: string;
  network: string;
  domain: number;
  /** Live /v1/info nests tokens under the contracts — there is NO
   * top-level `supportedTokens` on a domain. */
  walletContract: { address: string; supportedTokens: string[] };
  minterContract: { address: string; supportedTokens: string[] };
  processedHeight: string;
  burnIntentExpirationHeight: string;
}

/** Normalized Arc domain info (flat addresses) for internal use. */
export interface ArcDomainInfo {
  chain: string;
  network: string;
  domain: number;
  walletContract: string;
  minterContract: string;
  supportedTokens: string[];
  processedHeight: string;
  burnIntentExpirationHeight: string;
}

export interface GatewayInfo {
  version: number;
  domains: GatewayDomainInfo[];
}

export interface EstimateResult {
  maxFeeBase: string;
  feeTotalUsdc: string;
  forwardingFeeUsdc: string | null;
  maxBlockHeight: string;
  transferSpecHash: string;
  /** The estimate response's spec in canonical (20-byte) address form. */
  spec: {
    sourceDomain: number;
    destinationDomain: number;
    sourceContract: string;
    destinationContract: string;
    sourceToken: string;
    destinationToken: string;
    sourceDepositor: string;
    destinationRecipient: string;
    sourceSigner: string;
    destinationCaller: string;
    value: string;
    salt: string;
  };
}
