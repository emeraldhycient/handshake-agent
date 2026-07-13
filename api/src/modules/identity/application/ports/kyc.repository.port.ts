/**
 * DI token and port for the KYC repository (K2).
 *
 * The atomic write path — `completeVerificationAtomic` — is the only method
 * in this port; all reads go through IIdentityRepository. This keeps the port
 * minimal and the $transaction boundary explicit.
 *
 * Infrastructure provides the Prisma adapter; application only depends on this
 * symbol and the types below — it never imports @prisma/client (CLAUDE.md §3.2).
 */
import type { KycTierValue } from './kyc-provider.port';

export const KYC_REPOSITORY = Symbol('KYC_REPOSITORY');

// ---------------------------------------------------------------------------
// Input / output shapes (application-layer records — not Prisma types)
// ---------------------------------------------------------------------------

export interface CompleteVerificationAtomicInput {
  /** The ChannelIdentity row to link (set userId + verificationStatus). */
  channelIdentityId: string;
  /** The Contact row to link (set linkedUserId). */
  contactId: string;
  /** KYC fields to persist on the KycProfile. */
  nin: string | undefined;
  bvn: string | undefined;
  firstName: string;
  lastName: string;
  dateOfBirth: string | undefined;
  /** scrypt hash of the raw PIN — the ONLY form that reaches the DB. */
  pinHash: string;
  /** The tier granted by IKycProvider — persisted as-is, never hardcoded. */
  tier: KycTierValue;
  /** Timestamp used for verifiedAt on both KycProfile and ChannelIdentity. */
  now: Date;
}

export interface CompleteVerificationAtomicResult {
  userId: string;
}

// ---------------------------------------------------------------------------
// Input / output shapes for completeVerificationForUserAtomic
// (web-native user path — User already exists from email signup)
// ---------------------------------------------------------------------------

export interface CompleteVerificationForUserAtomicInput {
  /** The already-existing User row to upgrade. */
  userId: string;
  nin?: string;
  bvn?: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  /** scrypt hash of the raw PIN — the ONLY form that reaches the DB. */
  pinHash: string;
  /** The tier granted by IKycProvider — persisted as-is, never hardcoded. */
  tier: KycTierValue;
  /** Timestamp used for verifiedAt on the KycProfile. */
  now: Date;
}

export interface CompleteVerificationForUserAtomicResult {
  userId: string;
}

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
// (mirroring setSumsubApplicantId / markKycNeedsInfo) rather than reusing
// completeVerificationAtomic/completeVerificationForUserAtomic, which also
// write name/pin fields that are already set by this point in onboarding.
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
   * Atomically (one $transaction):
   *   1. Creates a User (status=active, kycStatus=verified, kycTier=input.tier, pinHash).
   *   2. Creates a KycProfile (status=verified, tier=input.tier, identity fields, verifiedAt=now).
   *   3. Links the Contact (linkedUserId = user.id).
   *   4. Links the ChannelIdentity (userId = user.id, verificationStatus=verified, verifiedAt=now).
   *
   * Returns { userId } of the newly created User.
   *
   * Pre-condition: the caller has already confirmed the Contact is unlinked.
   * Any DB constraint violation (e.g. duplicate User) bubbles up as-is.
   */
  completeVerificationAtomic(
    input: CompleteVerificationAtomicInput,
  ): Promise<CompleteVerificationAtomicResult>;

  /**
   * Atomically (one $transaction):
   *   1. Upserts a KycProfile (status=verified, tier=input.tier, identity fields, verifiedAt=now).
   *   2. Updates User: kycStatus=verified, kycTier=input.tier, status=active, pinHash.
   *
   * Returns { userId } of the updated User.
   *
   * Pre-condition: the caller has confirmed the User is not already verified
   * (idempotent check is in the service layer).
   */
  completeVerificationForUserAtomic(
    input: CompleteVerificationForUserAtomicInput,
  ): Promise<CompleteVerificationForUserAtomicResult>;

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
}
