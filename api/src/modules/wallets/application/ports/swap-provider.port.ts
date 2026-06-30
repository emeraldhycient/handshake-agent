/**
 * DI token and port contract for the crypto-to-crypto swap provider.
 *
 * Blockradar is the concrete adapter at launch (USDT↔TRX on TRON).
 * The execution engine depends only on this interface so the provider can be
 * swapped without touching callers (clean-arch §4.1 — application never imports
 * infrastructure).
 *
 * Invariant (root CLAUDE.md §3.1): `getQuote` returns a quote only; `execute`
 * initiates the swap and returns a pending handle. The deterministic engine
 * is the ONLY caller of `execute` — after PIN + step-up auth.
 */
export const SWAP_PROVIDER = Symbol('SWAP_PROVIDER');

// ---------------------------------------------------------------------------
// getQuote
// ---------------------------------------------------------------------------

export interface GetSwapQuoteInput {
  /** Provider-scoped child address id (providerReference on WalletRecord). */
  addressId: string;
  /** Provider-specific asset id for the from-asset (from AssetRegistry.assetProviderId). */
  fromAssetId: string;
  /** Provider-specific asset id for the to-asset (from AssetRegistry.assetProviderId). */
  toAssetId: string;
  /** Human-scaled amount of fromAsset to swap (decimal string, e.g. "100"). */
  amount: string;
  /**
   * Optional swap order direction. Providers may use this to quote in either
   * "buy" (fix toAmount) or "sell" (fix fromAmount) direction.
   * Defaults to provider-defined behaviour when absent.
   */
  order?: string;
}

export interface GetSwapQuoteOutput {
  /** Estimated amount of toAsset to receive (decimal string). */
  toAmount: string;
  /** Effective exchange rate: 1 fromAsset = rate toAsset (decimal string). */
  rate: string;
  /** Minimum fromAsset amount the provider accepts for this swap pair (decimal string). */
  minAmount: string;
  /** Price slippage tolerance in basis points (0 = no reported slippage). */
  slippage: number;
  /** On-chain network fee in fromAsset (decimal string, e.g. "1"). */
  networkFee: string;
  /** Provider transaction fee in fromAsset (decimal string, e.g. "0.5"). */
  transactionFee: string;
  /** Estimated time to credit toAsset, in seconds. */
  estimatedArrivalSec: number;
}

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------

export interface ExecuteSwapInput {
  /** Provider-scoped child address id (providerReference on WalletRecord). */
  addressId: string;
  /** Provider-specific asset id for the from-asset. */
  fromAssetId: string;
  /** Provider-specific asset id for the to-asset. */
  toAssetId: string;
  /** Human-scaled amount of fromAsset to swap (decimal string). */
  amount: string;
  /**
   * Caller-supplied idempotency reference. Blockradar echoes this as the
   * `reference` field and uses it to deduplicate concurrent or retried swap
   * calls. MUST be unique per swap attempt and stable for retries.
   */
  reference: string;
  /** Optional swap order direction (mirrors getQuote). */
  order?: string;
}

export interface ExecuteSwapOutput {
  /** Provider-assigned swap id. Used to correlate webhook settlement. */
  providerSwapId: string;
  /**
   * Initial lifecycle status returned synchronously. Blockradar returns PENDING
   * immediately; the final status (SUCCESS | FAILED) arrives via webhook.
   */
  status: 'pending' | 'success' | 'failed';
  /** On-chain transaction hash — absent while the swap is still pending. */
  hash?: string;
}

// ---------------------------------------------------------------------------
// ISwapProvider
// ---------------------------------------------------------------------------

export interface ISwapProvider {
  /**
   * Fetches a real-time swap quote from the provider.
   *
   * The quote is non-binding: the execution engine re-fetches and compares
   * against the stored quote at execute time (maxDriftBps check).
   *
   * @throws SwapUnavailableError on HTTP 404 (swap not enrolled) or HTTP 400
   *   (no route/liquidity) — both carry `httpStatus` and mean "swap unavailable",
   *   not a retryable outage. Any other non-2xx response throws an Error that
   *   carries the originating HTTP status STRUCTURALLY as a numeric `httpStatus`
   *   property (see {@link execute} for the funds-safety rationale).
   */
  getQuote(input: GetSwapQuoteInput): Promise<GetSwapQuoteOutput>;

  /**
   * Initiates a crypto-to-crypto swap.
   *
   * This is a NON-BLOCKING call: the provider returns immediately with a
   * PENDING status and delivers the final status via webhook. The deterministic
   * execution engine is the ONLY caller, after PIN + step-up auth (§3.1).
   *
   * `reference` is the caller's idempotency key — Blockradar deduplicates on it.
   *
   * @throws SwapUnavailableError on HTTP 404 (carries `httpStatus: 404`). Any
   *   other non-2xx response throws an Error that carries the originating HTTP
   *   status STRUCTURALLY as a numeric `httpStatus` property (NOT only in the
   *   message string); a network error with no HTTP response leaves `httpStatus`
   *   absent (undefined). The execution engine reads `httpStatus` to distinguish
   *   a DEFINITIVE client rejection (4xx — swap never performed → safe to refund
   *   the reserve) from an AMBIGUOUS failure (5xx / network — the swap may be
   *   in-flight → leave for the reconciler). CLAUDE.md §3.1.
   */
  execute(input: ExecuteSwapInput): Promise<ExecuteSwapOutput>;
}
