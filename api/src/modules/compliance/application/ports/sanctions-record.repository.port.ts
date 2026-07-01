/**
 * DI token and port for the sanctions-record repository (admin compliance console).
 *
 * SanctionsRecord is the append-only log of every screening run on a counterparty
 * (AUD-06): the screener's `verdict` is immutable evidence and is NEVER mutated. The
 * admin console reads the feed and DISPOSITIONS a match — an operator annotation
 * (cleared/escalated/blocked) written alongside the untouched verdict. Infrastructure
 * implements this port with Prisma; the application layer never imports the generated
 * client (CLAUDE.md §3.2 / §4.1).
 */
export const SANCTIONS_RECORD_REPOSITORY = Symbol(
  'SANCTIONS_RECORD_REPOSITORY',
);

/** App-layer string-literal union mirroring the Prisma `ScreeningVerdict` enum. */
export type ScreeningVerdictValue = 'clear' | 'hit' | 'inconclusive';

/** App-layer union mirroring the Prisma `SanctionsDisposition` enum. */
export type SanctionsDispositionValue = 'cleared' | 'escalated' | 'blocked';

/** DB-agnostic projection of a sanctions screening record for the admin list. */
export interface SanctionsRecordRecord {
  id: string;
  counterpartyId: string;
  verdict: ScreeningVerdictValue;
  provider: string;
  screeningType: string;
  /** The operator disposition, or null while the match is still open. */
  disposition: SanctionsDispositionValue | null;
  createdAt: Date;
}

/** Disposition write — the operator's decision on a screening match. */
export interface SanctionsDispositionInput {
  disposition: SanctionsDispositionValue;
  adminId: string;
  comment?: string;
  at: Date;
}

export interface ISanctionsRecordRepository {
  /**
   * Lists sanctions screening records newest-first (createdAt desc, id desc),
   * capped at `limit`. The admin sanctions view is a bounded recent feed — no
   * cursor (the contract response carries `items` only).
   */
  list(page: { limit: number }): Promise<SanctionsRecordRecord[]>;

  /** Read a single screening record by id (for disposition); null if absent. */
  findById(id: string): Promise<SanctionsRecordRecord | null>;

  /**
   * Records an operator disposition on a match: sets disposition +
   * dispositionAdminId/Comment/At. The immutable screener `verdict` is left
   * untouched; the full before/after trail lives in the AuditLog.
   */
  disposition(id: string, input: SanctionsDispositionInput): Promise<void>;
}
