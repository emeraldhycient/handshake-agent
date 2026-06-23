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
}
