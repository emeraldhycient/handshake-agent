/**
 * DI token and port for the admin-facing transaction READ repository
 * (Phase 2, Task 2).
 *
 * This is a thin read-only projection used by the admin user-detail view — it
 * deliberately does NOT overlap with ITransactionRepository (the write-side
 * engine port). The concrete Prisma adapter lives in infrastructure; the
 * application/domain layers depend only on this contract (CLAUDE.md §3.2).
 */
export const TRANSACTION_READ_REPOSITORY = Symbol(
  'TRANSACTION_READ_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Record type (application-layer projection — never a Prisma type)
// ---------------------------------------------------------------------------

/** A transaction summary row for the admin user-detail list. */
export interface TransactionListRecord {
  id: string;
  type: string;
  status: string;
  /**
   * Economics projected from Transaction.metadata ({ asset, amount, fiatAmount,
   * fiatCurrency, ... }). Null when the row does not carry that leg (older rows,
   * or deposit/reward types) — the boundary read of the JSON is best-effort.
   */
  asset: string | null;
  amount: string | null;
  fiatAmount: string | null;
  fiatCurrency: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface ITransactionReadRepository {
  /**
   * Returns the most recent `limit` transactions for a user, newest-first by
   * createdAt. Returns an empty array when the user has no transactions.
   */
  listForUser(userId: string, limit: number): Promise<TransactionListRecord[]>;
}
