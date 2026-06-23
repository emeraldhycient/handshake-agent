/**
 * DI token and port contract for the settlement repository.
 *
 * The concrete Prisma adapter lives in infrastructure and implements this
 * interface; application and domain layers depend only on this contract
 * (clean-arch §4.1, CLAUDE.md §3.2).
 *
 * `settleBuyAtomic` is the ONLY path that:
 *   - Posts ledger entries (Task 4.4 domain).
 *   - Credits the user USDT WalletBalance.
 *   - Completes the Transaction + SettlementOutbox.
 *   - Mints the signed Receipt.
 * All operations execute inside a single `$transaction` (no half-settled state,
 * no double credit). See CLAUDE.md §3.1.
 */
export const SETTLEMENT_REPOSITORY = Symbol('SETTLEMENT_REPOSITORY');

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface SettleBuyAtomicInput {
  transactionId: string;
  userId: string;
  /** Blockradar / WalletPrismaRepository id of the user's USDT wallet. */
  walletId: string;
  /** Gross NGN the user paid (decimal string, e.g. "10000"). */
  fiatAmount: string;
  /** USDT to credit to the user (decimal string, e.g. "6.123456"). */
  cryptoAmount: string;
  /** NGN processing fee portion of fiatAmount (decimal string, e.g. "100"). */
  processingFee: string;
  /** Provider reference returned by payment provider verify (e.g. flw_ref). */
  providerRef: string;
  /** Timestamp to use for postedAt / completedAt / issuedAt (from CLOCK). */
  now: Date;
  /** Current year string for receiptNumber (e.g. "2026"). Derived from CLOCK. */
  year: string;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface SettleBuyAtomicOutput {
  /** Human-readable sequential receipt number, e.g. "HS-2026-000001". */
  receiptNumber: string;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface ISettlementRepository {
  /**
   * Executes the full atomic settlement of a buy order in a single
   * `prisma.$transaction`.  A failure at any step rolls everything back
   * (no half-settled state, no double credit).
   *
   * Caller must have already verified:
   *   - Transaction.status === 'settling'
   *   - Payment provider returned status === 'successful' with matching amount/currency.
   */
  settleBuyAtomic(input: SettleBuyAtomicInput): Promise<SettleBuyAtomicOutput>;

  /**
   * Returns the receiptNumber for the Receipt linked to `transactionId`, or
   * null if no receipt has been minted yet.  Used by the idempotent path in
   * ExecutionService.settleBuyPayment to short-circuit without re-crediting.
   */
  findReceiptNumber(transactionId: string): Promise<string | null>;
}
