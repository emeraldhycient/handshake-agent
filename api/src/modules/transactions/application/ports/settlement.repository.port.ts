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
 *
 * Sell settlement (task S4b) uses two additional atomic methods:
 *   `settleSellFinalizeAtomic` — payout succeeded; move clearing→treasury, post NGN payout leg,
 *      mark Transaction completed, mint Receipt, update SettlementOutbox.
 *   `settleSellRefundAtomic` — payout failed; reverse the reserve (clearing→user_wallet),
 *      mark Transaction failed, create CompensationRecord.
 */
export const SETTLEMENT_REPOSITORY = Symbol('SETTLEMENT_REPOSITORY');

// ---------------------------------------------------------------------------
// Buy
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

export interface SettleBuyAtomicOutput {
  /** Human-readable sequential receipt number, e.g. "HS-2026-000001". */
  receiptNumber: string;
}

// ---------------------------------------------------------------------------
// Sell — reserve (execute phase)
// ---------------------------------------------------------------------------

export interface PostSellReserveInput {
  transactionId: string;
  /** Blockradar / WalletPrismaRepository id of the user's USDT wallet. */
  walletId: string;
  /** USDT the user is selling (same as at executeSell). */
  cryptoAmount: string;
  /** Timestamp to use for postedAt (from CLOCK). */
  now: Date;
}

// ---------------------------------------------------------------------------
// Sell — finalize (payout success)
// ---------------------------------------------------------------------------

export interface SettleSellFinalizeInput {
  transactionId: string;
  userId: string;
  /** Blockradar / WalletPrismaRepository id of the user's USDT wallet. */
  walletId: string;
  /** USDT that was reserved (same as at executeSell). */
  cryptoAmount: string;
  /** Net NGN the user receives after spread + fee. */
  netFiatAmount: string;
  /** Flutterwave transfer id returned by verifyPayout. */
  providerRef: string;
  /** Timestamp to use for postedAt / completedAt / issuedAt (from CLOCK). */
  now: Date;
  /** Current year string for receiptNumber (e.g. "2026"). Derived from CLOCK. */
  year: string;
}

export interface SettleSellFinalizeOutput {
  /** Human-readable sequential receipt number, e.g. "HS-2026-000001". */
  receiptNumber: string;
}

// ---------------------------------------------------------------------------
// Sell — refund (payout failure)
// ---------------------------------------------------------------------------

export interface SettleSellRefundInput {
  transactionId: string;
  userId: string;
  /** Blockradar / WalletPrismaRepository id of the user's USDT wallet. */
  walletId: string;
  /** USDT that was reserved and must be refunded. */
  cryptoAmount: string;
  /** Reason string for CompensationRecord (e.g. 'settlement_failed'). */
  failureReason: string;
  /** Timestamp to use for postedAt / failedAt (from CLOCK). */
  now: Date;
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

  /**
   * Posts the sell RESERVE ledger entries atomically (task S4b, execute phase).
   *
   * Transfers USDT from user_wallet → clearing so the crypto cannot be
   * double-spent while the NGN payout is in flight. Called immediately
   * after the Transaction row is created at executeSell.
   */
  postSellReserveAtomic(input: PostSellReserveInput): Promise<void>;

  /**
   * Atomically finalizes a sell order after payout success (task S4b):
   *   1. Read account states inside $transaction.
   *   2. buildSellFinalizeEntries → insert LedgerEntry rows (USDT + NGN legs).
   *   3. Transaction → completed (processorTxRef set).
   *   4. SettlementOutbox → completed.
   *   5. Mint signed Receipt.
   *
   * NO WalletBalance snapshot is written here — the user already had their
   * USDT debited at executeSell (reserve step). The clearing balance goes
   * to zero; treasury is credited.
   */
  settleSellFinalizeAtomic(
    input: SettleSellFinalizeInput,
  ): Promise<SettleSellFinalizeOutput>;

  /**
   * Atomically refunds a sell reserve after payout failure (task S4b):
   *   1. Read account states inside $transaction.
   *   2. buildSellRefundEntries → insert LedgerEntry rows (reverses the reserve).
   *   3. Transaction → failed.
   *   4. CompensationRecord created (status=pending, reason=settlement_failed).
   *
   * The WalletBalance snapshot for the refunded USDT is updated via the
   * ledger entry — no separate WalletBalance.create() is needed here
   * (the reserve debit + refund credit cancel on the ledger; a provider_sync
   * reconciliation will confirm the on-chain balance later).
   */
  settleSellRefundAtomic(input: SettleSellRefundInput): Promise<void>;
}
