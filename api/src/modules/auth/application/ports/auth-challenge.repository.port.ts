export const AUTH_CHALLENGE_REPOSITORY = Symbol('AUTH_CHALLENGE_REPOSITORY');

export type AuthChallengeType = 'email_verification' | 'otp_email';

export interface IAuthChallengeRepository {
  /**
   * Upserts the single active challenge for (userId, type).
   *
   * Attempt-counter reset policy (security invariant):
   * - `email_verification`: always resets attemptCount to 0 on re-issue (low
   *   abuse risk; the token is opaque + long-lived, not a short numeric OTP).
   * - `otp_email`: preserves the existing attemptCount when an unexpired,
   *   unconsumed challenge already exists. This prevents the unlimited-window
   *   attack where repeated login/request calls each grant a fresh 5-guess
   *   budget. A new OTP hash is still issued (so the old code is invalidated),
   *   but the guess counter keeps accumulating until the challenge expires or
   *   is consumed. On first creation (no prior row) the counter starts at 0.
   */
  upsert(input: {
    userId: string;
    type: AuthChallengeType;
    challengeHash: string;
    expiresAt: Date;
  }): Promise<void>;

  /** Finds an unconsumed, unexpired challenge by hash+type (email-verify path). */
  findActiveByHashAndType(
    challengeHash: string,
    type: AuthChallengeType,
    now: Date,
  ): Promise<{ id: string; userId: string } | null>;

  /** Finds an unconsumed, unexpired challenge by user+type (login-OTP path). */
  findActiveByUserAndType(
    userId: string,
    type: AuthChallengeType,
    now: Date,
  ): Promise<{
    id: string;
    challengeHash: string;
    attemptCount: number;
  } | null>;

  incrementAttempt(id: string): Promise<void>;

  /** Marks the challenge consumed (sets verifiedAt) — single-use. */
  consume(id: string, now: Date): Promise<void>;
}
