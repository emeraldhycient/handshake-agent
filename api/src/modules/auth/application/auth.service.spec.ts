import { ConfigService } from '@nestjs/config';

import {
  InvalidOtpError,
  InvalidRefreshTokenError,
  InvalidVerificationTokenError,
  OtpLockedError,
  UserNotFoundError,
} from '../domain/auth-errors';
import { AuthService } from './auth.service';

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const tokenService = {
    generateOpaqueToken: jest.fn(() => 'opaque-token'),
    hash: jest.fn((v: string) => `hash(${v})`),
    generateNumericOtp: jest.fn(() => '123456'),
    signAccessToken: jest.fn(() => 'access.jwt'),
  };
  const email = {
    sendEmailVerification: jest.fn(() => Promise.resolve(undefined)),
    sendLoginOtp: jest.fn(() => Promise.resolve(undefined)),
    sendLoginInstead: jest.fn(() => Promise.resolve(undefined)),
  };
  const challengeRepo = {
    upsert: jest.fn(() => Promise.resolve(undefined)),
    // Return type must be broad enough for mockResolvedValueOnce({id, userId})
    findActiveByHashAndType: jest.fn<
      Promise<{ id: string; userId: string } | null>,
      [string, string, Date]
    >(() => Promise.resolve(null)),
    findActiveByUserAndType: jest.fn<
      Promise<{
        id: string;
        challengeHash: string;
        attemptCount: number;
      } | null>,
      [string, string, Date]
    >(() => Promise.resolve(null)),
    incrementAttempt: jest.fn(() => Promise.resolve(undefined)),
    consume: jest.fn(() => Promise.resolve(undefined)),
  };
  const userRepo = {
    createSignup: jest.fn(() =>
      Promise.resolve({ userId: 'u1', created: true }),
    ),
    findByEmail: jest.fn<
      Promise<{
        id: string;
        email: string;
        emailVerifiedAt: Date | null;
        kycStatus: string;
        kycTier: string;
        pinHash: string;
      } | null>,
      [string]
    >(() => Promise.resolve(null)),
    markEmailVerified: jest.fn(() => Promise.resolve(undefined)),
    bindDevice: jest.fn(() => Promise.resolve({ deviceId: 'd1' })),
    loadMe: jest.fn<
      Promise<{
        userId: string;
        email: string;
        kycStatus: string;
        kycTier: string;
        hasPin: boolean;
        firstName: string | null;
        lastName: string | null;
      } | null>,
      [string]
    >(() =>
      Promise.resolve({
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'not_started',
        kycTier: 'unverified',
        hasPin: false,
        firstName: null,
        lastName: null,
      }),
    ),
  };
  const sessionRepo = {
    create: jest.fn(() => Promise.resolve({ sessionId: 's1' })),
    findActiveByAccessHash: jest.fn<
      Promise<{ id: string; userId: string; deviceId: string } | null>,
      [string, Date]
    >(() => Promise.resolve(null)),
    findActiveByRefreshHash: jest.fn<
      Promise<{ id: string; userId: string; deviceId: string } | null>,
      [string, Date]
    >(() => Promise.resolve(null)),
    rotate: jest.fn(() => Promise.resolve(undefined)),
    revoke: jest.fn(() => Promise.resolve(undefined)),
  };
  const config = {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        AUTH_DEV_EXPOSE_OTP: 'false',
        'auth.emailToken.ttlSeconds': 86400,
        'auth.otp.ttlSeconds': 300,
        'auth.otp.length': 6,
        'auth.otp.maxAttempts': 5,
        'auth.jwt.refreshTtlSeconds': 2592000,
        ...overrides,
      };
      return map[key];
    },
  } as unknown as ConfigService;

  const service = new AuthService(
    tokenService as never,
    email,
    challengeRepo,
    userRepo,
    sessionRepo,
    config,
  );
  return { service, tokenService, email, challengeRepo, userRepo, sessionRepo };
}

