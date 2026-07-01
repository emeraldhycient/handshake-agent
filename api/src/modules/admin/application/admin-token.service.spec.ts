import { JwtService } from '@nestjs/jwt';

import { AdminInvalidCredentialsError } from '../domain/admin-errors';
import { AdminTokenService } from './admin-token.service';
import type { Env } from '../../../core/config/env.schema';

type ConfigLike = {
  get: <K extends keyof Env>(key: K, opts?: unknown) => Env[K];
};

function build(overrides: Partial<Env> = {}): AdminTokenService {
  const values = {
    ADMIN_JWT_SECRET: 'super-secret-admin-key',
    ADMIN_SESSION_TTL_SECONDS: 28800,
    ...overrides,
  } as unknown as Env;
  const config: ConfigLike = {
    get: (key) => values[key],
  };
  return new AdminTokenService(new JwtService({}), config as never);
}

describe('AdminTokenService', () => {
  it('sign → verify round-trips the sessionId', () => {
    const svc = build();
    const { token } = svc.sign('sess-1');
    expect(svc.verify(token)).toEqual({ sessionId: 'sess-1' });
  });

  it('sign sets expiresAt to now + ttl seconds', () => {
    const svc = build({ ADMIN_SESSION_TTL_SECONDS: 100 });
    const before = Date.now();
    const { expiresAt } = svc.sign('sess-1');
    const after = Date.now();
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 100 * 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 100 * 1000);
  });

  it('throws (fail-closed) when the admin JWT secret is empty', () => {
    const svc = build({ ADMIN_JWT_SECRET: '' });
    expect(() => svc.sign('sess-1')).toThrow();
  });

  it('rejects a tampered token with AdminInvalidCredentialsError', () => {
    const svc = build();
    const { token } = svc.sign('sess-1');
    const tampered = `${token}tampered`;
    expect(() => svc.verify(tampered)).toThrow(AdminInvalidCredentialsError);
  });

  it('rejects a token signed with a different secret', () => {
    const a = build({ ADMIN_JWT_SECRET: 'key-a' });
    const b = build({ ADMIN_JWT_SECRET: 'key-b' });
    const { token } = a.sign('sess-1');
    expect(() => b.verify(token)).toThrow(AdminInvalidCredentialsError);
  });

  it('rejects an expired token with AdminInvalidCredentialsError', () => {
    const svc = build({ ADMIN_SESSION_TTL_SECONDS: -10 });
    const { token } = svc.sign('sess-1');
    expect(() => svc.verify(token)).toThrow(AdminInvalidCredentialsError);
  });

  it('hash is stable and a 64-char hex string', () => {
    const svc = build();
    const h1 = svc.hash('token-value');
    const h2 = svc.hash('token-value');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
