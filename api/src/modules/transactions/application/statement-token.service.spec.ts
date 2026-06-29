import { ConfigService } from '@nestjs/config';
import {
  StatementTokenService,
  StatementTokenInvalidError,
  StatementNotSignableError,
} from './statement-token.service';

function makeService(opts: {
  key?: string;
  base?: string;
  now: Date;
  ttl?: number;
}) {
  const map: Record<string, unknown> = {
    STATEMENT_SIGNING_KEY: opts.key ?? 'k'.repeat(32),
    PUBLIC_API_BASE_URL: opts.base ?? 'https://api.example.com',
    PORT: 3001,
    statement: {
      linkTtlSeconds: opts.ttl ?? 900,
      maxWindowDays: 365,
      rowCap: 100,
      timezoneOffsetMinutes: 60,
    },
  };
  const config = { get: (k: string) => map[k] } as unknown as ConfigService;
  const clock = { now: () => opts.now };
  return new StatementTokenService(config, clock);
}

const payload = {
  userId: 'u1',
  from: '2026-06-01T00:00:00.000Z',
  to: '2026-06-30T00:00:00.000Z',
  txType: 'all',
};

describe('StatementTokenService', () => {
  const now = new Date('2026-06-29T10:00:00.000Z');

  it('signs and verifies a round-trip', () => {
    const svc = makeService({ now });
    const token = svc.sign(payload);
    expect(svc.verify(token)).toEqual(payload);
  });

  it('builds an absolute download URL', () => {
    const svc = makeService({ now });
    const token = svc.sign(payload);
    expect(svc.buildDownloadUrl(token)).toBe(
      `https://api.example.com/transactions/statement/download?token=${token}`,
    );
  });

  it('rejects a tampered token', () => {
    const svc = makeService({ now });
    const token = svc.sign(payload);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(() => svc.verify(tampered)).toThrow(StatementTokenInvalidError);
  });

  it('rejects an expired token', () => {
    const signer = makeService({ now, ttl: 60 });
    const token = signer.sign(payload);
    const later = makeService({ now: new Date(now.getTime() + 120_000) });
    expect(() => later.verify(token)).toThrow(StatementTokenInvalidError);
  });

  it('throws when the signing key is empty (fail-closed)', () => {
    const svc = makeService({ now, key: '' });
    expect(() => svc.sign(payload)).toThrow(StatementNotSignableError);
  });
});
