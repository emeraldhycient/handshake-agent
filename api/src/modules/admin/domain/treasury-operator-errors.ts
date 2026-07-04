/**
 * Treasury-operator domain errors (go-readiness #2). Pure — no Nest, no Prisma.
 * Extends the shared `AdminError` base so it carries a stable `code` the global
 * DomainExceptionFilter maps to an HTTP status without importing the class
 * (mirrors every other admin domain error).
 */

import { AdminError } from './admin-errors';

/**
 * A stuck sell payout cannot be retried because the owning user failed the
 * server-side re-check at retry time — SIM-swap block, KYC not verified, tier
 * downgrade, tier-change cooling-off, per-tx cap, or an open compliance block
 * (§3.3). Maps to HTTP 403 (Forbidden) — the action is not permitted for this
 * account. The retry service opens a compliance escalation BEFORE throwing this,
 * so a since-flagged user's stuck payout is surfaced, never pushed through.
 */
export class PayoutRetryBlockedError extends AdminError {
  readonly code = 'ADMIN_PAYOUT_RETRY_BLOCKED' as const;
  constructor(reason = 'This payout cannot be retried for this account.') {
    super(reason);
  }
}
