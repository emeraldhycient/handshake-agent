import {
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import type { MeResponse } from '@handshake-agent/contracts';

import { WEB_REFRESH_COOKIE } from '../../../core/common/cookie-options';
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

// Dev config: not production → cookie is HttpOnly + SameSite=Lax + NOT secure.
const config = { get: () => undefined } as unknown as ConfigService;

function makeRes(): jest.Mocked<Pick<Response, 'cookie' | 'clearCookie'>> {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
}

function makeReq(cookies?: Record<string, string>): Request {
  return { cookies } as unknown as Request;
}

function makeController(me: jest.Mock) {
  const auth = { me } as unknown as AuthService;
  return new AuthController(auth, config);
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
    return new AuthController(auth, config);
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
    await expect(
      controller.loginVerify(body, makeRes() as unknown as Response),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('maps an exhausted challenge (OtpLockedError) to 429 with a request-a-new-code message', async () => {
    const controller = makeAuthController(
      jest.fn().mockRejectedValue(new OtpLockedError()),
    );
    const err = await controller
      .loginVerify(body, makeRes() as unknown as Response)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect((err as HttpException).message).toMatch(/new code/i);
  });
});

describe('AuthController.loginVerify — refresh cookie', () => {
  const body = {
    email: 'a@b.com',
    otp: '123456',
    deviceFingerprint: 'fp-12345678',
  } as never;

  it('sets the HttpOnly ha_refresh cookie and still returns the body tokens', async () => {
    const loginVerify = jest.fn().mockResolvedValue({
      accessToken: 'access.jwt',
      refreshToken: 'refresh.tok',
      user: ME,
    });
    const controller = new AuthController(
      { loginVerify } as unknown as AuthService,
      config,
    );
    const res = makeRes();
    const result = await controller.loginVerify(
      body,
      res as unknown as Response,
    );
    expect(res.cookie).toHaveBeenCalledWith(
      WEB_REFRESH_COOKIE,
      'refresh.tok',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
    // Non-breaking: the body still carries both tokens + user.
    expect(result).toEqual({
      accessToken: 'access.jwt',
      refreshToken: 'refresh.tok',
      user: ME,
    });
  });

  it('does NOT set a cookie when login fails', async () => {
    const loginVerify = jest.fn().mockRejectedValue(new InvalidOtpError());
    const controller = new AuthController(
      { loginVerify } as unknown as AuthService,
      config,
    );
    const res = makeRes();
    await controller
      .loginVerify(body, res as unknown as Response)
      .catch(() => undefined);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('AuthController.signupVerify — refresh cookie (mirrors loginVerify)', () => {
  const body = {
    email: 'a@b.com',
    otp: '123456',
    deviceFingerprint: 'fp-12345678',
  } as never;

  it('sets the HttpOnly ha_refresh cookie and returns the tier_1 + emailVerified user', async () => {
    const verifiedMe = { ...ME, kycTier: 'tier_1', emailVerified: true };
    const signupVerify = jest.fn().mockResolvedValue({
      accessToken: 'access.jwt',
      refreshToken: 'refresh.tok',
      user: verifiedMe,
    });
    const controller = new AuthController(
      { signupVerify } as unknown as AuthService,
      config,
    );
    const res = makeRes();
    const result = await controller.signupVerify(
      body,
      res as unknown as Response,
    );
    expect(res.cookie).toHaveBeenCalledWith(
      WEB_REFRESH_COOKIE,
      'refresh.tok',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
    expect(result).toEqual({
      accessToken: 'access.jwt',
      refreshToken: 'refresh.tok',
      user: verifiedMe,
    });
  });

  it('does NOT set a cookie when signup verification fails', async () => {
    const signupVerify = jest.fn().mockRejectedValue(new InvalidOtpError());
    const controller = new AuthController(
      { signupVerify } as unknown as AuthService,
      config,
    );
    const res = makeRes();
    await controller
      .signupVerify(body, res as unknown as Response)
      .catch(() => undefined);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('AuthController.signupRequest', () => {
  it('delegates to AuthService.signupRequest and returns the neutral otp_sent response', async () => {
    const signupRequest = jest
      .fn()
      .mockResolvedValue({ status: 'otp_sent', devOtp: '123456' });
    const auth = { signupRequest } as unknown as AuthService;
    const controller = new AuthController(auth, config);
    await expect(
      controller.signupRequest({ email: 'a@b.com' }),
    ).resolves.toEqual({ status: 'otp_sent', devOtp: '123456' });
    expect(signupRequest).toHaveBeenCalledWith({ email: 'a@b.com' });
  });
});

describe('AuthController.refresh — cookie-primary', () => {
  const rotated = {
    accessToken: 'new.access',
    refreshToken: 'new.refresh',
    user: ME,
  };

  it('reads the token from the ha_refresh cookie and rotates the cookie', async () => {
    const refresh = jest.fn().mockResolvedValue(rotated);
    const controller = new AuthController(
      { refresh } as unknown as AuthService,
      config,
    );
    const res = makeRes();
    const result = await controller.refresh(
      { refreshToken: undefined },
      makeReq({ [WEB_REFRESH_COOKIE]: 'cookie.tok' }),
      res as unknown as Response,
    );
    // Cookie value wins over an absent body token.
    expect(refresh).toHaveBeenCalledWith({ refreshToken: 'cookie.tok' });
    expect(res.cookie).toHaveBeenCalledWith(
      WEB_REFRESH_COOKIE,
      'new.refresh',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(result).toEqual(rotated);
  });

  it('falls back to the body token when no cookie is present', async () => {
    const refresh = jest.fn().mockResolvedValue(rotated);
    const controller = new AuthController(
      { refresh } as unknown as AuthService,
      config,
    );
    const res = makeRes();
    await controller.refresh(
      { refreshToken: 'body.tok' },
      makeReq(undefined),
      res as unknown as Response,
    );
    expect(refresh).toHaveBeenCalledWith({ refreshToken: 'body.tok' });
  });

  it('prefers the cookie over a body token when both are present', async () => {
    const refresh = jest.fn().mockResolvedValue(rotated);
    const controller = new AuthController(
      { refresh } as unknown as AuthService,
      config,
    );
    await controller.refresh(
      { refreshToken: 'body.tok' },
      makeReq({ [WEB_REFRESH_COOKIE]: 'cookie.tok' }),
      makeRes() as unknown as Response,
    );
    expect(refresh).toHaveBeenCalledWith({ refreshToken: 'cookie.tok' });
  });

  it('maps InvalidRefreshTokenError (neither cookie nor body) to 401 and sets no cookie', async () => {
    const refresh = jest.fn().mockRejectedValue(new InvalidRefreshTokenError());
    const controller = new AuthController(
      { refresh } as unknown as AuthService,
      config,
    );
    const res = makeRes();
    await expect(
      controller.refresh(
        { refreshToken: undefined },
        makeReq(undefined),
        res as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('AuthController.logout — clears the refresh cookie', () => {
  it('revokes the session and clears the ha_refresh cookie', async () => {
    const logout = jest.fn().mockResolvedValue(undefined);
    const controller = new AuthController(
      { logout } as unknown as AuthService,
      config,
    );
    const res = makeRes();
    await controller.logout(CURRENT_USER, res as unknown as Response);
    expect(logout).toHaveBeenCalledWith('s1');
    expect(res.clearCookie).toHaveBeenCalledWith(
      WEB_REFRESH_COOKIE,
      expect.objectContaining({ path: '/' }),
    );
  });
});

describe('AuthController.resendLoginOtp', () => {
  it('returns the neutral otp_sent response', async () => {
    const resendLoginOtp = jest.fn().mockResolvedValue({ status: 'otp_sent' });
    const auth = { resendLoginOtp } as unknown as AuthService;
    const controller = new AuthController(auth, config);
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
    const controller = new AuthController(auth, config);
    await expect(
      controller.resendVerification({ email: 'a@b.com' }),
    ).resolves.toEqual({ status: 'pending_verification' });
    expect(resendEmailVerification).toHaveBeenCalledWith({ email: 'a@b.com' });
  });
});
