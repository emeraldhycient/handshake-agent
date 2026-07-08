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
  /**
   * BUG 2 — velocity reversal. The exact daily-spend contribution this tx made
   * at reserve (fiatAmountStr) so the refund can DECREMENT it inside the same
   * atomic. A definitively-failed + refunded tx must NOT keep consuming the
   * user's daily limit. Omit only on a tx that never incremented velocity.
   */
  velocityReversal?: VelocityReversal;
}

/**
 * Velocity-counter reversal applied inside a refund atomic. Mirrors the
 * `velocityIncrement` written at reserve so the daily-spend and tx-count
 * counters are restored to their pre-tx values when a tx fails + refunds.
 */
export interface VelocityReversal {
  userId: string;
  /** Fiat currency code for the counter's window (e.g. 'NGN'). */
  fiatCurrency: string;
  /** The exact fiat amount that was incremented at reserve. */
  fiatAmountStr: string;
  /** Clock now — used only to decide whether the active window still applies. */
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
  /** Fiat-equivalent amount used for threshold evaluation (decimal string). */
  ngnEquivalent: string;
  /**
   * The fiat currency `ngnEquivalent` was valued in at capture time — the
   * quote/default fiat the threshold gate used (config-driven, NOT always NGN
   * despite the legacy field name). Persisted on TravelRuleData.fiatCurrency so
   * the compliance record states its own valuation currency.
   */
  fiatCurrency: string;
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
  /** BUG 2 — velocity reversal (see SettleSellRefundInput.velocityReversal). */
  velocityReversal?: VelocityReversal;
}

// ---------------------------------------------------------------------------
// Swap — atomic create Transaction + reserve (execute phase)
// ---------------------------------------------------------------------------

/**
 * All the data needed to atomically create the swap Transaction row AND post
 * the fromAsset reserve ledger entries in a single $transaction.
 *
 * Eliminates any double-spend window by combining create + reserve in one write.
 */
export interface CreateSwapSettlingWithReserveInput {
  txnData: {
    proposalId: string;
    userId: string;
    type: 'swap';
    status: 'settling';
    idempotencyKey: string;
    requestChecksum: string;
    fxRateSnapshot: string | null;
    metadata: Record<string, unknown>;
    pinVerifiedAt: Date;
  };
  proposalId: string;
  confirmedAt: Date;
  velocityIncrement: {
    userId: string;
    fiatCurrency: string;
    fiatAmountStr: string;
    now: Date;
  };
  /** Blockradar / WalletPrismaRepository id of the user's crypto wallet. */
  walletId: string;
  /** fromAsset amount to reserve (decimal string, e.g. "100"). */
  fromAmount: string;
  /** The fromAsset symbol (e.g. 'USDT'). */
  fromAsset: string;
  now: Date;
}

export interface CreateSwapSettlingWithReserveOutput {
  txn: import('./transaction.repository.port').TransactionRecord;
}

// ---------------------------------------------------------------------------
// Swap — finalize (provider swap confirmed)
// ---------------------------------------------------------------------------

export interface SettleSwapFinalizeInput {
  transactionId: string;
  userId: string;
  walletId: string;
  /** Amount of fromAsset that was reserved. */
  fromAmount: string;
  /** The fromAsset symbol (e.g. 'USDT'). */
  fromAsset: string;
  /** Amount of toAsset to credit to the user. */
  toAmount: string;
  /** The toAsset symbol (e.g. 'TRX'). */
  toAsset: string;
  /** On-chain tx hash from the swap provider. */
  onChainTxHash: string;
  now: Date;
  year: string;
}

export interface SettleSwapFinalizeOutput {
  receiptNumber: string;
}

// ---------------------------------------------------------------------------
// Swap — refund (provider swap failed)
// ---------------------------------------------------------------------------

export interface SettleSwapRefundInput {
  transactionId: string;
  userId: string;
  walletId: string;
  fromAmount: string;
  fromAsset: string;
  failureReason: string;
  now: Date;
  /** BUG 2 — velocity reversal (see SettleSellRefundInput.velocityReversal). */
  velocityReversal?: VelocityReversal;
}

// ---------------------------------------------------------------------------
// Manual credit (admin, engine-brokered — Phase 7)
// ---------------------------------------------------------------------------

