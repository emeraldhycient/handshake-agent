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
}
