import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { TokenSigningDisabledError } from '../domain/auth-errors';
import { TokenService } from './token.service';

function make(secret: string) {
  const config = {
    get: (key: string) => {
      if (key === 'JWT_SECRET') return secret;
      if (key === 'auth.jwt.accessTtlSeconds') return 3600;
      return undefined;
    },
  } as unknown as ConfigService;
  return new TokenService(new JwtService({}), config);
}

describe('TokenService', () => {
  it('signs and verifies an access token round-trip', () => {
    const svc = make('test-secret');
    const token = svc.signAccessToken('user-1');
    expect(svc.verifyAccessToken(token)).toEqual(
      expect.objectContaining({ sub: 'user-1' }),
    );
  });

  it('throws TokenSigningDisabledError when JWT_SECRET is empty', () => {
    const svc = make('');
    expect(() => svc.signAccessToken('user-1')).toThrow(
      TokenSigningDisabledError,
    );
    expect(() => svc.verifyAccessToken('whatever')).toThrow(
      TokenSigningDisabledError,
    );
  });

  it('rejects a token signed with a different secret', () => {
    const a = make('secret-a');
    const b = make('secret-b');
    const token = a.signAccessToken('user-1');
    expect(() => b.verifyAccessToken(token)).toThrow();
  });

  it('hash is deterministic 64-hex; opaque token is 64-hex and unique', () => {
    const svc = make('s');
    expect(svc.hash('abc')).toBe(svc.hash('abc'));
    expect(svc.hash('abc')).toMatch(/^[0-9a-f]{64}$/);
    const t1 = svc.generateOpaqueToken();
    const t2 = svc.generateOpaqueToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });

  it('generates a numeric OTP of the requested length', () => {
    const svc = make('s');
    const otp = svc.generateNumericOtp(6);
    expect(otp).toMatch(/^[0-9]{6}$/);
  });
});