/**
 * An admin-approved manual credit of an end user's custodial wallet. This is a
 * MONEY-PATH write: it is the engine-brokered applier of an approved
 * `manual_credit` ChangeRequest (four-eyes maker-checker, §3.1). The credit is a
 * balanced double-entry (user_wallet + a treasury contra), keyed by
 * `idempotencyKey` so a replayed apply is a no-op (never a double credit).
 */
export interface SettleManualCreditAtomicInput {
  /** The end user receiving the credit. */
  userId: string;
  /** Blockradar / WalletPrismaRepository id of the user's crypto wallet. */
  walletId: string;
  /** Crypto amount to credit (positive canonical decimal string, e.g. "25.5"). */
  cryptoAmount: string;
  /** The crypto asset symbol (e.g. 'USDT'); threaded to the ledger builder. */
  asset: string;
  /**
   * Per-asset decimal places for the WalletBalance snapshot. Resolved from the
   * AssetRegistry by the application service (which already validated the asset),
   * so the repository never hardcodes a decimals literal (§7).
   */
  assetDecimals: number;
  /**
   * Idempotency key derived from the approved ChangeRequest (its id). A prior
   * settle with the same key short-circuits WITHOUT re-crediting — the guard
   * against a double-apply race.
   */
  idempotencyKey: string;
  /** The admin id that approved the credit — recorded in the txn metadata trail. */
  approvedByAdminId: string;
  /** The maker's reason — recorded in the txn metadata trail. */
  reason: string;
  /** Timestamp to use for postedAt / completedAt / issuedAt (from CLOCK). */
  now: Date;
  /** Current year string for receiptNumber (e.g. "2026"). Derived from CLOCK. */
  year: string;
}

export interface SettleManualCreditAtomicOutput {
  /** True on a fresh credit; false when the idempotency key already settled. */
  credited: boolean;
  /** The user_wallet running balance after the credit (decimal string). */
  newBalance: string;
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

  /**
   * ATOMICALLY creates the swap Transaction row, marks the Proposal 'executing',
   * upserts VelocityCounter rows, and posts the fromAsset reserve ledger entries
   * (user_wallet → swap_clearing) — all in a SINGLE `prisma.$transaction` (C1).
   *
   * Uses `isolationLevel: 'Serializable'` to prevent balanceAfter sequence races.
   */
  createSwapSettlingWithReserveAtomic(
    input: CreateSwapSettlingWithReserveInput,
  ): Promise<CreateSwapSettlingWithReserveOutput>;

  /**
   * Atomically finalizes a swap after provider confirmation:
   *   1. Read account states inside $transaction.
   *   2. buildSwapFinalizeEntries → insert 4 LedgerEntry rows (from + to legs).
   *   3. Transaction → completed (processorTxRef = onChainTxHash).
   *   4. SettlementOutbox(swap) → completed.
   *   5. Mint signed Receipt.
   */
  settleSwapFinalizeAtomic(
    input: SettleSwapFinalizeInput,
  ): Promise<SettleSwapFinalizeOutput>;

  /**
   * Atomically refunds a swap reserve after provider failure:
   *   1. Read account states (swap_clearing, user_wallet) inside $transaction.
   *   2. buildSwapRefundEntries → insert 2 LedgerEntry rows (reverses the reserve).
   *   3. Transaction → failed.
   *   4. CompensationRecord created (status=pending, reason=settlement_failed).
   */
  settleSwapRefundAtomic(input: SettleSwapRefundInput): Promise<void>;

  /**
   * Atomically credits an end user's custodial wallet for an admin-approved
   * MANUAL CREDIT (engine-brokered applier of a `manual_credit` ChangeRequest):
   *   1. Idempotency check on `idempotencyKey` — return { credited:false } if a
   *      prior apply already settled (no double credit).
   *   2. Read the user_wallet + treasury contra account states (inside the tx).
   *   3. buildManualCreditEntries → insert 2 LedgerEntry rows (user_wallet credit,
   *      treasury debit — a balanced double-entry, sum = 0).
   *   4. Create the anchor Transaction (type=reward, status=completed).
   *   5. Create the WalletBalance snapshot (credit the user's asset balance).
   *   6. Mint a signed Receipt.
   * All inside a single `$transaction` (no half-credited state, §3.1).
   */
  settleManualCreditAtomic(
    input: SettleManualCreditAtomicInput,
  ): Promise<SettleManualCreditAtomicOutput>;
}
