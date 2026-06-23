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
  createdAt: Date;
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
}