describe('AuthService.signup', () => {
  it('creates the user, stores a hashed email-verification challenge, sends the email', async () => {
    const { service, email, challengeRepo, userRepo } = makeDeps();
    const res = await service.signup({
      email: 'a@b.com',
      phone: '+2348010000000',
    });
    expect(userRepo.createSignup).toHaveBeenCalledWith({
      email: 'a@b.com',
      phone: '+2348010000000',
    });
    expect(challengeRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'email_verification',
        challengeHash: 'hash(opaque-token)',
      }),
    );
    expect(email.sendEmailVerification).toHaveBeenCalledWith(
      'a@b.com',
      'opaque-token',
    );
    expect(res).toEqual({ status: 'pending_verification' });
  });

  it('echoes devToken when AUTH_DEV_EXPOSE_OTP=true', async () => {
    const { service } = makeDeps({ AUTH_DEV_EXPOSE_OTP: 'true' });
    const res = await service.signup({
      email: 'a@b.com',
      phone: '+2348010000000',
    });
    expect(res).toEqual({
      status: 'pending_verification',
      devToken: 'opaque-token',
    });
  });
});

describe('AuthService.verifyEmail', () => {
  it('consumes a valid token and marks the email verified', async () => {
    const { service, challengeRepo, userRepo } = makeDeps();
    challengeRepo.findActiveByHashAndType.mockResolvedValueOnce({
      id: 'c1',
      userId: 'u1',
    });
    const res = await service.verifyEmail({ token: 'opaque-token' });
    expect(challengeRepo.findActiveByHashAndType).toHaveBeenCalledWith(
      'hash(opaque-token)',
      'email_verification',
      expect.any(Date),
    );
    expect(challengeRepo.consume).toHaveBeenCalledWith('c1', expect.any(Date));
    expect(userRepo.markEmailVerified).toHaveBeenCalledWith(
      'u1',
      expect.any(Date),
    );
    expect(res).toEqual({ verified: true });
  });

  it('throws InvalidVerificationTokenError when no active challenge matches', async () => {
    const { service } = makeDeps();
    await expect(service.verifyEmail({ token: 'bad' })).rejects.toBeInstanceOf(
      InvalidVerificationTokenError,
    );
  });
});

describe('AuthService.loginRequest', () => {
  it('sends an OTP for a verified user and stores its hash', async () => {
    const { service, email, challengeRepo, userRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      emailVerifiedAt: new Date(),
      kycStatus: 'verified',
      kycTier: 'tier_1',
      pinHash: 'x',
    });
    const res = await service.loginRequest({ email: 'a@b.com' });
    expect(challengeRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'otp_email',
        challengeHash: 'hash(123456)',
      }),
    );
    expect(email.sendLoginOtp).toHaveBeenCalledWith('a@b.com', '123456');
    expect(res).toEqual({ status: 'otp_sent' });
  });

  it('does not send and still returns otp_sent for an unknown/unverified user (no enumeration)', async () => {
    const { service, email } = makeDeps();
    const res = await service.loginRequest({ email: 'ghost@b.com' });
    expect(email.sendLoginOtp).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'otp_sent' });
  });
});

describe('AuthService.resendLoginOtp', () => {
  it('re-issues a fresh OTP for a verified user (same neutral otp_sent response)', async () => {
    const { service, email, challengeRepo, userRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      emailVerifiedAt: new Date(),
      kycStatus: 'verified',
      kycTier: 'tier_1',
      pinHash: 'x',
    });
    const res = await service.resendLoginOtp({ email: 'a@b.com' });
    expect(challengeRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'otp_email' }),
    );
    expect(email.sendLoginOtp).toHaveBeenCalled();
    expect(res).toEqual({ status: 'otp_sent' });
  });

  it('is neutral for an unknown user (no send, no enumeration)', async () => {
    const { service, email } = makeDeps();
    const res = await service.resendLoginOtp({ email: 'ghost@b.com' });
    expect(email.sendLoginOtp).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'otp_sent' });
  });
});

