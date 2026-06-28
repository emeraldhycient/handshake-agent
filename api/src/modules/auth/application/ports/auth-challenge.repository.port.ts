export const AUTH_CHALLENGE_REPOSITORY = Symbol('AUTH_CHALLENGE_REPOSITORY');

export type AuthChallengeType = 'email_verification' | 'otp_email';

export interface IAuthChallengeRepository {
  /** Upserts the single active challenge for (userId, type), resetting attempts. */
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
