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
  /** When the KYC tier last changed; drives the tier-change cooling-off gate. */
  tierChangedAt: Date | null;
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

/**
 * Originator attribution projection for the payment provider's customer object
 * (real KYC name + a verified email) used by the execution engine when opening
 * a fiat pay-in collection — so a virtual-account pay-in carries correct
 * customer attribution for reconciliation/compliance instead of a placeholder.
 *
 * Joins the non-sensitive KycProfile name fields with the User's email columns.
 * Email resolution (which of the two columns to use) is a business rule the
 * application layer applies — both candidate columns are returned raw here.
 */
export interface OriginatorIdentityRecord {
  firstName: string | null;
  lastName: string | null;
  /** KYC-captured out-of-band backup email (compliance-canonical). */
  verifiedEmail: string | null;
  /** Web account login email (OTP-verified at signup). */
  email: string | null;
}

/**
 * User-editable profile settings (Wave C web settings page). Contact/display
 * preferences only — NEVER identity or auth anchors (§3.4).
 */
export interface ProfileSettingsRecord {
  /** User-set contact phone; null = fall back to the WhatsApp routing number. */
  profilePhone: string | null;
  /** Preferred display fiat (catalog-validated); null = catalog default. */
  preferredFiatCurrency: string | null;
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
// Admin user-management + KYC-review record types (Phase 2, Task 2).
// Read-only projections consumed by the admin module. Sensitive identifiers
// (nin/bvn) are returned raw here; the SERVICE truncates them to last-4 before
// they leave the backend (never exposed in full to the admin console).
// ---------------------------------------------------------------------------

/** A per-asset aggregate of a user's cached wallet balances (list projection). */
export interface AdminUserBalanceSummaryRecord {
  asset: string;
  amount: string;
}

/** Row shape for the paginated admin user list. */
export interface AdminUserListRecord {
  id: string;
  email: string | null;
  /** KYC first/last name (raw, non-sensitive); the service derives displayName. */
  firstName: string | null;
  lastName: string | null;
  status: string;
  kycStatus: string;
  kycTier: string;
  simSwapDetectedAt: Date | null;
  /** A prior sanctions screening produced a `hit` verdict for this user. */
  sanctionsFlagged: boolean;
  /** Per-asset aggregate of the user's cached wallet_balances rows. */
  balances: AdminUserBalanceSummaryRecord[];
  /** Latest real activity (session / device / transaction), NOT registration. */
  lastActiveAt: Date | null;
  createdAt: Date;
}

/**
 * Row shape for the KYC review queue — the user list joined with the applicant's
 * KYC profile so the queue can show a display name + the requested (target) tier.
 * `firstName`/`lastName`/`requestedTier` are null when no KycProfile row exists.
 * The SUBMITTED-AT source is `createdAt` (the account row); the service derives
 * the SLA age from it.
 */
export interface KycQueueRecord {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** The KYC profile's target tier (what the applicant is requesting). */
  requestedTier: string | null;
  kycStatus: string;
  createdAt: Date;
}

/** Paginated result for the KYC review queue. */
export interface KycQueueListResult {
  items: KycQueueRecord[];
  nextCursor: string | null;
}

/** Filter for the KYC review queue — the kycStatus bucket to list. */
export interface KycQueueFilters {
  status: string;
}

/** A device as projected for the admin user-detail view. */
export interface DeviceRecord {
  id: string;
  trustState: string;
  lastUsedAt: Date | null;
  boundAt: Date | null;
}

/**
 * KYC fields for the admin user-detail view. nin/bvn are RAW as stored — the
 * service truncates to last-4 before responding.
 */
export interface KycDetailRecord {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: Date | null;
  nin: string | null;
  bvn: string | null;
  idDocumentType: string | null;
  livenessCheckResult: string;
  status: string;
  tier: string;
  rejectionReason: string | null;
}

/** Composite admin user-detail projection (user + kyc + devices). */
export interface UserAdminDetailRecord {
  id: string;
  email: string | null;
  status: string;
  kycStatus: string;
  kycTier: string;
  simSwapDetectedAt: Date | null;
  createdAt: Date;
  pinnedDeviceId: string | null;
  kyc: KycDetailRecord | null;
  devices: DeviceRecord[];
}

/** Filters accepted by `listUsers`. */
export interface AdminUserListFilters {
  query?: string;
  status?: string;
  kycStatus?: string;
  kycTier?: string;
}

/** Cursor-pagination input shared by the admin list reads. */
export interface AdminUserListPage {
  cursor?: string;
  limit: number;
}

/** Paginated result for the admin user lists. */
export interface AdminUserListResult {
  items: AdminUserListRecord[];
  nextCursor: string | null;
  /** Total rows matching the filters, independent of the cursor page. */
  total: number;
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
   * Returns the originator attribution projection (KYC name + candidate emails)
   * for the given userId, or null if the User row does not exist.
   *
   * Used by the execution engine to populate the payment provider's customer
   * object on a fiat pay-in. Name fields are null when no KycProfile exists yet;
   * email fields are null when the user has not captured that email.
   */
  findOriginatorIdentity(
    userId: string,
  ): Promise<OriginatorIdentityRecord | null>;

