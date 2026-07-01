/**
 * Admin transaction-triage domain errors (Phase 3, sub-area B). Pure — no Nest,
 * no Prisma. Extends the shared `AdminError` base so it carries a stable `code`
 * the global DomainExceptionFilter maps to an HTTP status without importing the
 * class (mirrors every other admin domain error).
 */

import { AdminError } from './admin-errors';

/**
 * A transaction cannot be triaged in its current state, e.g.:
 *   - status is not `settling` (already completed / still pending / rolled back),
 *   - its `type` holds no user reserve to refund (buy / deposit / reward / refund).
 * Maps to HTTP 409 (Conflict) — the request is well-formed but the resource is in
 * a state where the action makes no sense.
 */
export class TxnNotTriageableError extends AdminError {
  readonly code = 'ADMIN_TXN_NOT_TRIAGEABLE' as const;
  constructor(
    message = 'This transaction cannot be triaged in its current state.',
  ) {
    super(message);
  }
}
