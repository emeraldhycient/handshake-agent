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
}

export interface IAuthUserRepository {
  /**
   * Creates a provisional User with the (lowercased) email + a pending WhatsApp
   * ChannelIdentity for the phone (the later-link hook, §3.4). If the email
   * already exists, returns its userId with created:false (no duplicate). If the
   * phone already has an active WhatsApp ChannelIdentity, the CI is skipped.
   */
  createSignup(input: {
    email: string;
    phone: string;
  }): Promise<{ userId: string; created: boolean }>;

  findByEmail(email: string): Promise<AuthUserRecord | null>;

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
