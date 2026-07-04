/**
 * IReconciliationRepository — the durable reconciliation run + break store
 * (Go-readiness #3). Backs both the persistence path (a reconciler run creates a
 * run row + records its detected breaks) and the admin console (run history,
 * break detail, and the acknowledge/resolve lifecycle).
 *
 * Application-layer port: plain TS shapes only, no Prisma import (§3.2). The
 * infrastructure adapter maps these to the ReconRun / ReconBreak models.
 *
 * Immutability (§3.6): `updateBreakStatus` writes ONLY the disposition annotation
 * (status/approvedByAdminId/reason/actionAt) — the detected facts (breakType,
 * delta, currency, and the offending id refs) are never mutated after record.
 */

export const RECONCILIATION_REPOSITORY = Symbol('RECONCILIATION_REPOSITORY');

export type ReconRunTypeValue = 'settlement_outbox' | 'wallet_deposit';
export type ReconRunStatusValue = 'running' | 'completed' | 'failed';
export type ReconBreakTypeValue =
  | 'balance_mismatch'
  | 'over_credit'
  | 'settlement_failure';
export type ReconBreakStatusValue =
  | 'detected'
  | 'acknowledged'
  | 'resolved'
  | 'rejected';

export interface ReconRunRecord {
  id: string;
  runType: ReconRunTypeValue;
  status: ReconRunStatusValue;
  totalChecked: number;
  breaksDetected: number;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}

export interface ReconBreakRecord {
  id: string;
  reconRunId: string;
  breakType: ReconBreakTypeValue;
  userId: string | null;
  walletId: string | null;
  outboxId: string | null;
  currency: string;
  /** Signed discrepancy as a decimal string (byte-stable). */
  delta: string;
  status: ReconBreakStatusValue;
  approvedByAdminId: string | null;
  reason: string | null;
  actionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReconRunInput {
  runType: ReconRunTypeValue;
}

export interface RecordReconBreakInput {
  reconRunId: string;
  breakType: ReconBreakTypeValue;
  userId?: string | null;
  walletId?: string | null;
  outboxId?: string | null;
  currency: string;
  /** Signed discrepancy as a decimal string. */
  delta: string;
  /**
   * Initial disposition. Defaults to 'detected'. An auto-remediated wallet
   * mismatch may be recorded already 'resolved' (the engine credited the delta).
   */
  status?: ReconBreakStatusValue;
}

export interface CompleteReconRunInput {
  /** Terminal run status — 'completed' on a clean drain, 'failed' when the batch threw. */
  status: ReconRunStatusValue;
  totalChecked: number;
  breaksDetected: number;
}

export interface ListReconRunsOptions {
  /** Opaque keyset cursor (the last run's id from the previous page). */
  cursor?: string;
  limit: number;
}

export interface ReconRunPage {
  items: ReconRunRecord[];
  nextCursor: string | null;
}

export interface UpdateReconBreakStatusInput {
  status: ReconBreakStatusValue;
  approvedByAdminId: string;
  reason: string;
  actionAt: Date;
}

export interface IReconciliationRepository {
  /** Persist-first: open a new run (status 'running', startedAt now). */
  createRun(input: CreateReconRunInput): Promise<ReconRunRecord>;
  /** Record one detected break against a run. */
  recordBreak(input: RecordReconBreakInput): Promise<ReconBreakRecord>;
  /** Close a run with its terminal status + tallies. */
  completeRun(id: string, input: CompleteReconRunInput): Promise<void>;
  /** Run history, newest first, keyset-paginated on (createdAt desc, id desc). */
  listRuns(options: ListReconRunsOptions): Promise<ReconRunPage>;
  findRun(id: string): Promise<ReconRunRecord | null>;
  /** Every break recorded by a run, newest first. */
  listBreaksByRun(reconRunId: string): Promise<ReconBreakRecord[]>;
  findBreak(id: string): Promise<ReconBreakRecord | null>;
  /** Open (or all) breaks for a user, newest first — optional status filter. */
  findBreaksByUser(
    userId: string,
    status?: ReconBreakStatusValue,
  ): Promise<ReconBreakRecord[]>;
  /**
   * Write ONLY the disposition annotation on a break (§3.6 immutability). Returns
   * the updated record.
   */
  updateBreakStatus(
    id: string,
    input: UpdateReconBreakStatusInput,
  ): Promise<ReconBreakRecord>;
}
