/**
 * DI token + port for the admin RECONCILIATION read repository (Phase 6b).
 *
 * READ-ONLY provider-vs-ledger break detection for the operator Reconciliation
 * screen. A "break" is a detected discrepancy between what a provider settled and
 * what the double-entry ledger recorded. There is NO persisted break entity yet —
 * breaks are PROJECTED on read from real rows:
 *   - unresolved CompensationRecord drifts (duplicate_debit / processor_error /
 *     settlement_failed) → the over-credit / mismatch / duplicate classes;
 *   - stuck SettlementOutbox rows (provider settled, ledger entry not posted past a
 *     grace window) → the missing-settlement class.
 * The cron status is derived from the recent SettlementOutbox dispatch history.
 *
 * The concrete Prisma adapter lives in `admin/infrastructure`; application/domain
 * depend only on this abstraction (clean-arch §4.1, CLAUDE.md §3.2). Nothing here
 * mutates anything (§3.1); no PII crosses this boundary (opaque transaction ids
 * only, §3.4). Decimal columns are projected as canonical strings; dates as `Date`.
 */
export const RECONCILIATION_READ_REPOSITORY = Symbol(
  'RECONCILIATION_READ_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Record types (application-layer projections — never Prisma types)
// ---------------------------------------------------------------------------

/** The discrepancy class of a detected break. */
export type ReconBreakKind =
  | 'over_credit'
  | 'missing_settlement'
  | 'amount_mismatch'
  | 'duplicate_credit';

/**
 * One provider-vs-ledger break projected from a real row. `delta` is the signed
 * provider-minus-ledger difference as a canonical string; `asset` is its unit.
 * `detail` is a PII-free explanation; `transactionId` is the offending txn (opaque).
 * Every projected break is currently `open` (the resolve/accept/escalate outcomes
 * are Phase-7 writes) — the service maps kind → severity + status.
 */
export interface ReconBreakRecord {
  id: string;
  kind: ReconBreakKind;
  transactionId: string;
  asset: string;
  delta: string;
  detail: string;
  detectedAt: Date;
}

/**
 * The reconciliation-cron status inputs: whether the cron is enabled (config flag),
 * the last observed reconciler run + the next due run (derived from the recent
 * dispatch history + the tick cadence), and the tick interval in seconds. The
 * open-break count is computed by the service from the break list (single source).
 */
export interface ReconCronStatusRecord {
  lastRunAt: Date | null;
  nextRunAt: Date | null;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IReconciliationReadRepository {
  /**
   * Detected provider-vs-ledger breaks, newest-first. Projected from unresolved
   * CompensationRecord drifts + stuck SettlementOutbox rows past `staleAfterSec`.
   * Returns Decimals as canonical strings; never mutates anything.
   */
  listBreaks(staleAfterSec: number): Promise<ReconBreakRecord[]>;

  /**
   * A single projected break by its opaque id (Phase 7 — the resolve/accept actions
   * need the break's transactionId + kind to route the engine re-drive, and MUST
   * derive the transactionId server-side rather than trust a client). Returns null
   * when the id is unknown. `staleAfterSec` scopes the missing-settlement projection
   * identically to `listBreaks` so a break is findable iff it is currently open.
   */
  findBreak(
    id: string,
    staleAfterSec: number,
  ): Promise<ReconBreakRecord | null>;

  /**
   * READ-ONLY per-transaction break detection (Phase 8 — the "re-run reconciliation"
   * action for a single transaction). Re-runs the SAME provider-vs-ledger projection
   * as `listBreaks`, scoped to one transaction's id — returning every break currently
   * open for that transaction (empty when the transaction reconciles cleanly). This
   * only DETECTS; it moves no money and mutates nothing (§3.1). `staleAfterSec` scopes
   * the missing-settlement projection identically to `listBreaks`.
   */
  findBreaksByTransactionId(
    transactionId: string,
    staleAfterSec: number,
  ): Promise<ReconBreakRecord[]>;

  /**
   * The reconciler-cron run timeline: the most recent observed run (latest
   * SettlementOutbox attempt/completion) and the next due run (last + interval).
   * `intervalSec` is the reconciler tick cadence used to project the next run.
   */
  cronStatus(intervalSec: number): Promise<ReconCronStatusRecord>;
}
