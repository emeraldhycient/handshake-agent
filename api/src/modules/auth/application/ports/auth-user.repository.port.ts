export const AUTH_USER_REPOSITORY = Symbol('AUTH_USER_REPOSITORY');

export interface AuthUserRecord {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  kycStatus: string;
  kycTier: string;
  pinHash: string | null;
}

export interface MeProjection {
  userId: string;
  email: string;
  kycStatus: string;
  kycTier: string;
  hasPin: boolean;
  /** Null when the user has no KYC profile yet. */
  firstName: string | null;
  lastName: string | null;
}

export interface IAuthUserRepository {
  /**
   * Creates a provisional User with the (lowercased) email + a pending WhatsApp
   * ChannelIdentity for the phone (the later-link hook, §3.4). If the email
   * already exists, returns its userId with created:false (no duplicate). If the
   * phone already has an active WhatsApp ChannelIdentity, the CI is skipped.
   * When `phone` is absent/empty (email-only signup), no ChannelIdentity is
   * created at all.
   */
  createSignup(input: {
    email: string;
    phone?: string;
  }): Promise<{ userId: string; created: boolean }>;

  findByEmail(email: string): Promise<AuthUserRecord | null>;

  /**
   * Stamps `emailVerifiedAt` and, guarded, grants `kycTier=tier_1` +
   * `status=active` + `tierChangedAt=now` (Task 2.1: an email-verified
   * account may transact tier_1 capabilities — buy/receive — immediately,
   * §3.3). The tier grant only ever promotes a fresh `unverified` user: a
   * user already at tier_1/2/3 re-hitting verify is left unchanged (no
   * downgrade, no cooling-off re-stamp).
   */
  markEmailVerified(userId: string, now: Date): Promise<void>;

  /**
   * Upserts the Device by fingerprint, marks it bound, and pins it on the User
   * if no device is pinned yet. Returns the device id.
   */
  bindDevice(input: {
    userId: string;
    fingerprint: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ deviceId: string }>;

  loadMe(userId: string): Promise<MeProjection | null>;
}
