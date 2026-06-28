import { NotFoundException, UnauthorizedException } from '@nestjs/common';

import type { MeResponse } from '@handshake-agent/contracts';

import { AuthService } from '../application/auth.service';
import {
  InvalidRefreshTokenError,
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
