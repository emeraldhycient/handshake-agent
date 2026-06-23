/**
 * DI token and port contract for the deposit settlement repository.
 *
 * The concrete Prisma adapter lives in infrastructure and implements this
 * interface; application and domain layers depend only on this contract
 * (clean-arch §4.1, CLAUDE.md §3.2).
 *
 * `settleDepositAtomic` is the ONLY path that:
 *   - Checks DepositConfirmation(txHash) for idempotency (no double-credit).
 *   - Posts ledger entries via buildDepositLedgerEntries (domain, ledger.ts).
 *   - Credits the user USDT WalletBalance.
 *   - Inserts DepositConfirmation (status=confirmed, deduped by txHash).
 *
 * All operations execute inside a single `$transaction` (CLAUDE.md §3.1).
 */
export const DEPOSIT_SETTLEMENT_REPOSITORY = Symbol(
  'DEPOSIT_SETTLEMENT_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface SettleDepositAtomicInput {
  /** Blockradar / WalletPrismaRepository id of the user's USDT wallet. */
  walletId: string;
  /** User id (owner of the wallet). */
  userId: string;
  /** USDT to credit to the user (decimal string, e.g. "10.5"). */
  cryptoAmount: string;
  /** Asset symbol (e.g. "USDT"). Used to read decimals from AssetRegistry. */
  asset: string;
  /** On-chain transaction hash — idempotency key. */
  txHash: string;
  /** On-chain sender address (optional; stored for audit). */
  sourceAddress?: string;
  /** Opaque Blockradar webhook event id (optional; for retry dedup). */
  providerWebhookId?: string;
  /** Timestamp at which the deposit was confirmed on-chain. */
  postedAt: Date;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface SettleDepositAtomicOutput {
  /**
   * `true` when the deposit was credited in this call;
   * `false` when a DepositConfirmation for this txHash already exists
   * (idempotent replay — no money moved).
   */
  deposited: boolean;
  /**
   * The new WalletBalance amount (decimal string) after the credit,
   * populated only when `deposited === true`.
   */
  newBalance?: string;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IDepositSettlementRepository {
  /**
   * Atomically credits a user's USDT wallet from an on-chain deposit.
   *
   * Idempotent: if a DepositConfirmation already exists for `txHash`,
   * returns `{ deposited: false }` without writing anything.
   *
   * On first call: inserts LedgerEntry rows, upserts WalletBalance, and
   * inserts DepositConfirmation(txHash, status=confirmed) — all in one
   * `prisma.$transaction`.
   */
  settleDepositAtomic(
    input: SettleDepositAtomicInput,
  ): Promise<SettleDepositAtomicOutput>;
}
