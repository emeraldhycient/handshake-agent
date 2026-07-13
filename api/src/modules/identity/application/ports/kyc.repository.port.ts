/**
 * DI token and port for the KYC repository (K2).
 *
 * Infrastructure provides the Prisma adapter; application only depends on this
 * symbol and the types below — it never imports @prisma/client (CLAUDE.md §3.2).
 */
import type { KycTierValue } from './kyc-provider.port';

export const KYC_REPOSITORY = Symbol('KYC_REPOSITORY');

// ---------------------------------------------------------------------------
// Admin KYC-review decision (Phase 2, Task 2)
// ---------------------------------------------------------------------------

export interface UpdateKycProfileDecisionInput {
  /** Target KYC status, e.g. 'verified' | 'rejected'. */
  status: string;
  /** Target KYC tier, e.g. 'tier_2' | 'unverified'. */
  tier: string;
  /** Set on rejection; null/undefined clears it (e.g. on approval). */
  rejectionReason?: string | null;
  /** AdminUser id of the reviewer (attribution; full trail in AuditLog). */
  reviewedByAdminId: string;
}

// ---------------------------------------------------------------------------
// Sumsub webhook write paths (task 3.6) — the ONLY writers of a KYC status/tier
// transition once a Sumsub review has posted. Kept as three FOCUSED methods
// (mirroring setSumsubApplicantId / markKycNeedsInfo) that touch only the
// status/tier fields relevant to a review outcome.
// ---------------------------------------------------------------------------

export interface GrantSumsubTierInput {
  userId: string;
  /** Always 'tier_2' or 'tier_3' in practice (SumsubReviewMapping.grantTier). */
  tier: KycTierValue;
  applicantId?: string;
  /**
   * Persisted on KycProfile.livenessCheckResult. Defaults to 'passed' when
   * omitted — a GREEN review implies the bundled liveness check passed too
   * (Sumsub's id-and-liveness level bundles both checks into one verdict).
   */
  livenessCheckResult?: string;
}

export interface GrantSumsubTierResult {
  /**
   * True when the tier was actually written (a strict upgrade). False is an
   * IDEMPOTENT NO-OP: the user was already at or above `tier` (a
   * redelivered/out-of-order GREEN webhook), or the userId does not match any
   * User row (unknown externalUserId) — the caller treats both the same way
   * (log + continue; the webhook still ACKs, §3.1).
   */
  granted: boolean;
}

export interface MarkSumsubStatusResult {
  /** False when no User row exists for the given id — a graceful no-op signal. */
  found: boolean;
}

// ---------------------------------------------------------------------------
// Port interface
// ---------------------------------------------------------------------------

export interface IKycRepository {
  /**
   * Applies an admin KYC-review decision atomically (one $transaction):
   *   1. Updates the KycProfile (status/tier/rejectionReason/reviewedByAdminId;
   *      verifiedAt is stamped when the decision is 'verified', else left null).
   *   2. Mirrors the decision onto the User (kycStatus/kycTier) so the
   *      server-side gate (§3.3) reflects it without a second read.
   *
   * Pre-condition: the KycProfile already exists (created during submission).
   */
  updateKycProfileDecision(
    userId: string,
    decision: UpdateKycProfileDecisionInput,
  ): Promise<void>;

  /**
   * Bounces a KYC submission back to the user for more information (Phase 9
   * admin "Request info"). Atomically (one $transaction):
   *   1. Sets the KycProfile status to `needs_info` and stamps
   *      `reviewedByAdminId` (attribution — the full trail lives in AuditLog).
   *      Tier, verifiedAt, and rejectionReason are left untouched — the review
   *      is PAUSED, not decided, so this is neither a verification nor a
   *      rejection.
   *   2. Mirrors `needs_info` onto the User's kycStatus so the server-side gate
   *      (§3.3) reflects the paused state without a second read.
   *
   * The operator's reason is captured in the immutable audit trail, not as a
   * KycProfile column. Pre-condition: the KycProfile already exists.
   */
  markKycNeedsInfo(userId: string, reviewedByAdminId: string): Promise<void>;

  /**
   * Persists the Sumsub applicant id onto the user's KycProfile (task 3.4) —
   * upserts the profile if none exists yet (status/tier take their schema
   * defaults, `not_started`/`unverified`). This is a FOCUSED write: it never
   * touches kycStatus or kycTier — the Sumsub `applicantReviewed` webhook
   * (tasks 3.5/3.6) owns every status/tier transition, so minting a token for
   * an abandoned session can never strand the account mid-review.
   */
  setSumsubApplicantId(userId: string, applicantId: string): Promise<void>;

