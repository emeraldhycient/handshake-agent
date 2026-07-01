/**
 * DI token and port for the sanctions-record repository (admin read-only view).
 *
 * SanctionsRecord is the immutable, append-only log of every screening run on a
 * counterparty (AUD-06). The admin compliance console reads it for trend analysis
 * and per-event drill-down. Infrastructure implements this port with Prisma; the
 * application layer never imports the generated client (CLAUDE.md §3.2 / §4.1).
 */
export const SANCTIONS_RECORD_REPOSITORY = Symbol(
  'SANCTIONS_RECORD_REPOSITORY',
);

/** App-layer string-literal union mirroring the Prisma `ScreeningVerdict` enum. */
export type ScreeningVerdictValue = 'clear' | 'hit' | 'inconclusive';

/** DB-agnostic projection of a sanctions screening record for the admin list. */
export interface SanctionsRecordRecord {
  id: string;
  counterpartyId: string;
  verdict: ScreeningVerdictValue;
  provider: string;
  screeningType: string;
  createdAt: Date;
}

export interface ISanctionsRecordRepository {
  /**
   * Lists sanctions screening records newest-first (createdAt desc, id desc),
   * capped at `limit`. The admin sanctions view is a bounded recent feed — no
   * cursor (the contract response carries `items` only).
   */
  list(page: { limit: number }): Promise<SanctionsRecordRecord[]>;
}
