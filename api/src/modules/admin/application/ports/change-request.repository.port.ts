/**
 * DI token + port for the admin CHANGE-REQUEST repository (maker-checker, Phase 7).
 *
 * Persists pending change requests and records their decision. The concrete Prisma
 * adapter lives in `admin/infrastructure`; application/domain depend only on this
 * abstraction (clean-arch §4.1, CLAUDE.md §3.2). This port stores/reads the request
 * envelope ONLY — it never applies the change (the service does that through the
 * target service's atomic path) and never touches the ledger (§3.1). Decimal-free;
 * `payload` is an opaque object bag; timestamps are `Date`.
 */

import type {
  ChangeRequestKind,
  ChangeRequestStatus,
} from '@handshake-agent/contracts';

export const CHANGE_REQUEST_REPOSITORY = Symbol('CHANGE_REQUEST_REPOSITORY');

/** A persisted change-request row (application-layer projection — never Prisma). */
export interface ChangeRequestRecord {
  id: string;
  kind: ChangeRequestKind;
  resource: string;
  payload: Record<string, unknown>;
  status: ChangeRequestStatus;
  reason: string;
  requestedByAdminId: string;
  decidedByAdminId: string | null;
  decisionReason: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}

export interface CreateChangeRequestInput {
  kind: ChangeRequestKind;
  resource: string;
  payload: Record<string, unknown>;
  reason: string;
  requestedByAdminId: string;
}

/** The terminal decision recorded on a request (approve or reject). */
export interface DecideChangeRequestInput {
  id: string;
  status: Extract<ChangeRequestStatus, 'approved' | 'rejected'>;
  decidedByAdminId: string;
  decisionReason: string | null;
  decidedAt: Date;
}

export interface IChangeRequestRepository {
  create(input: CreateChangeRequestInput): Promise<ChangeRequestRecord>;

  findById(id: string): Promise<ChangeRequestRecord | null>;

  /** All PENDING requests, newest-first (the inbox draws its lanes from these). */
  listPending(): Promise<ChangeRequestRecord[]>;

  /** Every request raised by this admin (any status), newest-first. */
  listByRequester(adminId: string): Promise<ChangeRequestRecord[]>;

  /**
   * Atomically flip a PENDING request to its terminal decision. Returns the
   * updated record, or null if the row was NOT pending (already decided) — the
   * guard against a double-decision race lives in this conditional update.
   */
  decideIfPending(
    input: DecideChangeRequestInput,
  ): Promise<ChangeRequestRecord | null>;

  /** Resolve admin ids → login emails for the inbox display (no PII, operators). */
  resolveEmails(adminIds: string[]): Promise<Map<string, string>>;
}
