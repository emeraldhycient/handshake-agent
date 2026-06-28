import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard';

function ctx(authHeader?: string): {
  context: ExecutionContext;
  req: Record<string, unknown>;
} {
  const req: Record<string, unknown> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

function make(
  overrides: { verify?: () => { sub: string }; session?: unknown } = {},
) {
  const tokens = {
    verifyAccessToken: overrides.verify ?? (() => ({ sub: 'u1' })),
    hash: (v: string) => `hash(${v})`,
  };
  const sessions = {
    findActiveByAccessHash: jest.fn(
      // Use 'in' check so that an explicit `session: null` override propagates
      // (null ?? fallback would silently substitute the default — brief bug fix).
      // Promise.resolve keeps the mock async without a bare async-no-await arrow.
      () =>
        Promise.resolve(
          'session' in overrides
            ? overrides.session
            : { id: 's1', userId: 'u1', deviceId: 'd1' },
        ),
    ),
  };
  return {
    guard: new JwtAuthGuard(tokens as never, sessions as never),
    sessions,
  };
}

describe('JwtAuthGuard', () => {
  it('attaches req.user for a valid token with an active session', async () => {
    const { guard, sessions } = make();
    const { context, req } = ctx('Bearer good.token');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessions.findActiveByAccessHash).toHaveBeenCalledWith(
      'hash(good.token)',
      expect.any(Date),
    );
    expect(req.user).toEqual({ userId: 'u1', sessionId: 's1', deviceId: 'd1' });
  });

  it('rejects a missing Authorization header', async () => {
    const { guard } = make();
    await expect(guard.canActivate(ctx().context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when JWT verification throws', async () => {
    const { guard } = make({
      verify: () => {
        throw new Error('bad');
      },
    });
    await expect(
      guard.canActivate(ctx('Bearer x').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when no active session matches (revoked/expired)', async () => {
    const { guard } = make({ session: null });
    await expect(
      guard.canActivate(ctx('Bearer x').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the session userId does not match the token sub', async () => {
    const { guard } = make({
      session: { id: 's1', userId: 'OTHER', deviceId: 'd1' },
    });
    await expect(
      guard.canActivate(ctx('Bearer x').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
