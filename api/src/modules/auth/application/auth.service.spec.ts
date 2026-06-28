import { ConfigService } from '@nestjs/config';

import {
  InvalidOtpError,
  InvalidVerificationTokenError,
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
    loadMe: jest.fn(() =>
      Promise.resolve({
        userId: 'u1',
        email: 'a@b.com',
        kycStatus: 'not_started',
        kycTier: 'unverified',
        hasPin: false,
      }),
    ),
  };
  const sessionRepo = {
    create: jest.fn(() => Promise.resolve({ sessionId: 's1' })),
    findActiveByAccessHash: jest.fn(() => Promise.resolve(null)),
    findActiveByRefreshHash: jest.fn(() => Promise.resolve(null)),
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

  it('throws InvalidOtpError when attempts are exhausted', async () => {
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
    ).rejects.toBeInstanceOf(InvalidOtpError);
  });

  it('throws InvalidOtpError when no challenge or user is unverified', async () => {
    const { service, userRepo } = makeDeps();
    userRepo.findByEmail.mockResolvedValueOnce(null);
    await expect(
      service.loginVerify({
        email: 'x@b.com',
        otp: '1',
        deviceFingerprint: 'fp',
      }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
  });
});
