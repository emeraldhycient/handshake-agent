import { createHash } from 'node:crypto';

import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { IPatRepository } from '../application/ports/pat.repository.port';
import { PatAuthGuard, type PatPrincipal } from './pat-auth.guard';
import {
  PAT_SCOPES_KEY,
  PatScopesGuard,
  RequirePatScopes,
} from './pat-scopes.guard';

const RAW = `hsk_pat_${'ab'.repeat(32)}`;
const RAW_HASH = createHash('sha256').update(RAW, 'utf8').digest('hex');

function ctx(authHeader?: string): {
  context: ExecutionContext;
  req: Record<string, unknown>;
} {
  const req: Record<string, unknown> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, req };
}

function makeRepo(overrides: Partial<IPatRepository> = {}): IPatRepository {
  return {
    create: jest.fn(),
    listForUser: jest.fn(),
    findActiveByTokenHash: jest.fn((hash: string) =>
      Promise.resolve(
        hash === RAW_HASH
          ? { patId: 'pat-1', userId: 'u1', scopes: ['read'] }
          : null,
      ),
    ),
    revoke: jest.fn(),
    touchLastUsed: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PatAuthGuard', () => {
  it('attaches { userId, patId, scopes } for a valid unrevoked token', async () => {
    const repo = makeRepo();
    const guard = new PatAuthGuard(repo);
    const { context, req } = ctx(`Bearer ${RAW}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(repo.findActiveByTokenHash).toHaveBeenCalledWith(
      RAW_HASH,
      expect.any(Date),
    );
    expect(req.pat).toEqual({ userId: 'u1', patId: 'pat-1', scopes: ['read'] });
  });

  it('updates lastUsedAt fire-and-forget (a touch failure never blocks auth)', async () => {
    const touchLastUsed = jest.fn().mockRejectedValue(new Error('db hiccup'));
    const guard = new PatAuthGuard(makeRepo({ touchLastUsed }));

    await expect(guard.canActivate(ctx(`Bearer ${RAW}`).context)).resolves.toBe(
      true,
    );
    expect(touchLastUsed).toHaveBeenCalledWith('pat-1', expect.any(Date));
    // Let the rejected fire-and-forget promise settle — must not throw/unhandled.
    await new Promise((r) => setImmediate(r));
  });

  it('rejects a missing Authorization header', async () => {
    const guard = new PatAuthGuard(makeRepo());
    await expect(guard.canActivate(ctx().context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a session JWT bearer (only hsk_pat_ tokens are accepted here)', async () => {
    const repo = makeRepo();
    const guard = new PatAuthGuard(repo);
    await expect(
      guard.canActivate(ctx('Bearer eyJhbGciOiJIUzI1NiJ9.x.y').context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // Never even hits the repository — the prefix check fails closed first.
    expect(repo.findActiveByTokenHash).not.toHaveBeenCalled();
  });

  it('rejects an unknown, revoked or expired token (repo returns null)', async () => {
    const guard = new PatAuthGuard(
      makeRepo({ findActiveByTokenHash: jest.fn().mockResolvedValue(null) }),
    );
    await expect(
      guard.canActivate(ctx(`Bearer ${RAW}`).context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('PatScopesGuard + RequirePatScopes', () => {
  function makeScopesContext(
    required: string[] | undefined,
    pat: PatPrincipal | undefined,
  ): ExecutionContext {
    class Dummy {}
    const handler = () => undefined;
    if (required) {
      RequirePatScopes(...(required as never[]))(
        Dummy.prototype,
        'h',
        Object.getOwnPropertyDescriptor({ h: handler }, 'h') ??
          ({ value: handler } as PropertyDescriptor),
      );
    }
    const req: Record<string, unknown> = { headers: {}, pat };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => Dummy,
    } as unknown as ExecutionContext;
  }

  it('RequirePatScopes stamps metadata under PAT_SCOPES_KEY', () => {
    const reflector = new Reflector();
    const context = makeScopesContext(['chat:propose'], undefined);
    expect(
      reflector.getAllAndOverride(PAT_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]),
    ).toEqual(['chat:propose']);
  });

  it('allows when the PAT carries every required scope', async () => {
    const guard = new PatScopesGuard(new Reflector());
    const context = makeScopesContext(['read'], {
      userId: 'u1',
      patId: 'pat-1',
      scopes: ['read', 'chat:propose'],
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('403s when a required scope is missing', async () => {
    const guard = new PatScopesGuard(new Reflector());
    const context = makeScopesContext(['chat:propose'], {
      userId: 'u1',
      patId: 'pat-1',
      scopes: ['read'],
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('fails closed when no PAT principal is on the request', async () => {
    const guard = new PatScopesGuard(new Reflector());
    const context = makeScopesContext(['read'], undefined);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('passes through when the handler declares no scopes', async () => {
    const guard = new PatScopesGuard(new Reflector());
    const context = makeScopesContext(undefined, undefined);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
