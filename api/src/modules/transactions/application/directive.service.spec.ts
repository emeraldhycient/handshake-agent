/**
 * Unit tests for DirectiveService (task 4.2, ADR-0005/0006).
 *
 * All external dependencies are mocked:
 *   - DIRECTIVE_REPOSITORY → jest mock
 *   - CLOCK → fixed deterministic clock
 *   - ConfigService → stub returning test values
 *   - hmacHex is exercised via the real implementation (pure function, no IO)
 *
 * Red → Green → Refactor per CLAUDE.md §9.
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { sha256Hex } from '../../../core/crypto/hmac';
import { CLOCK } from '../../../core/common/clock';
import type { Clock } from '../../../core/common/clock';
import {
  DIRECTIVE_REPOSITORY,
  type IDirectiveRepository,
  type DirectiveGrantRecord,
} from './ports/directive.repository.port';
import { DirectiveService } from './directive.service';
import {
  DirectiveExpiredError,
  DirectiveNotMintableError,
  DirectiveProposalMismatchError,
  DirectiveReplayError,
  DirectiveSignatureError,
} from '../domain/directive-errors';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_SIGNING_KEY = 'test-signing-key-32-bytes-minimum';
const FIXED_NOW = new Date('2025-01-01T12:00:00.000Z');
const TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Shared grant builder used in consume tests
// ---------------------------------------------------------------------------

function buildRecord(
  overrides: Partial<DirectiveGrantRecord> = {},
): DirectiveGrantRecord {
  return {
    directiveId: 'directive-uuid-1',
    proposalId: 'proposal-uuid-1',
    userId: 'user-uuid-1',
    directiveRef: 'show_confirmation',
    origin: 'engine',
    nonceHash: 'placeholder-nonce-hash',
    signatureValue: 'placeholder-sig',
    status: 'consumed', // already set to consumed to match atomicConsume result
    issuedAt: FIXED_NOW,
    expiresAt: new Date(FIXED_NOW.getTime() + TTL_SECONDS * 1000),
    consumedAt: FIXED_NOW,
    consumedProposalId: 'proposal-uuid-1',
    failureReason: null,
    failureCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('DirectiveService', () => {
  let service: DirectiveService;
  let repo: jest.Mocked<IDirectiveRepository>;

  beforeEach(async () => {
    const mockClock: Clock = { now: () => FIXED_NOW };

    repo = {
      create: jest.fn().mockResolvedValue(undefined),
      consumeIfIssued: jest.fn(),
      findById: jest.fn(),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        DirectiveService,
        {
          provide: DIRECTIVE_REPOSITORY,
          useValue: repo,
        },
        {
          provide: CLOCK,
          useValue: mockClock,
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'directive.ttlSeconds') return TTL_SECONDS;
              if (key === 'DIRECTIVE_SIGNING_KEY') return TEST_SIGNING_KEY;
              return undefined;
            },
          },
        },
      ],
    }).compile();

    service = module.get(DirectiveService);
  });

  // ── issue() ────────────────────────────────────────────────────────────────

  describe('issue()', () => {
    it('returns directiveId, nonce, and expiresAt', async () => {
      const result = await service.issue({
        proposalId: 'proposal-uuid-1',
        userId: 'user-uuid-1',
        ref: 'show_confirmation',
      });

      expect(typeof result.directiveId).toBe('string');
      expect(result.directiveId.length).toBeGreaterThan(0);
      expect(typeof result.nonce).toBe('string');
      expect(result.nonce.length).toBeGreaterThan(0);
      expect(result.expiresAt).toEqual(
        new Date(FIXED_NOW.getTime() + TTL_SECONDS * 1000),
      );
    });

    it('persists a grant with origin=engine for high-trust refs', async () => {
      await service.issue({
        proposalId: 'proposal-uuid-1',
        userId: 'user-uuid-1',
        ref: 'show_confirmation',
      });

      expect(repo.create).toHaveBeenCalledTimes(1);
      const createArg = repo.create.mock.calls[0][0];
      expect(createArg.origin).toBe('engine');
    });

    it('persists origin=engine for request_pin', async () => {
      await service.issue({
        proposalId: 'p1',
        userId: 'u1',
        ref: 'request_pin',
      });

      const createArg = repo.create.mock.calls[0][0];
      expect(createArg.origin).toBe('engine');
    });

    it('persists origin=engine for request_step_up', async () => {
      await service.issue({
        proposalId: 'p1',
        userId: 'u1',
        ref: 'request_step_up',
      });

      const createArg = repo.create.mock.calls[0][0];
      expect(createArg.origin).toBe('engine');
    });

    it('stores a 64-char hex nonceHash (SHA-256 of nonce)', async () => {
      const result = await service.issue({
        proposalId: 'proposal-uuid-1',
        userId: 'user-uuid-1',
        ref: 'show_confirmation',
      });

      const createArg = repo.create.mock.calls[0][0];
      // SHA-256 hex is always 64 chars
      expect(createArg.nonceHash).toHaveLength(64);
      // The stored hash must be sha256 of the returned nonce
      expect(createArg.nonceHash).toBe(sha256Hex(result.nonce));
    });

    it('stores a non-empty signatureValue', async () => {
      await service.issue({
        proposalId: 'proposal-uuid-1',
        userId: 'user-uuid-1',
        ref: 'show_confirmation',
      });

      const createArg = repo.create.mock.calls[0][0];
      expect(typeof createArg.signatureValue).toBe('string');
      expect(createArg.signatureValue.length).toBeGreaterThan(0);
    });

    it('returned nonce is NOT the stored hash', async () => {
      const result = await service.issue({
        proposalId: 'proposal-uuid-1',
        userId: 'user-uuid-1',
        ref: 'show_confirmation',
      });

      const createArg = repo.create.mock.calls[0][0];
      expect(result.nonce).not.toBe(createArg.nonceHash);
    });

    it('two consecutive issue() calls produce different nonces', async () => {
      const r1 = await service.issue({
        proposalId: 'p1',
        userId: 'u1',
        ref: 'show_confirmation',
      });
      const r2 = await service.issue({
        proposalId: 'p2',
        userId: 'u2',
        ref: 'show_confirmation',
      });
      expect(r1.nonce).not.toBe(r2.nonce);
    });

    it('throws DirectiveNotMintableError when DIRECTIVE_SIGNING_KEY is empty', async () => {
      // Build a service with an empty signing key
      const moduleEmpty = await Test.createTestingModule({
        providers: [
          DirectiveService,
          { provide: DIRECTIVE_REPOSITORY, useValue: repo },
          { provide: CLOCK, useValue: { now: () => FIXED_NOW } },
          {
            provide: ConfigService,
            useValue: {
              get: (key: string) => {
                if (key === 'directive.ttlSeconds') return TTL_SECONDS;
                if (key === 'DIRECTIVE_SIGNING_KEY') return '';
                return undefined;
              },
            },
          },
        ],
      }).compile();

      const emptyKeyService = moduleEmpty.get(DirectiveService);

      await expect(
        emptyKeyService.issue({
          proposalId: 'p1',
          userId: 'u1',
          ref: 'show_confirmation',
        }),
      ).rejects.toThrow(DirectiveNotMintableError);
    });
  });

  // ── consume() ──────────────────────────────────────────────────────────────

  describe('consume()', () => {
    /**
     * Issue a real grant and extract its materials so consume() can verify it.
     */
    async function issueAndCapture(): Promise<{
      directiveId: string;
      nonce: string;
      proposalId: string;
      record: DirectiveGrantRecord;
    }> {
      const proposalId = 'proposal-uuid-1';
      const result = await service.issue({
        proposalId,
        userId: 'user-uuid-1',
        ref: 'show_confirmation',
      });

      const createArg =
        repo.create.mock.calls[repo.create.mock.calls.length - 1][0];

      const record = buildRecord({
        directiveId: result.directiveId,
        proposalId,
        nonceHash: createArg.nonceHash,
        signatureValue: createArg.signatureValue,
        origin: createArg.origin,
        directiveRef: createArg.directiveRef,
        userId: createArg.userId,
        issuedAt: createArg.issuedAt,
        expiresAt: createArg.expiresAt,
      });

      return {
        directiveId: result.directiveId,
        nonce: result.nonce,
        proposalId,
        record,
      };
    }

    it('happy path: returns the grant on valid nonce + proposalId + signature', async () => {
      const { directiveId, nonce, proposalId, record } =
        await issueAndCapture();
      repo.consumeIfIssued.mockResolvedValueOnce({ grant: record });

      const returned = await service.consume({
        directiveId,
        nonce,
        proposalId,
      });
      expect(returned).toEqual(record);
    });

    it('throws DirectiveReplayError when consumeIfIssued=null and grant is consumed', async () => {
      const { directiveId, nonce, proposalId, record } =
        await issueAndCapture();
      repo.consumeIfIssued.mockResolvedValueOnce(null);
      repo.findById.mockResolvedValueOnce({ ...record, status: 'consumed' });

      await expect(
        service.consume({ directiveId, nonce, proposalId }),
      ).rejects.toThrow(DirectiveReplayError);
    });

    it('throws DirectiveReplayError when consumeIfIssued=null and grant not found', async () => {
      const { directiveId, nonce, proposalId } = await issueAndCapture();
      repo.consumeIfIssued.mockResolvedValueOnce(null);
      repo.findById.mockResolvedValueOnce(null);

      await expect(
        service.consume({ directiveId, nonce, proposalId }),
      ).rejects.toThrow(DirectiveReplayError);
    });

    it('throws DirectiveExpiredError when consumeIfIssued=null and grant is expired', async () => {
      const { directiveId, nonce, proposalId, record } =
        await issueAndCapture();
      repo.consumeIfIssued.mockResolvedValueOnce(null);
      repo.findById.mockResolvedValueOnce({ ...record, status: 'expired' });

      await expect(
        service.consume({ directiveId, nonce, proposalId }),
      ).rejects.toThrow(DirectiveExpiredError);
    });

    it('throws DirectiveSignatureError on wrong nonce (nonce hash mismatch)', async () => {
      const { directiveId, proposalId, record } = await issueAndCapture();
      repo.consumeIfIssued.mockResolvedValueOnce({ grant: record });

      await expect(
        service.consume({
          directiveId,
          nonce: 'wrong-nonce-value',
          proposalId,
        }),
      ).rejects.toThrow(DirectiveSignatureError);
      expect(repo.recordFailure).toHaveBeenCalled();
    });

    it('throws DirectiveProposalMismatchError on wrong proposalId', async () => {
      const { directiveId, nonce, record } = await issueAndCapture();
      repo.consumeIfIssued.mockResolvedValueOnce({ grant: record });

      await expect(
        service.consume({
          directiveId,
          nonce,
          proposalId: 'wrong-proposal-id',
        }),
      ).rejects.toThrow(DirectiveProposalMismatchError);
      expect(repo.recordFailure).toHaveBeenCalled();
    });

    it('throws DirectiveSignatureError on tampered signatureValue', async () => {
      const { directiveId, nonce, proposalId, record } =
        await issueAndCapture();
      const tampered = { ...record, signatureValue: 'a'.repeat(64) };
      repo.consumeIfIssued.mockResolvedValueOnce({ grant: tampered });

      await expect(
        service.consume({ directiveId, nonce, proposalId }),
      ).rejects.toThrow(DirectiveSignatureError);
      expect(repo.recordFailure).toHaveBeenCalled();
    });
  });
});
