import {
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import type { MeResponse } from '@handshake-agent/contracts';

import { AuthService } from '../application/auth.service';
import {
  InvalidOtpError,
  InvalidRefreshTokenError,
  OtpLockedError,
  UserNotFoundError,
} from '../domain/auth-errors';
import { AuthController } from './auth.controller';
import type { AuthenticatedUser } from './jwt-auth.guard';

const CURRENT_USER: AuthenticatedUser = {
  userId: 'u1',
  sessionId: 's1',
  deviceId: 'd1',
};

const ME: MeResponse = {
  userId: 'u1',
  email: 'a@b.com',
  kycStatus: 'not_started',
  kycTier: 'unverified',
  hasPin: false,
};

function makeController(me: jest.Mock) {
  const auth = { me } as unknown as AuthService;
  return new AuthController(auth);
}

describe('AuthController.me', () => {
  it('returns the projection for an existing user', async () => {
    const controller = makeController(jest.fn().mockResolvedValue(ME));
    await expect(controller.me(CURRENT_USER)).resolves.toEqual(ME);
  });

  it('maps UserNotFoundError to 404 Not Found (deleted account, not an auth failure)', async () => {
    const controller = makeController(
      jest.fn().mockRejectedValue(new UserNotFoundError()),
    );
    await expect(controller.me(CURRENT_USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('still maps InvalidRefreshTokenError to 401 (distinct from the missing-user case)', async () => {
    const controller = makeController(
      jest.fn().mockRejectedValue(new InvalidRefreshTokenError()),
    );
    await expect(controller.me(CURRENT_USER)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('AuthController.loginVerify — OTP lockout distinction', () => {
  function makeAuthController(loginVerify: jest.Mock): AuthController {
    const auth = { loginVerify } as unknown as AuthService;
    return new AuthController(auth);
  }

  const body = {
    email: 'a@b.com',
    otp: '123456',
    deviceFingerprint: 'fp-12345678',
  } as never;

  it('maps a wrong code (InvalidOtpError) to a generic 401', async () => {
    const controller = makeAuthController(
      jest.fn().mockRejectedValue(new InvalidOtpError()),
    );
    await expect(controller.loginVerify(body)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps an exhausted challenge (OtpLockedError) to 429 with a request-a-new-code message', async () => {
    const controller = makeAuthController(
      jest.fn().mockRejectedValue(new OtpLockedError()),
    );
    const err = await controller.loginVerify(body).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect((err as HttpException).message).toMatch(/new code/i);
  });
});

describe('AuthController.resendLoginOtp', () => {
  it('returns the neutral otp_sent response', async () => {
    const resendLoginOtp = jest.fn().mockResolvedValue({ status: 'otp_sent' });
    const auth = { resendLoginOtp } as unknown as AuthService;
    const controller = new AuthController(auth);
    await expect(
      controller.resendLoginOtp({ email: 'a@b.com' }),
    ).resolves.toEqual({ status: 'otp_sent' });
    expect(resendLoginOtp).toHaveBeenCalledWith({ email: 'a@b.com' });
  });
});

describe('AuthController.resendVerification', () => {
  it('returns the neutral pending_verification response', async () => {
    const resendEmailVerification = jest
      .fn()
      .mockResolvedValue({ status: 'pending_verification' });
    const auth = { resendEmailVerification } as unknown as AuthService;
    const controller = new AuthController(auth);
    await expect(
      controller.resendVerification({ email: 'a@b.com' }),
    ).resolves.toEqual({ status: 'pending_verification' });
    expect(resendEmailVerification).toHaveBeenCalledWith({ email: 'a@b.com' });
  });
});
