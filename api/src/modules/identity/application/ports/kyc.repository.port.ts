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
// Port interface
// ---------------------------------------------------------------------------

export interface IKycRepository {
  /**
   * Atomically (one $transaction):
   *   1. Creates a User (status=active, kycStatus=verified, kycTier=tier_1, pinHash).
   *   2. Creates a KycProfile (status=verified, tier=tier_1, identity fields, verifiedAt=now).
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
   *   1. Upserts a KycProfile (status=verified, tier=tier_1, identity fields, verifiedAt=now).
   *   2. Updates User: kycStatus=verified, kycTier=tier_1, status=active, pinHash.
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
}
