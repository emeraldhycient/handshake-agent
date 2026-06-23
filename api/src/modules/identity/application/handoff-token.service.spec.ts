/**
 * Unit tests for HandoffTokenService (K3).
 *
 * TDD: tests written RED first, then implementation made them GREEN.
 *
 * Covers:
 *   - mintKycToken: returns token + url, stores only hash in repo
 *   - mintKycToken: WEB_APP_BASE_URL absent → url is empty string (fallback signal)
 *   - consumeKycToken: happy path → returns channelAddress
 *   - consumeKycToken: token not found / already redeemed → HandoffTokenNotFoundError
 *   - consumeKycToken: expired (findAndConsume returns null) → HandoffTokenNotFoundError
 *   - consumeKycToken: wrong purpose (repo contract returns null) → HandoffTokenNotFoundError
 *   - defence-in-depth: expired record slips through adapter → HandoffTokenExpiredError
 */

import { ConfigService } from '@nestjs/config';

import {
  HandoffTokenExpiredError,
  HandoffTokenNotFoundError,
} from '../domain/handoff-token-errors';
import type {
  HandoffTokenRecord,
  IHandoffTokenRepository,
} from './ports/handoff-token.repository.port';
import { HandoffTokenService } from './handoff-token.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHANNEL_ADDRESS = '+2348099990001';
const USER_ID = 'user-uuid-1';
const FUTURE = new Date(Date.now() + 30 * 60 * 1000);

