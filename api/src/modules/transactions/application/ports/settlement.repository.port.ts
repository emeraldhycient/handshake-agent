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
  /** Blockradar / WalletPrismaRepository id of the user's crypto wallet. */
  walletId: string;
  /** Gross fiat the user paid in `fiatCurrency` (decimal string, NGN example: "10000"). */
  fiatAmount: string;
  /** Crypto amount to credit to the user (decimal string, e.g. "6.123456"). */
  cryptoAmount: string;
  /** Processing fee portion of fiatAmount in `fiatCurrency` (decimal string, NGN example: "100"). */
  processingFee: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Threaded through to the
   * ledger builder so all crypto legs key by this asset, not a hardcoded literal.
   */
  asset: string;
  /** The fiat currency code (e.g. 'NGN'); threaded to the ledger builder for the fiat legs. */
  fiatCurrency: string;
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
  /** Blockradar / WalletPrismaRepository id of the user's crypto wallet. */
  walletId: string;
  /** Crypto amount the user is selling (same as at executeSell). */
  cryptoAmount: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Threaded through to the
   * ledger builder so crypto legs key by this asset.
   */
  asset: string;
  /** Timestamp to use for postedAt (from CLOCK). */
  now: Date;
}

// ---------------------------------------------------------------------------
// Sell — atomic create Transaction + reserve (execute phase, C1 fix)
// ---------------------------------------------------------------------------

/**
 * All the data needed to atomically create the sell Transaction row AND post
 * the USDT reserve ledger entries in a single $transaction.
 *
 * This eliminates the double-spend window that existed when createSettlingWithProposal
 * and postSellReserveAtomic were called as two separate $transactions.
 */
export interface CreateSellSettlingWithReserveInput {
  /** Full transaction data, mirroring CreateSettlingWithProposalData.txnData. */
  txnData: {
    proposalId: string;
    userId: string;
    type: 'sell';
    status: 'settling';
    idempotencyKey: string;
    requestChecksum: string;
    fxRateSnapshot: string;
    metadata: Record<string, unknown>;
    pinVerifiedAt: Date;
  };
  proposalId: string;
  confirmedAt: Date;
  /** Velocity counters to upsert atomically (V1). */
  velocityIncrement: {
    userId: string;
    /** Fiat currency code for the counter's window (e.g. 'NGN'). */
    fiatCurrency: string;
    fiatAmountStr: string;
    now: Date;
  };
  /** Blockradar / WalletPrismaRepository id of the user's crypto wallet. */
  walletId: string;
  /** Crypto amount the user is selling (decimal string, e.g. "16.000000"). */
  cryptoAmount: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Threaded through to the
   * ledger builder so crypto legs key by this asset.
   */
  asset: string;
  now: Date;
}

export interface CreateSellSettlingWithReserveOutput {
  txn: import('./transaction.repository.port').TransactionRecord;
}

// ---------------------------------------------------------------------------
// Sell — finalize (payout success)
// ---------------------------------------------------------------------------

export interface SettleSellFinalizeInput {
  transactionId: string;
  userId: string;
  /** Blockradar / WalletPrismaRepository id of the user's crypto wallet. */
  walletId: string;
  /** Crypto amount that was reserved (same as at executeSell). */
  cryptoAmount: string;
  /** Net fiat the user receives in `fiatCurrency` after spread + fee. */
  netFiatAmount: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Threaded through to the
   * ledger builder so crypto legs key by this asset.
   */
  asset: string;
  /** The fiat currency code (e.g. 'NGN'); threaded to the ledger builder for the fiat legs. */
  fiatCurrency: string;
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
  /** Blockradar / WalletPrismaRepository id of the user's crypto wallet. */
  walletId: string;
  /** Crypto amount that was reserved and must be refunded. */
  cryptoAmount: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Threaded through to the
   * ledger builder so crypto legs key by this asset.
   */
  asset: string;
  /** Reason string for CompensationRecord (e.g. 'settlement_failed'). */
  failureReason: string;
  /** Timestamp to use for postedAt / failedAt (from CLOCK). */
  now: Date;
}

// ---------------------------------------------------------------------------
// Send — atomic create Transaction + reserve (execute phase, C1 fix)
// ---------------------------------------------------------------------------

/**
 * Originator fields captured for Travel Rule compliance (FATF / CBN circular).
 * Passed to the atomic create when requiresTravelRule is true. Available fields
 * are sourced from the User / KycProfile at execution time; columns that cannot
 * yet be resolved are left null (skeleton — full enrichment in a future task).
 */
export interface TravelRuleOriginatorFields {
  /** Internal User.id of the originator. */
  originatorUserId: string;
  /** Originator display name from KycProfile (null if not yet resolved). */
  originatorName: string | null;
  /** Beneficiary on-chain address (the send toAddress). */
  beneficiaryAddress: string;
  /** Beneficiary label or name (from Beneficiary record, may be null). */
  beneficiaryName: string | null;
  /** Crypto asset being sent (e.g. 'USDT'). */
  asset: string;
  /** Crypto amount being sent (decimal string). */
  cryptoAmount: string;
  /** NGN-equivalent amount used for threshold evaluation. */
  ngnEquivalent: string;
}

