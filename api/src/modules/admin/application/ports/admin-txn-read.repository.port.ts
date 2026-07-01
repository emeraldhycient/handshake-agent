/**
 * DI token + port for the admin TRANSACTION read repository (Phase 6b).
 *
 * The base `ITransactionRepository.listAll` (owned by the transactions module)
 * covers the id/status/type/userId/date keyset. This admin-owned read adds the
 * three enrichment surfaces the console needs but the base port does not model:
 *
 *   1. a free-text `q` token matched (case-insensitive) across
 *      id / onChainTxHash / processorTxRef / idempotencyKey (the search pill),
 *   2. the four view-tab counts (All / Stuck / Failed today / Refunds), and
 *   3. a userId→email batch join (the console derives display names from email;
 *      the User model has no name field, §3.4).
 *
 * READ-ONLY: it projects existing rows only — nothing here moves money (§3.1).
 * The concrete Prisma adapter lives in `admin/infrastructure`; application and
 * domain depend only on this abstraction (clean-arch §4.1, CLAUDE.md §3.2).
 * Decimal columns are projected as canonical strings, dates stay as `Date`.
 */
export const ADMIN_TXN_READ_REPOSITORY = Symbol('ADMIN_TXN_READ_REPOSITORY');

// ---------------------------------------------------------------------------
// Record types (application-layer projections — never Prisma types)
// ---------------------------------------------------------------------------

/**
 * A transaction row projected for the admin list. `metadata` is the raw
 * type-specific bag the engine persisted (asset/fiatAmount/cryptoAmount/rate/
 * fee/spread/…) — the service, not the repo, extracts the economics from it.
 */
export interface AdminTxnReadRecord {
  id: string;
  userId: string;
  type: string;
  status: string;
  idempotencyKey: string;
  processorTxRef: string | null;
  onChainTxHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Filter for the admin transaction read (all fields optional). `q` is the
 * free-text token; `from`/`to` bound the createdAt window; `status`/`type`/
 * `userId` narrow by column.
 */
export interface AdminTxnReadFilter {
  status?: string;
  type?: string;
  userId?: string;
  q?: string;
  from?: Date;
  to?: Date;
}

/** The four view-tab counts the console renders as count pills. */
export interface AdminTxnViewCountsRecord {
  all: number;
  stuck: number;
  failed: number;
  refunds: number;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IAdminTxnReadRepository {
  /**
   * Lists transactions newest-first via a (createdAt, id) keyset, honouring the
   * filter (including free-text `q`). Fetches `limit + 1` rows internally to
   * compute `nextCursor`. Returns an empty list when nothing matches.
   */
  list(
    filter: AdminTxnReadFilter,
    page: { cursor?: string; limit: number },
  ): Promise<{ items: AdminTxnReadRecord[]; nextCursor: string | null }>;

  /**
   * Returns the four view-tab counts for the given base filter (the `q`/status
   * fields of the filter are honoured; each count applies its own view slice on
   * top). Counts the FULL matching set, independent of any cursor page.
   */
  countViews(filter: AdminTxnReadFilter): Promise<AdminTxnViewCountsRecord>;

  /**
   * Batch userId→login-email join. Returns a Map keyed by userId; a user with no
   * email (or an unknown id) maps to null. Never throws on unknown ids.
   */
  emailsByUserIds(userIds: string[]): Promise<Map<string, string | null>>;

  /** Single userId→login-email lookup for the detail view; null when absent. */
  emailByUserId(userId: string): Promise<string | null>;
}
