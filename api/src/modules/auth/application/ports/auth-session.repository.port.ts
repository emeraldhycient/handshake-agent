export const AUTH_SESSION_REPOSITORY = Symbol('AUTH_SESSION_REPOSITORY');

export interface IAuthSessionRepository {
  create(input: {
    userId: string;
    deviceId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<{ sessionId: string }>;

  findActiveByAccessHash(
    accessTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null>;

  findActiveByRefreshHash(
    refreshTokenHash: string,
    now: Date,
  ): Promise<{ id: string; userId: string; deviceId: string | null } | null>;

  rotate(
    sessionId: string,
    input: { accessTokenHash: string; refreshTokenHash: string; now: Date },
  ): Promise<void>;

  revoke(sessionId: string, now: Date, reason?: string): Promise<void>;
}
