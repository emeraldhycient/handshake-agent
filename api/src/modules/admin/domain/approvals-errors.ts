/**
 * Admin APPROVALS / maker-checker domain errors (Phase 7). Pure — no Nest, no
 * Prisma. Extends the shared `AdminError` base so each carries a stable `code` the
 * global DomainExceptionFilter maps to an HTTP status without importing the class
 * (mirrors every other admin domain error).
 */

import { AdminError } from './admin-errors';

/**
 * The requester tried to approve/reject their OWN change request. The four-eyes
 * principle requires a DIFFERENT admin to decide — self-approval is forbidden.
 * Maps to HTTP 403 (Forbidden): the actor is authenticated and permissioned but
 * is not allowed to be the checker on their own request.
 */
export class SelfApprovalForbiddenError extends AdminError {
  readonly code = 'ADMIN_SELF_APPROVAL_FORBIDDEN' as const;
  constructor() {
    super('You cannot approve or reject your own change request.');
  }
}

/**
 * A decision (approve/reject) was attempted on a request that is no longer
 * pending — it was already approved or rejected. Maps to HTTP 409 (Conflict): the
 * request is well-formed but the resource is in a terminal state. Idempotency is
 * enforced by this guard, so a decision is applied at most once.
 */
export class ChangeRequestNotPendingError extends AdminError {
  readonly code = 'ADMIN_CHANGE_REQUEST_NOT_PENDING' as const;
  constructor(status: string) {
    super(
      `This change request is '${status}', not 'pending' — no decision can be recorded.`,
    );
  }
}

/**
 * A change request's `kind`/`payload` could not be applied because it does not map
 * to a registered applier or the payload is malformed for its kind. Maps to HTTP
 * 422 (Unprocessable Entity): the request was well-formed at creation but the
 * apply step re-validated it and found it unexecutable — fail closed, never guess.
 */
export class ChangeRequestNotApplicableError extends AdminError {
  readonly code = 'ADMIN_CHANGE_REQUEST_NOT_APPLICABLE' as const;
  constructor(detail: string) {
    super(`This change request cannot be applied: ${detail}`);
  }
}
