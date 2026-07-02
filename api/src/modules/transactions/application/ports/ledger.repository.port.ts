/**
 * DI token and port contract for the ledger repository.
 *
 * The concrete Prisma adapter lives in infrastructure and implements this
 * interface; application and domain layers depend only on this contract
 * (clean-arch §4.1, CLAUDE.md §3.2).
 *
 * `getAccountBalance` is the AUTHORITATIVE balance read — it derives the
 * current balance from the latest LedgerEntry.balanceAfter for a given
 * (accountType, accountId, currency) triple. WalletBalance is a snapshot
 * from the provider; only the ledger is the single source of truth for
 * sell balance checks (task S4a).
 */
export const LEDGER_REPOSITORY = Symbol('LEDGER_REPOSITORY');

// ---------------------------------------------------------------------------
// Record types (application-layer projections — never Prisma types)
// ---------------------------------------------------------------------------

/**
 * A double-entry ledger row projected for admin reads. Decimal columns
 * (`amount`, `balanceAfter`) are canonical decimal strings, not Prisma Decimal.
 */
export interface LedgerEntryRecord {
  id: string;
  transactionId: string;
  accountType: string;
  accountId: string;
  currency: string;
  amount: string;
  direction: string;
  balanceAfter: string;
  /** Per-(accountType, accountId) monotonic order; deterministic + immutable. */
  sequence: number;
  postedAt: Date;
}

/**
 * Per-transaction double-entry integrity result (READ-ONLY). Per currency, the
 * signed sum of legs (credit=+amount, debit=-amount) must net to zero.
 *   - `balanced` is true only when every currency nets to zero AND legCount > 0.
 *   - `brokenAt` is the first currency that fails to net to zero (else null).
 */
export interface LedgerIntegrityResult {
  balanced: boolean;
  legCount: number;
  brokenAt: string | null;
}

/** Optional filters for the global cross-account ledger browse. */
export interface LedgerGlobalFilter {
  accountType?: string;
  currency?: string;
}

/**
 * A keyset page of global ledger entries (newest-first) plus the cursor to fetch
 * the next page (`null` when the last page has been returned). `cursor` on the
 * request is an opaque ledger-entry id (the last row of the previous page).
 */
export interface LedgerGlobalPage {
  items: LedgerEntryRecord[];
  nextCursor: string | null;
}

/**
 * Global sequence-continuity result (READ-ONLY). Walks every
 * (accountType, accountId, currency) sub-ledger and asserts its `sequence`
 * column is a gapless, correctly-ordered 1..N run.
 *   - `ok` is true only when NO sub-ledger has a gap or reorder.
 *   - `brokenAccount` is the first offending "accountType:accountId:currency"
 *     key (else null).
 */
export interface LedgerSequenceIntegrityResult {
  ok: boolean;
  accountsChecked: number;
  brokenAccount: string | null;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface ILedgerRepository {
  /**
   * Returns the authoritative running balance for the given account triple
   * by reading the latest `LedgerEntry.balanceAfter`. Returns `'0'` when no
   * entries exist for this account (the account has never been touched).
   *
   * @param accountType  - LedgerAccountType string value, e.g. 'user_wallet'
   * @param accountId    - account identifier, e.g. a walletId or 'usdt_treasury'
   * @param currency     - e.g. 'USDT' or 'NGN'
   */
  getAccountBalance(
    accountType: string,
    accountId: string,
    currency: string,
  ): Promise<string>;

  /**
   * Returns the most recent `limit` ledger entries for the given account
   * (accountType, accountId) ordered newest-first by `sequence` (the per-account
   * monotonic counter), then `postedAt`. Used by the admin user-detail view.
   * Returns an empty array when the account has no entries.
   */
  listLedgerEntries(
    accountType: string,
    accountId: string,
    limit: number,
  ): Promise<LedgerEntryRecord[]>;

  /**
   * Admin oversight read (READ-ONLY): returns ALL ledger legs posted by one
   * transaction, ordered by `sequence` ascending (posting order). Used to render
   * the transaction-detail view. Returns an empty array for an unknown txn.
   */
  listByTransaction(transactionId: string): Promise<LedgerEntryRecord[]>;

  /**
   * Admin oversight read (READ-ONLY): the most recent `limit` ledger entries for
   * the given (accountType, accountId, currency) triple, newest-first by
   * `sequence`. Used by the per-account ledger history viewer.
   */
  getAccountHistory(
    accountType: string,
    accountId: string,
    currency: string,
    limit: number,
  ): Promise<LedgerEntryRecord[]>;

  /**
   * Admin oversight read (READ-ONLY): re-sums a transaction's existing legs per
   * currency and reports whether each currency nets to zero. NEVER mutates — it
   * only reads and arithmetic-checks the append-only ledger (§3.1).
   */
  verifyTransactionIntegrity(
    transactionId: string,
  ): Promise<LedgerIntegrityResult>;

  /**
   * Admin oversight read (READ-ONLY): a keyset page of ledger legs across ALL
   * accounts, filtered by an optional accountType and/or currency, newest-first
   * by (postedAt, id). `cursor` is the last-seen entry id from the previous page
   * (a malformed/unknown cursor yields the first page). Returns at most `limit`
   * items plus `nextCursor` (null when there is no further page). The ledger's
   * per-account `sequence` cannot order across accounts, so the id (uuid7,
   * time-ordered) is the stable global tiebreaker.
   */
  listGlobal(
    filter: LedgerGlobalFilter,
    page: { cursor?: string; limit: number },
  ): Promise<LedgerGlobalPage>;

  /**
   * Admin oversight read (READ-ONLY): walks every
   * (accountType, accountId, currency) sub-ledger and asserts its `sequence`
   * column is a gapless, correctly-ordered 1..N run. NEVER mutates — it only
   * reads and checks the append-only ledger (§3.1). Reports the first offending
   * sub-ledger key, or null when all are continuous.
   */
  verifyGlobalSequenceIntegrity(): Promise<LedgerSequenceIntegrityResult>;
}
