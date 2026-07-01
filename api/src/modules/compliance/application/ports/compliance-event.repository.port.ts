/**
 * DI token and port for the compliance event repository.
 *
 * The compliance event log is append-only — no UPDATE or DELETE.
 * Infrastructure implements this port using Prisma; application never imports
 * Prisma or the generated client directly (CLAUDE.md §3.2 / §4.1).
 */
export const COMPLIANCE_EVENT_REPOSITORY = Symbol(
  'COMPLIANCE_EVENT_REPOSITORY',
);

// ---------------------------------------------------------------------------
// Application-layer types (DB-agnostic)
// ---------------------------------------------------------------------------

/**
 * String-literal union for the compliance event type relevant to send screening.
 * Maps to the Prisma `ComplianceEventType` enum but defined here to keep the
 * application layer free of `@prisma/client`.
 */
export type ComplianceEventTypeValue =
  | 'sanctions_hit'
  | 'aml_rule_triggered'
  | 'velocity_limit_exceeded'
  | 'travel_rule_required'
  | 'policy_override'
  | 'kyc_escalation'
  | 'fraud_signal'
  | 'unusual_pattern';

/**
 * String-literal union for compliance status.
 * Maps to the Prisma `ComplianceStatus` enum.
 */
export type ComplianceStatusValue =
  | 'flagged'
  | 'under_review'
  | 'approved'
  | 'blocked'
  | 'dismissed';

/**
 * String-literal union for severity.
 * Maps to the Prisma `Severity` enum.
 */
export type SeverityValue = 'low' | 'medium' | 'high' | 'critical';

// ---------------------------------------------------------------------------
// Repository input / output
// ---------------------------------------------------------------------------

export interface CreateComplianceEventInput {
  userId: string;
  transactionId?: string | null;
  eventType: ComplianceEventTypeValue;
  severity: SeverityValue;
  screeningProvider: string;
  ruleOrHit?: string | null;
  details: Record<string, unknown>;
  status: ComplianceStatusValue;
}

export interface ComplianceEventRecord {
  id: string;
  userId: string;
  transactionId: string | null;
  eventType: ComplianceEventTypeValue;
  severity: SeverityValue;
  screeningProvider: string;
  ruleOrHit: string | null;
  details: Record<string, unknown>;
  status: ComplianceStatusValue;
  dispositionComment: string | null;
  dispositionAt: Date | null;
  createdAt: Date;
}

/** Filter for the admin flagged-event queue (all fields optional). */
export interface ComplianceEventListFilter {
  status?: string;
  severity?: string;
  userId?: string;
}

/** Disposition write — the admin's verdict on a flagged event (AUD-09 trail). */
export interface ComplianceEventDispositionInput {
  status: ComplianceStatusValue;
  adminId: string;
  comment?: string;
  at: Date;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IComplianceEventRepository {
  /**
   * Appends a new compliance event. Append-only — no updates or deletes.
   * Implementations must be idempotent-safe (safe to retry the same input
   * on failure; the caller supplies idempotency context in `details`).
   */
  create(input: CreateComplianceEventInput): Promise<ComplianceEventRecord>;

  /**
   * Admin flagged-event queue: filtered, keyset-paginated (createdAt desc, id
   * desc) by the optional status/severity/userId filter. `cursor` is the
   * last-seen event id; returns up to `limit` records + the next cursor.
   */
  listByStatus(
    filter: ComplianceEventListFilter,
    page: { cursor?: string; limit: number },
  ): Promise<{ items: ComplianceEventRecord[]; nextCursor: string | null }>;

  /** Read a single event by id (for the detail view); null if absent. */
  findById(id: string): Promise<ComplianceEventRecord | null>;

  /**
   * Records an admin disposition: sets status, dispositionAdminId,
   * dispositionComment, dispositionAt. The full before/after trail lives in
   * the AuditLog (this only writes the operational state).
   */
  updateDisposition(
    id: string,
    input: ComplianceEventDispositionInput,
  ): Promise<void>;
}