describe('AuthService.resendEmailVerification', () => {
  it('re-issues a fresh verification token for an unverified existing user', async () => {
    const { service, email, challengeRepo, userRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      emailVerifiedAt: null, // not yet verified — needs a resend
      kycStatus: 'not_started',
      kycTier: 'unverified',
      pinHash: null as unknown as string,
    });
    const res = await service.resendEmailVerification({ email: 'a@b.com' });
    expect(challengeRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'email_verification' }),
    );
    expect(email.sendEmailVerification).toHaveBeenCalled();
    expect(res).toEqual({ status: 'pending_verification' });
  });

  it('does NOT re-send when the email is already verified (idempotent, neutral)', async () => {
    const { service, email, userRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      emailVerifiedAt: new Date(), // already verified — nothing to resend
      kycStatus: 'verified',
      kycTier: 'tier_1',
      pinHash: 'x',
    });
    const res = await service.resendEmailVerification({ email: 'a@b.com' });
    expect(email.sendEmailVerification).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'pending_verification' });
  });

  it('is neutral for an unknown user (no send, no enumeration)', async () => {
    const { service, email } = makeDeps();
    const res = await service.resendEmailVerification({ email: 'ghost@b.com' });
    expect(email.sendEmailVerification).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'pending_verification' });
  });
});

describe('AuthService.signupRequest', () => {
  it('creates-or-resumes the user, mints+sends a signup OTP, and echoes devOtp when dev-expose is on', async () => {
    const { service, email, challengeRepo, userRepo } = makeDeps({
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    userRepo.findByEmail.mockResolvedValueOnce(null); // brand-new email
    const res = await service.signupRequest({ email: 'new@b.com' });
    expect(userRepo.createSignup).toHaveBeenCalledWith({ email: 'new@b.com' });
    expect(challengeRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'otp_email',
        challengeHash: 'hash(123456)',
      }),
    );
    expect(email.sendLoginOtp).toHaveBeenCalledWith('new@b.com', '123456');
    expect(email.sendLoginInstead).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'otp_sent', devOtp: '123456' });
  });

  it('resumes an existing UNVERIFIED user (no duplicate) and mints a fresh OTP', async () => {
    const { service, email, challengeRepo, userRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      emailVerifiedAt: null,
      kycStatus: 'not_started',
      kycTier: 'unverified',
      pinHash: null as unknown as string,
    });
    const res = await service.signupRequest({ email: 'a@b.com' });
    expect(userRepo.createSignup).toHaveBeenCalledWith({ email: 'a@b.com' });
    expect(challengeRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'otp_email' }),
    );
    expect(email.sendLoginOtp).toHaveBeenCalled();
    expect(res).toEqual({ status: 'otp_sent' });
  });

  it('an already-verified email gets the SAME otp_sent shape but mints no usable OTP (no enumeration oracle)', async () => {
    const { service, email, challengeRepo, userRepo } = makeDeps({
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    userRepo.findByEmail.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      emailVerifiedAt: new Date(),
      kycStatus: 'verified',
      kycTier: 'tier_1',
      pinHash: 'x',
    });
    const res = await service.signupRequest({ email: 'a@b.com' });
    expect(userRepo.createSignup).not.toHaveBeenCalled();
    expect(challengeRepo.upsert).not.toHaveBeenCalled();
    expect(email.sendLoginOtp).not.toHaveBeenCalled();
    expect(email.sendLoginInstead).toHaveBeenCalledWith('a@b.com');
    // Same shape as the non-verified branch — no devOtp leak either, since
    // dev-expose only echoes an OTP that was actually minted.
    expect(res).toEqual({ status: 'otp_sent' });
  });
});

