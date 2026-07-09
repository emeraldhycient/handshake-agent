/**
 * DI token and port for the Travel-Rule repository (admin read-only view).
 *
 * TravelRuleData is the immutable originator/beneficiary capture on qualifying
 * transfers (AUD-08). The console lists captured records for reporting. Only
 * non-PII summary fields are projected here; the encrypted PII columns are never
 * surfaced to the list view. Infrastructure implements this port with Prisma; the
 * application layer never imports the generated client (CLAUDE.md §3.2 / §4.1).
 */
export const TRAVEL_RULE_REPOSITORY = Symbol('TRAVEL_RULE_REPOSITORY');

/** DB-agnostic projection of a Travel Rule capture (non-PII summary). */
export interface TravelRuleRecord {
  id: string;
  transactionId: string;
  asset: string;
  amount: string;
  amountFiat: string;
  /** The fiat currency `amountFiat` was valued in at capture time (snapshot). */
  fiatCurrency: string;
  triggeringFactor: string;
  capturedAt: Date;
  reportedAt: Date | null;
}

export interface ITravelRuleRepository {
  /**
   * Lists Travel Rule captures newest-first (capturedAt desc, id desc), capped
   * at `limit`. A bounded recent feed — no cursor (the contract carries items).
   */
  list(page: { limit: number }): Promise<TravelRuleRecord[]>;
}