  /**
   * Sumsub GREEN review → tier grant (task 3.6). Atomically, in ONE
   * $transaction:
   *   1. A single GUARDED update — `User.kycTier` is written to `tier` (with
   *      `kycStatus='verified'`, `tierChangedAt=now`) ONLY when the row's
   *      CURRENT `kycTier` is strictly below `tier`. This is a single
   *      conditional UPDATE (not a read-then-write), so there is no TOCTOU race
   *      between the eligibility check and the write — the idempotent
   *      no-downgrade guarantee holds even under concurrent redelivery.
   *   2. If (and only if) step 1 actually wrote a row, upserts
   *      `KycProfile.status='verified'` / `tier` / `sumsubApplicantId` /
   *      `livenessCheckResult` / `verifiedAt=now`.
   *
   * A redelivered/out-of-order webhook for a user already at or above `tier`
   * is a pure no-op (`granted: false`): `tierChangedAt` is NOT re-stamped (a
   * replayed GREEN must never restart the tier-change cooling-off window,
   * §3.3) and nothing is downgraded. An unknown `userId` resolves the same way.
   */
  grantSumsubTier(input: GrantSumsubTierInput): Promise<GrantSumsubTierResult>;

  /**
   * Sumsub RED review → rejection (task 3.6). Sets `User.kycStatus='rejected'`
   * and upserts `KycProfile.status='rejected'` + `rejectionReason`, in one
   * $transaction. Tier is NEVER touched — a rejection revokes verified STATUS,
   * not a previously-granted tier. Unlike `markSumsubPendingReview`, this is
   * NOT guarded against an existing `verified` status: a RED review is Sumsub's
   * authoritative negative determination (e.g. a post-verification fraud
   * finding) and must apply even after an earlier GREEN. `found: false` when no
   * User row exists (graceful no-op — see `GrantSumsubTierResult`).
   */
  markSumsubRejected(
    userId: string,
    reason: string,
  ): Promise<MarkSumsubStatusResult>;

  /**
   * A Sumsub webhook carrying no `reviewResult` (e.g. `applicantPending`/
   * `applicantCreated`, task 3.6) → pending_review. Sets
   * `User.kycStatus='pending_review'` and upserts
   * `KycProfile.status='pending_review'`, in one $transaction — GUARDED so a
   * late/out-of-order pending signal can never un-verify a completed GREEN
   * review: the write only applies when the user's current `kycStatus` is NOT
   * already `verified` (a single conditional UPDATE, same no-TOCTOU shape as
   * `grantSumsubTier`). `found: false` when no User row exists.
   */
  markSumsubPendingReview(userId: string): Promise<MarkSumsubStatusResult>;

  /**
   * Sumsub RED review at a KNOWN level → auto-downgrade (the compliance
   * policy: a RED at a given level means that level's verification failed,
   * so the user drops to the rung below it — see `tierBelow` in
   * `identity/domain/tier-order.ts`). Atomically, in ONE $transaction:
   *   1. Always sets `User.kycStatus='rejected'` and upserts
   *      `KycProfile.status='rejected'` + `rejectionReason=reason` — the
   *      same unconditional rejection `markSumsubRejected` applies.
   *   2. A GUARDED downgrade — `User.kycTier` is written to `targetTier`
   *      (with `tierChangedAt=now`) ONLY when the row's CURRENT `kycTier` is
   *      strictly ABOVE `targetTier` (a single conditional `updateMany`,
   *      mirroring `grantSumsubTier`'s no-TOCTOU shape — no read-then-write
   *      race with a concurrent redelivery). When it wrote, `KycProfile.tier`
   *      is set to `targetTier` too.
   *
   * A user already AT or BELOW `targetTier` is left untouched: 0 rows match
   * the guard, so `tierChangedAt` is NOT re-stamped (a replayed RED must
   * never restart the tier-change cooling-off window, §3.3) and the tier is
   * never RAISED. `found: false` when no User row exists for `userId` — same
   * graceful no-op shape as `markSumsubRejected`/`grantSumsubTier`.
   */
  downgradeSumsubTier(
    userId: string,
    targetTier: KycTierValue,
    reason: string,
  ): Promise<MarkSumsubStatusResult>;
}