describe('AuthService.signupVerify', () => {
  const unverified = {
    id: 'u1',
    email: 'a@b.com',
    emailVerifiedAt: null,
    kycStatus: 'not_started',
    kycTier: 'unverified',
    pinHash: null as unknown as string,
  };

  it('verifies the OTP, marks the email verified (tier_1 grant), binds device, creates a session, and sets emailVerified:true', async () => {
    const { service, userRepo, challengeRepo, sessionRepo, tokenService } =
      makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(unverified);
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: 'c1',
      challengeHash: 'hash(123456)',
      attemptCount: 0,
    });
    tokenService.generateOpaqueToken.mockReturnValueOnce('refresh-token');
    userRepo.loadMe.mockResolvedValueOnce({
      userId: 'u1',
      email: 'a@b.com',
      kycStatus: 'not_started',
      kycTier: 'tier_1',
      hasPin: false,
      firstName: null,
      lastName: null,
    });

    const res = await service.signupVerify({
      email: 'a@b.com',
      otp: '123456',
      deviceFingerprint: 'fp-1',
    });

    expect(challengeRepo.consume).toHaveBeenCalledWith('c1', expect.any(Date));
    expect(userRepo.markEmailVerified).toHaveBeenCalledWith(
      'u1',
      expect.any(Date),
    );
    expect(userRepo.bindDevice).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', fingerprint: 'fp-1' }),
    );
    expect(sessionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        deviceId: 'd1',
        accessTokenHash: 'hash(access.jwt)',
        refreshTokenHash: 'hash(refresh-token)',
      }),
    );
    expect(res).toEqual({
      accessToken: 'access.jwt',
      refreshToken: 'refresh-token',
      user: {
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'not_started',
        kycTier: 'tier_1',
        hasPin: false,
        firstName: null,
        lastName: null,
        emailVerified: true,
      },
    });
  });

  it('throws InvalidOtpError on a wrong code, increments attempt, and never verifies or issues a session', async () => {
    const { service, userRepo, challengeRepo, sessionRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(unverified);
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: 'c1',
      challengeHash: 'hash(999999)',
      attemptCount: 0,
    });
    await expect(
      service.signupVerify({
        email: 'a@b.com',
        otp: '123456',
        deviceFingerprint: 'fp-1',
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
    expect(challengeRepo.incrementAttempt).toHaveBeenCalledWith('c1');
    expect(userRepo.markEmailVerified).not.toHaveBeenCalled();
    expect(sessionRepo.create).not.toHaveBeenCalled();
  });

  it('throws InvalidOtpError for an ALREADY-VERIFIED email — no usable challenge exists (no enumeration oracle), never verifies or issues a session', async () => {
    const { service, userRepo, challengeRepo, sessionRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.com',
      emailVerifiedAt: new Date(),
      kycStatus: 'verified',
      kycTier: 'tier_1',
      pinHash: 'x',
    });
    // Even if a challenge happens to exist under this real user id (e.g. a
    // stray login OTP the user requested separately), the eligibility gate
    // must reject BEFORE ever inspecting it — OtpLockedError must stay
    // structurally unreachable here, mirroring loginVerify's unknown-user
    // defence.
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: 'stray-login-otp',
      challengeHash: 'hash(123456)',
      attemptCount: 99,
    });
    await expect(
      service.signupVerify({
        email: 'a@b.com',
        otp: '123456',
        deviceFingerprint: 'fp-1',
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
    expect(userRepo.markEmailVerified).not.toHaveBeenCalled();
    expect(sessionRepo.create).not.toHaveBeenCalled();
  });

  it('throws InvalidOtpError for an unknown email — still performs a dummy challenge lookup (timing oracle defence)', async () => {
    const { service, userRepo, challengeRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(null);
    await expect(
      service.signupVerify({
        email: 'ghost@b.com',
        otp: '123456',
        deviceFingerprint: 'fp',
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
    expect(challengeRepo.findActiveByUserAndType).toHaveBeenCalledTimes(1);
    expect(challengeRepo.incrementAttempt).not.toHaveBeenCalled();
  });
});

describe('AuthService.loginVerify', () => {
  const verified = {
    id: 'u1',
    email: 'a@b.com',
    emailVerifiedAt: new Date(),
    kycStatus: 'verified',
    kycTier: 'tier_1',
    pinHash: 'x',
  };

  it('verifies the OTP, binds the device, creates a session, returns tokens + me', async () => {
    const { service, userRepo, challengeRepo, sessionRepo, tokenService } =
      makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(verified);
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: 'c1',
      challengeHash: 'hash(123456)',
      attemptCount: 0,
    });
    tokenService.generateOpaqueToken.mockReturnValueOnce('refresh-token');

    const res = await service.loginVerify({
      email: 'a@b.com',
      otp: '123456',
      deviceFingerprint: 'fp-1',
    });

    expect(challengeRepo.consume).toHaveBeenCalledWith('c1', expect.any(Date));
    expect(userRepo.bindDevice).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', fingerprint: 'fp-1' }),
    );
    expect(sessionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        deviceId: 'd1',
        accessTokenHash: 'hash(access.jwt)',
        refreshTokenHash: 'hash(refresh-token)',
      }),
    );
    expect(res).toEqual({
      accessToken: 'access.jwt',
      refreshToken: 'refresh-token',
      user: {
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'not_started',
        kycTier: 'unverified',
        hasPin: false,
        firstName: null,
        lastName: null,
      },
    });
  });

  it('throws InvalidOtpError and increments attempt on a wrong code', async () => {
    const { service, userRepo, challengeRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(verified);
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: 'c1',
      challengeHash: 'hash(999999)',
      attemptCount: 0,
    });
    await expect(
      service.loginVerify({
        email: 'a@b.com',
        otp: '123456',
        deviceFingerprint: 'fp-1',
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
    expect(challengeRepo.incrementAttempt).toHaveBeenCalledWith('c1');
  });

  it('throws OtpLockedError (distinct from a wrong code) when attempts are exhausted', async () => {
    const { service, userRepo, challengeRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(verified);
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: 'c1',
      challengeHash: 'hash(123456)',
      attemptCount: 5,
    });
    await expect(
      service.loginVerify({
        email: 'a@b.com',
        otp: '123456',
        deviceFingerprint: 'fp-1',
      }),
    ).rejects.toBeInstanceOf(OtpLockedError);
    expect(challengeRepo.incrementAttempt).not.toHaveBeenCalled();
  });

  it('throws OtpLockedError even when the supplied code happens to match (the budget is exhausted)', async () => {
    const { service, userRepo, challengeRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(verified);
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: 'c1',
      challengeHash: 'hash(123456)', // matches the supplied otp
      attemptCount: 5,
    });
    await expect(
      service.loginVerify({
        email: 'a@b.com',
        otp: '123456',
        deviceFingerprint: 'fp-1',
      }),
    ).rejects.toBeInstanceOf(OtpLockedError);
    // A locked challenge must NOT be consumed or grant a session.
    expect(challengeRepo.consume).not.toHaveBeenCalled();
  });

  it('throws InvalidOtpError (NOT OtpLockedError) for an unknown user even past the cap — no enumeration leak', async () => {
    const { service, userRepo, challengeRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(null);
    // Even if a dummy lookup somehow returned an exhausted challenge, an
    // unknown user must get the generic InvalidOtpError, never the locked one.
    challengeRepo.findActiveByUserAndType.mockResolvedValueOnce({
      id: 'dummy',
      challengeHash: 'hash(x)',
      attemptCount: 99,
    });
    await expect(
      service.loginVerify({
        email: 'ghost@b.com',
        otp: '123456',
        deviceFingerprint: 'fp',
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
  });

  it('throws InvalidOtpError for an unknown user — and still performs a challenge lookup + constant-time compare (timing oracle defence)', async () => {
    // Structural assertion: even when findByEmail returns null the service must
    // call findActiveByUserAndType (with the dummy UUID) so that DB latency is
    // not meaningfully different from the real-user path.
    const { service, userRepo, challengeRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(null);
    await expect(
      service.loginVerify({
        email: 'ghost@b.com',
        otp: '123456',
        deviceFingerprint: 'fp',
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
    // The dummy lookup must have fired
    expect(challengeRepo.findActiveByUserAndType).toHaveBeenCalledTimes(1);
    // incrementAttempt must NOT be called on unknown-user paths
    expect(challengeRepo.incrementAttempt).not.toHaveBeenCalled();
  });

  it('throws InvalidOtpError for an unverified user — and still performs a challenge lookup + constant-time compare (timing oracle defence)', async () => {
    const { service, userRepo, challengeRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce({
      id: 'u-unverified',
      email: 'unverified@b.com',
      emailVerifiedAt: null, // not verified
      kycStatus: 'not_started',
      kycTier: 'unverified',
      pinHash: '',
    });
    await expect(
      service.loginVerify({
        email: 'unverified@b.com',
        otp: '123456',
        deviceFingerprint: 'fp',
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
    // The dummy lookup must have fired (unverified user → dummy UUID path)
    expect(challengeRepo.findActiveByUserAndType).toHaveBeenCalledTimes(1);
    expect(challengeRepo.incrementAttempt).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('rotates a valid refresh token and returns a new pair PLUS the user projection', async () => {
    const { service, sessionRepo, tokenService, userRepo } = makeDeps();
    sessionRepo.findActiveByRefreshHash.mockResolvedValueOnce({
      id: 's1',
      userId: 'u1',
      deviceId: 'd1',
    });
    tokenService.signAccessToken.mockReturnValueOnce('new.access');
    tokenService.generateOpaqueToken.mockReturnValueOnce('new.refresh');
    const res = await service.refresh({ refreshToken: 'old.refresh' });
    expect(sessionRepo.findActiveByRefreshHash).toHaveBeenCalledWith(
      'hash(old.refresh)',
      expect.any(Date),
    );
    expect(sessionRepo.rotate).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        accessTokenHash: 'hash(new.access)',
        refreshTokenHash: 'hash(new.refresh)',
      }),
    );
    // Single round-trip boot rehydration: refresh loads + returns the user.
    expect(userRepo.loadMe).toHaveBeenCalledWith('u1');
    expect(res).toEqual({
      accessToken: 'new.access',
      refreshToken: 'new.refresh',
      user: {
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'not_started',
        kycTier: 'unverified',
        hasPin: false,
        firstName: null,
        lastName: null,
      },
    });
  });

  it('throws InvalidRefreshTokenError when the token is unknown', async () => {
    const { service } = makeDeps();
    await expect(
      service.refresh({ refreshToken: 'nope' }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('throws InvalidRefreshTokenError when neither cookie nor body supplied a token', async () => {
    // Cookie-primary: the controller passes {} when both the ha_refresh cookie
    // and the body token are absent. That is a 401, not a rotation.
    const { service, sessionRepo } = makeDeps();
    await expect(service.refresh({})).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    // Must short-circuit before any session lookup.
    expect(sessionRepo.findActiveByRefreshHash).not.toHaveBeenCalled();
  });

  it('throws InvalidRefreshTokenError when the session is valid but its user is gone', async () => {
    const { service, sessionRepo, userRepo } = makeDeps();
    sessionRepo.findActiveByRefreshHash.mockResolvedValueOnce({
      id: 's1',
      userId: 'u1',
      deviceId: 'd1',
    });
    userRepo.loadMe.mockResolvedValueOnce(null);
    await expect(
      service.refresh({ refreshToken: 'old.refresh' }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });
});

describe('AuthService.logout + me', () => {
  it('logout revokes the session', async () => {
    const { service, sessionRepo } = makeDeps();
    await service.logout('s1');
    expect(sessionRepo.revoke).toHaveBeenCalledWith('s1', expect.any(Date));
  });

  it('me returns the projection', async () => {
    const { service } = makeDeps();
    expect(await service.me('u1')).toEqual({
      userId: 'u1',
      email: 'a@b.com',
      kycStatus: 'not_started',
      kycTier: 'unverified',
      hasPin: false,
      firstName: null,
      lastName: null,
    });
  });

  it('me returns firstName and lastName when a KYC profile exists', async () => {
    const { service, userRepo } = makeDeps();
    userRepo.loadMe.mockResolvedValueOnce({
      userId: 'u1',
      email: 'a@b.com',
      kycStatus: 'verified',
      kycTier: 'tier_1',
      hasPin: true,
      firstName: 'Amara',
      lastName: 'Okeke',
    });
    expect(await service.me('u1')).toEqual(
      expect.objectContaining({ firstName: 'Amara', lastName: 'Okeke' }),
    );
  });

  it('me throws UserNotFoundError when the user account is missing (not an auth failure)', async () => {
    const { service, userRepo } = makeDeps();
    userRepo.loadMe.mockResolvedValueOnce(null);
    await expect(service.me('ghost')).rejects.toBeInstanceOf(UserNotFoundError);
  });
});