  /**
   * Returns the user's editable profile settings, or null when no User row
   * exists. Used by ProfileService to prefer the user-set phone/fiat over the
   * derived defaults.
   */
  findProfileSettings(userId: string): Promise<ProfileSettingsRecord | null>;

  /**
   * Persists the provided profile settings (partial patch — only the supplied
   * keys are written). Values are validated by the APPLICATION layer before
   * this is called (phone shape by the contract schema; fiat against the live
   * AssetRegistry catalog, §3.3).
   */
  updateProfileSettings(
    userId: string,
    patch: { profilePhone?: string; preferredFiatCurrency?: string },
  ): Promise<void>;

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

  // -------------------------------------------------------------------------
  // Admin user-management + KYC-review reads/writes (Phase 2, Task 2).
  // -------------------------------------------------------------------------

  /**
   * Cursor-paginated admin user list. `query` matches email (contains,
   * case-insensitive); `status`/`kycTier` are exact matches. Ordered by
   * createdAt desc, id desc; cursor is the last item's id.
   */
  listUsers(
    filters: AdminUserListFilters,
    page: AdminUserListPage,
  ): Promise<AdminUserListResult>;

  /**
   * Same pagination contract as `listUsers`, scoped to users whose kycStatus
   * is 'pending_review' (the admin KYC review queue).
   */
  listUsersPendingKycReview(
    page: AdminUserListPage,
  ): Promise<AdminUserListResult>;

  /**
   * KYC review queue scoped to the given kycStatus bucket, joined with the KYC
   * profile so each row carries the applicant name + requested (target) tier.
   * Same keyset pagination as `listUsers` (createdAt desc, id desc). Feeds the
   * admin console's Pending / Needs-info / Approved / Rejected status tabs.
   */
  listKycReviewQueue(
    filters: KycQueueFilters,
    page: AdminUserListPage,
  ): Promise<KycQueueListResult>;

  /**
   * Composite admin user-detail projection: the user plus its KYC profile
   * (raw nin/bvn — truncated by the service) and devices. Null if no user.
   */
  loadUserWithKycAndDevices(
    userId: string,
  ): Promise<UserAdminDetailRecord | null>;

  /**
   * Returns true if the user has any persisted sanctions screening whose verdict
   * is a `hit` — the authoritative per-user sanctions flag. Used by money-moving
   * admin endpoints to re-check sanctions server-side (§3.3) before the engine
   * runs; mirrors the `sanctionsFlaggedIds` aggregation the admin list computes.
   */
  hasSanctionsHit(userId: string): Promise<boolean>;

  /** Returns the user's devices as admin-facing DeviceRecords. */
  listDevicesForUser(userId: string): Promise<DeviceRecord[]>;

  /** Sets User.status. */
  setUserStatus(userId: string, status: string): Promise<void>;

  /** Sets User.kycTier. */
  setKycTier(userId: string, tier: string): Promise<void>;

  /** Sets (or clears, when null) User.simSwapDetectedAt. */
  setSimSwapDetectedAt(userId: string, at: Date | null): Promise<void>;

  /** Sets Device.trustState = 'revoked'. */
  revokeDevice(deviceId: string): Promise<void>;

  /** Clears User.pinnedDeviceId. */
  unpinDevice(userId: string): Promise<void>;

  /**
   * Forces the user back to a pending KYC state so re-verification is required
   * (Phase 9 admin "Force re-KYC"). Sets User.kycStatus = 'pending' and, when a
   * KycProfile row exists, mirrors its status to 'pending' in the SAME
   * transaction so the server-side gate (§3.3) never observes a partial reset.
   * A no-op on the profile when none exists. Moves no money (§3.1).
   */
  resetKycToPending(userId: string): Promise<void>;
}
