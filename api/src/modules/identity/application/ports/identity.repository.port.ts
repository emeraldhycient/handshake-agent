/**
 * DI token for the identity repository. Infrastructure provides the concrete
 * Prisma adapter; application only knows this symbol.
 */
export const IDENTITY_REPOSITORY = Symbol('IDENTITY_REPOSITORY');

// ---------------------------------------------------------------------------
// Application-level record types — NOT the Prisma-generated types.
// Only infrastructure maps Prisma rows to these; application stays DB-agnostic.
// ---------------------------------------------------------------------------

/** The subset of ChannelIdentity fields the service needs. */
export interface ChannelIdentityRecord {
  id: string;
  channel: string;
  channelAddress: string;
  contactId: string | null;
  userId: string | null;
  simSwapDetectedAt: Date | null;
}

/** The subset of User fields needed for identity resolution. */
export interface UserRecord {
  id: string;
  status: string;
  kycStatus: string;
  kycTier: string;
  simSwapDetectedAt: Date | null;
}

/**
 * Minimal KycProfile projection used by the execution engine to populate
 * Travel Rule originator identity fields (AUD-08, FATF R16).
 * Only non-sensitive name fields are exposed here; NIN/BVN/document refs
 * stay inside the KYC module.
 */
export interface KycProfileRecord {
  firstName: string | null;
  lastName: string | null;
}

/** The subset of Contact fields needed for identity resolution. */
export interface ContactRecord {
  id: string;
  primaryChannel: string;
  primaryAddress: string;
  status: string;
  linkedUserId: string | null;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface IIdentityRepository {
  /**
   * Returns the single active (deletedAt IS NULL) ChannelIdentity row for the
   * given channel + address, or null if none exists.
   */
  findActiveChannelIdentity(
    channel: string,
    channelAddress: string,
  ): Promise<ChannelIdentityRecord | null>;

  /**
   * Returns the channelAddress for the active WhatsApp ChannelIdentity linked
   * to the given userId, or null if none exists.
   * Used by the Flutterwave webhook handler to resolve a user's WhatsApp phone.
   */
  findWhatsAppAddressByUserId(userId: string): Promise<string | null>;

  /** Loads a User by id, or null if not found. */
  loadUser(userId: string): Promise<UserRecord | null>;

  /** Loads a Contact by id, or null if not found. */
  loadContact(contactId: string): Promise<ContactRecord | null>;

  /**
   * Returns the minimal KycProfile projection (name fields only) for the given
   * userId, or null if no KycProfile row exists yet.
   *
   * Used by the execution engine to populate Travel Rule originator identity
   * (AUD-08). Returns null rather than throwing when the profile is absent so
   * the engine can fall back to null gracefully (documented in TravelRuleData).
   */
  findKycProfile(userId: string): Promise<KycProfileRecord | null>;

  /**
   * Creates a Contact + a linked ChannelIdentity in a single transaction.
   * Returns both created records.
   */
  createContactWithChannelIdentity(input: {
    channel: string;
    channelAddress: string;
    normalizedPhone?: string;
  }): Promise<{
    contact: ContactRecord;
    channelIdentity: ChannelIdentityRecord;
  }>;
}