export interface CreateSendSettlingWithReserveInput {
  /** Full transaction data mirroring CreateSellSettlingWithReserveInput.txnData. */
  txnData: {
    proposalId: string;
    userId: string;
    type: 'send';
    status: 'settling';
    idempotencyKey: string;
    requestChecksum: string;
    fxRateSnapshot: string | null;
    metadata: Record<string, unknown>;
    pinVerifiedAt: Date;
  };
  proposalId: string;
  confirmedAt: Date;
  /** Velocity counters to upsert atomically (V1). */
  velocityIncrement: {
    userId: string;
    /** Fiat currency code for the counter's window (e.g. 'NGN'). */
    fiatCurrency: string;
    fiatAmountStr: string;
    now: Date;
  };
  /** Blockradar / WalletPrismaRepository id of the user's crypto wallet. */
  walletId: string;
  /** totalDebit = cryptoAmount + networkFeeCrypto */
  totalDebit: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Threaded through to the
   * ledger builder so crypto legs key by this asset.
   */
  asset: string;
  now: Date;
  /**
   * When set, the repository must persist a TravelRuleData row inside the
   * same $transaction (SPEC DEVIATION fix — persist Travel Rule record atomically).
   * Null when the send amount is below the configured threshold.
   */
  travelRule: TravelRuleOriginatorFields | null;
}

export interface CreateSendSettlingWithReserveOutput {
  txn: import('./transaction.repository.port').TransactionRecord;
}

// ---------------------------------------------------------------------------
// Send — finalize (on-chain broadcast confirmed)
// ---------------------------------------------------------------------------

export interface SettleSendFinalizeInput {
  transactionId: string;
  userId: string;
  walletId: string;
  cryptoAmount: string;
  networkFeeCrypto: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Threaded through to the
   * ledger builder so crypto legs key by this asset.
   */
  asset: string;
  /** The on-chain tx hash from Blockradar withdraw. */
  onChainTxHash: string;
  /** Timestamp to use for postedAt / completedAt / issuedAt (from CLOCK). */
  now: Date;
  /** Current year string for receiptNumber (e.g. "2026"). Derived from CLOCK. */
  year: string;
}

export interface SettleSendFinalizeOutput {
  /** Human-readable sequential receipt number, e.g. "HS-2026-000001". */
  receiptNumber: string;
}

// ---------------------------------------------------------------------------
// Send — refund (on-chain broadcast failed)
// ---------------------------------------------------------------------------

export interface SettleSendRefundInput {
  transactionId: string;
  userId: string;
  walletId: string;
  /** totalDebit (same as at reserve). */
  totalDebit: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Threaded through to the
   * ledger builder so crypto legs key by this asset.
   */
  asset: string;
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
   * ATOMICALLY creates the sell Transaction row, marks the Proposal 'executing',
   * upserts VelocityCounter rows, and posts the USDT reserve ledger entries
   * (user_wallet → clearing) — all in a SINGLE `prisma.$transaction`.
   *
   * This replaces the prior two-call pattern (createSettlingWithProposal +
   * postSellReserveAtomic) which had a double-spend window between the two
   * separate $transactions (C1 fix).
   *
   * Uses `isolationLevel: 'Serializable'` to prevent balanceAfter sequence races.
   */
  createSellSettlingWithReserveAtomic(
    input: CreateSellSettlingWithReserveInput,
  ): Promise<CreateSellSettlingWithReserveOutput>;

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

  /**
   * ATOMICALLY creates the send Transaction row, marks the Proposal 'executing',
   * upserts VelocityCounter rows, and posts the USDT reserve ledger entries
   * (user_wallet → clearing) — all in a SINGLE `prisma.$transaction` (C1 fix).
   *
   * The totalDebit (cryptoAmount + networkFeeCrypto) is the full amount held
   * from the user's wallet at reserve time.
   *
   * Uses `isolationLevel: 'Serializable'` to prevent balanceAfter sequence races.
   */
  createSendSettlingWithReserveAtomic(
    input: CreateSendSettlingWithReserveInput,
  ): Promise<CreateSendSettlingWithReserveOutput>;

  /**
   * Atomically finalizes a send order after on-chain broadcast confirmation (task N3b):
   *   1. Read account states (clearing, network_out, fees) inside $transaction.
   *   2. buildSendFinalizeEntries → insert 3 LedgerEntry rows (USDT).
   *   3. Transaction → completed (processorTxRef = onChainTxHash).
   *   4. SettlementOutbox(onchain_send) → completed.
   *   5. Mint signed Receipt.
   */
  settleSendFinalizeAtomic(
    input: SettleSendFinalizeInput,
  ): Promise<SettleSendFinalizeOutput>;

  /**
   * Atomically refunds a send reserve after on-chain broadcast failure (task N3b):
   *   1. Read account states (clearing, user_wallet) inside $transaction.
   *   2. buildSendRefundEntries → insert 2 LedgerEntry rows (reverses the reserve).
   *   3. Transaction → failed.
   *   4. CompensationRecord created (status=pending, reason=settlement_failed).
   */
  settleSendRefundAtomic(input: SettleSendRefundInput): Promise<void>;
}