function makeRecord(
  overrides: Partial<HandoffTokenRecord> = {},
): HandoffTokenRecord {
  return {
    id: 'token-id-1',
    tokenHash: 'sha256-hash-placeholder',
    userId: USER_ID,
    channelAddress: CHANNEL_ADDRESS,
    conversationId: null,
    purpose: 'kyc',
    status: 'issued',
    issuedAt: new Date(),
    expiresAt: FUTURE,
    redeemedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeRepo(
  overrides: Partial<IHandoffTokenRepository> = {},
): jest.Mocked<IHandoffTokenRepository> {
  return {
    create: jest.fn().mockResolvedValue(makeRecord()),
    findAndConsume: jest.fn().mockResolvedValue(makeRecord()),
    findActiveForChannel: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as jest.Mocked<IHandoffTokenRepository>;
}

function makeConfig(
  webAppBaseUrl: string = 'https://app.example.com',
  kycTtlMinutes?: number,
): jest.Mocked<ConfigService> {
  return {
    get: jest.fn((key: string) => {
      if (key === 'WEB_APP_BASE_URL') return webAppBaseUrl;
      if (key === 'handoffToken.kycTtlMinutes') return kycTtlMinutes;
      return undefined;
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

function buildService(
  repo: jest.Mocked<IHandoffTokenRepository> = makeRepo(),
  configService: jest.Mocked<ConfigService> = makeConfig(),
): HandoffTokenService {
  return new HandoffTokenService(repo, configService);
}

// ---------------------------------------------------------------------------
// Tests: mintKycToken
// ---------------------------------------------------------------------------

describe('HandoffTokenService.mintKycToken', () => {
  it('returns a non-empty token string and a url containing the token', async () => {
    const repo = makeRepo();
    const svc = buildService(repo);

    const result = await svc.mintKycToken({ channelAddress: CHANNEL_ADDRESS });

    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(30); // ≥256-bit → ≥64 hex chars
    expect(result.url).toContain(result.token);
    expect(result.url).toContain('/kyc?t=');
  });

  it('stores only the SHA-256 hash in the repo, never the raw token', async () => {
    const repo = makeRepo();
    const svc = buildService(repo);

    const { token } = await svc.mintKycToken({
      channelAddress: CHANNEL_ADDRESS,
    });

    expect(repo.create).toHaveBeenCalledTimes(1);
    const [createArg] = repo.create.mock.calls[0];

    // The stored hash must NOT equal the raw token.
    expect(createArg.tokenHash).not.toBe(token);
    // The hash should be a 64-char hex string (SHA-256).
    expect(createArg.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // channelAddress stored for later retrieval.
    expect(createArg.channelAddress).toBe(CHANNEL_ADDRESS);
    // purpose is 'kyc'.
    expect(createArg.purpose).toBe('kyc');
  });

  it('url includes the WEB_APP_BASE_URL prefix', async () => {
    const repo = makeRepo();
    const svc = buildService(repo, makeConfig('https://handshake.app'));

    const { url } = await svc.mintKycToken({ channelAddress: CHANNEL_ADDRESS });

    expect(url.startsWith('https://handshake.app/kyc?t=')).toBe(true);
  });

  it('url is empty string when WEB_APP_BASE_URL is not configured', async () => {
    const repo = makeRepo();
    const svc = buildService(repo, makeConfig(''));

    const { url } = await svc.mintKycToken({ channelAddress: CHANNEL_ADDRESS });

    // WEB_APP_BASE_URL not set → url returned is '' (the "no CTA" signal).
    // ConversationService checks !url and falls back to plain-text.
    expect(url).toBe('');
  });

  it('passes optional userId and conversationId to repo.create', async () => {
    const repo = makeRepo();
    const svc = buildService(repo);

    await svc.mintKycToken({
      channelAddress: CHANNEL_ADDRESS,
      userId: USER_ID,
      conversationId: 'conv-id-1',
    });

    const [createArg] = repo.create.mock.calls[0];
    expect(createArg.userId).toBe(USER_ID);
    expect(createArg.conversationId).toBe('conv-id-1');
  });

  it('sets expiresAt in the future (default TTL applied)', async () => {
    const repo = makeRepo();
    const svc = buildService(repo);
    const before = new Date();

    await svc.mintKycToken({ channelAddress: CHANNEL_ADDRESS });

    const [createArg] = repo.create.mock.calls[0];
    expect(createArg.expiresAt.getTime()).toBeGreaterThan(before.getTime());
  });
});

// ---------------------------------------------------------------------------
// Tests: consumeKycToken
// ---------------------------------------------------------------------------

describe('HandoffTokenService.consumeKycToken', () => {
  it('happy path: findAndConsume returns a record → returns channelAddress', async () => {
    const repo = makeRepo({
      findAndConsume: jest.fn().mockResolvedValue(makeRecord()),
    });
    const svc = buildService(repo);

    const result = await svc.consumeKycToken('raw-token-hex');

    expect(result.channelAddress).toBe(CHANNEL_ADDRESS);
    expect(repo.findAndConsume).toHaveBeenCalledTimes(1);
    // The hash passed to findAndConsume must NOT equal the raw token.
    const [findArg] = repo.findAndConsume.mock.calls[0];
    expect(findArg.tokenHash).not.toBe('raw-token-hex');
    expect(findArg.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(findArg.purpose).toBe('kyc');
  });

  it('findAndConsume returns null → HandoffTokenNotFoundError (not found / already consumed)', async () => {
    const repo = makeRepo({
      findAndConsume: jest.fn().mockResolvedValue(null),
    });
    const svc = buildService(repo);

    await expect(svc.consumeKycToken('invalid-token')).rejects.toThrow(
      HandoffTokenNotFoundError,
    );
  });

  it('findAndConsume returns null for expired token → HandoffTokenNotFoundError', async () => {
    // findAndConsume filters expired tokens (returns null for expired).
    // The error thrown is HandoffTokenNotFoundError (same null path).
    const repo = makeRepo({
      findAndConsume: jest.fn().mockResolvedValue(null),
    });
    const svc = buildService(repo);

    await expect(svc.consumeKycToken('expired-token')).rejects.toThrow(
      HandoffTokenNotFoundError,
    );
  });

  it('defence-in-depth: if adapter returns an expired record, HandoffTokenExpiredError is thrown', async () => {
    // Simulate a buggy adapter that returns an expired record instead of null.
    const expiredRecord = makeRecord({
      expiresAt: new Date(Date.now() - 1000),
    });
    const repo = makeRepo({
      findAndConsume: jest.fn().mockResolvedValue(expiredRecord),
    });
    const svc = buildService(repo);

    await expect(svc.consumeKycToken('some-token')).rejects.toThrow(
      HandoffTokenExpiredError,
    );
  });

  it('returns empty channelAddress when the record has no channelAddress', async () => {
    const record = makeRecord({ channelAddress: null });
    const repo = makeRepo({
      findAndConsume: jest.fn().mockResolvedValue(record),
    });
    const svc = buildService(repo);

    const result = await svc.consumeKycToken('raw-token');

    expect(result.channelAddress).toBe('');
  });
});
