/**
 * Unit tests for KycPrismaRepository — NFR-1: NIN/BVN encrypted at rest.
 *
 * TDD: written RED first (the repo stored plaintext), then made GREEN by
 * encrypting nin/bvn through `core/crypto/field-encryption` on write.
 *
 * No Nest TestingModule — the repository is constructed directly with a faked
 * PrismaService (whose $transaction invokes the callback with stub tx writers)
 * and a stub ConfigService. We capture what the repo passes to Prisma and
 * assert it is ciphertext (never the plaintext NIN/BVN), then prove the round
 * trip via the same helper / the repo's own decrypt path.
 */

import type { ConfigService } from '@nestjs/config';

import { FieldEncryptionKeyError } from '../../../core/crypto/field-encryption';
import type { PrismaService } from '../../../core/prisma/prisma.service';
import { KycPrismaRepository } from './kyc.prisma.repository';

// A 32-byte AES key as 64 hex chars (canonical KYC_ENCRYPTION_KEY form).
const ENC_KEY = 'a'.repeat(64);

const NIN = '12345678901';
const BVN = '22233344455';

/** The encrypted-at-rest shape the repo persists for KycProfile.{nin,bvn,tier}. */
interface KycProfileData {
  nin: string | null;
  bvn: string | null;
  tier: string;
}
type KycProfileCreateArg = { data: KycProfileData };
type KycProfileUpsertArg = { create: KycProfileData; update: KycProfileData };

/** The shape the repo persists for User.kycTier (Task 1.1: threaded, not hardcoded). */
type UserWriteArg = { data: { kycTier?: string } };

/** Typed jest mocks so `.mock.calls[…]` are not `any`. */
interface CapturedWrites {
  kycProfileCreate: jest.Mock<Promise<void>, [KycProfileCreateArg]>;
  kycProfileUpsert: jest.Mock<Promise<void>, [KycProfileUpsertArg]>;
  userCreate: jest.Mock<Promise<{ id: string }>, [UserWriteArg]>;
  userUpdate: jest.Mock<Promise<void>, [UserWriteArg]>;
  contactUpdate: jest.Mock<Promise<void>, [unknown]>;
  channelIdentityUpdate: jest.Mock<Promise<void>, [unknown]>;
}

/**
 * Builds a faked PrismaService whose `$transaction` runs the callback with a
 * `tx` exposing jest-mock writers, so the spec can inspect the persisted data.
 */
function makePrisma(captured: CapturedWrites): PrismaService {
  const tx = {
    user: { create: captured.userCreate, update: captured.userUpdate },
    kycProfile: {
      create: captured.kycProfileCreate,
      upsert: captured.kycProfileUpsert,
    },
    contact: { update: captured.contactUpdate },
    channelIdentity: { update: captured.channelIdentityUpdate },
  };

  return {
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;
}

function makeConfig(key: string | undefined): ConfigService {
  return {
    get: jest.fn((name: string) =>
      name === 'KYC_ENCRYPTION_KEY' ? key : undefined,
    ),
  } as unknown as ConfigService;
}

function freshCaptured(): CapturedWrites {
  return {
    kycProfileCreate: jest.fn<Promise<void>, [KycProfileCreateArg]>(),
    kycProfileUpsert: jest.fn<Promise<void>, [KycProfileUpsertArg]>(),
    userCreate: jest
      .fn<Promise<{ id: string }>, [UserWriteArg]>()
      .mockResolvedValue({ id: 'user-1' }),
    userUpdate: jest.fn<Promise<void>, [UserWriteArg]>(),
    contactUpdate: jest.fn<Promise<void>, [unknown]>(),
    channelIdentityUpdate: jest.fn<Promise<void>, [unknown]>(),
  };
}

const ATOMIC_INPUT = {
  channelIdentityId: 'ci-1',
  contactId: 'contact-1',
  nin: NIN,
  bvn: BVN,
  firstName: 'Amaka',
  lastName: 'Okafor',
  dateOfBirth: '1992-07-14',
  pinHash: 'aa:bb',
  tier: 'tier_1' as const,
  now: new Date('2026-06-30T00:00:00.000Z'),
};

const FOR_USER_INPUT = {
  userId: 'user-1',
  nin: NIN,
  bvn: BVN,
  firstName: 'Amaka',
  lastName: 'Okafor',
  dateOfBirth: '1992-07-14',
  pinHash: 'aa:bb',
  tier: 'tier_1' as const,
  now: new Date('2026-06-30T00:00:00.000Z'),
};

describe('KycPrismaRepository — NIN/BVN encryption at rest (NFR-1)', () => {
  describe('completeVerificationAtomic', () => {
    it('encrypts nin/bvn on write — never persists plaintext', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(ENC_KEY),
      );

      await repo.completeVerificationAtomic(ATOMIC_INPUT);

      const data = captured.kycProfileCreate.mock.calls[0][0].data;
      // Persisted values are NOT the plaintext.
      expect(data.nin).not.toBe(NIN);
      expect(data.bvn).not.toBe(BVN);
      // They are versioned AES-256-GCM blobs.
      expect(data.nin).toMatch(/^v1\./);
      expect(data.bvn).toMatch(/^v1\./);
      // And they decrypt back to the original plaintext (round trip).
      expect(repo.decryptIdentifier(data.nin)).toBe(NIN);
      expect(repo.decryptIdentifier(data.bvn)).toBe(BVN);
    });

    it('stores null for absent nin/bvn (no encryption of nothing)', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(ENC_KEY),
      );

      await repo.completeVerificationAtomic({
        ...ATOMIC_INPUT,
        nin: undefined,
        bvn: undefined,
      });

      const data = captured.kycProfileCreate.mock.calls[0][0].data;
      expect(data.nin).toBeNull();
      expect(data.bvn).toBeNull();
    });

    it('fails closed: throws (no write) when a value is present but no key', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(''),
      );

      await expect(
        repo.completeVerificationAtomic(ATOMIC_INPUT),
      ).rejects.toBeInstanceOf(FieldEncryptionKeyError);
      // Nothing was persisted — the throw happens before the transaction.
      expect(captured.kycProfileCreate).not.toHaveBeenCalled();
      expect(captured.userCreate).not.toHaveBeenCalled();
    });

    it('returns the new userId', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(ENC_KEY),
      );

      await expect(
        repo.completeVerificationAtomic(ATOMIC_INPUT),
      ).resolves.toEqual({ userId: 'user-1' });
    });

    // ── Task 1.1: the granted tier is threaded through, not hardcoded ────────

    it('persists input.tier on both User.kycTier and KycProfile.tier — a tier_2 grant is NOT downgraded to tier_1', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(ENC_KEY),
      );

      await repo.completeVerificationAtomic({
        ...ATOMIC_INPUT,
        tier: 'tier_2',
      });

      expect(captured.userCreate.mock.calls[0][0].data.kycTier).toBe('tier_2');
      expect(captured.kycProfileCreate.mock.calls[0][0].data.tier).toBe(
        'tier_2',
      );
    });

    it('a tier_1 grant still persists tier_1 (behavior preservation for the mock provider)', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(ENC_KEY),
      );

      await repo.completeVerificationAtomic({
        ...ATOMIC_INPUT,
        tier: 'tier_1',
      });

      expect(captured.userCreate.mock.calls[0][0].data.kycTier).toBe('tier_1');
      expect(captured.kycProfileCreate.mock.calls[0][0].data.tier).toBe(
        'tier_1',
      );
    });
  });

  describe('completeVerificationForUserAtomic', () => {
    it('encrypts nin/bvn in both upsert create and update branches', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(ENC_KEY),
      );

      await repo.completeVerificationForUserAtomic(FOR_USER_INPUT);

      const args = captured.kycProfileUpsert.mock.calls[0][0];
      for (const branch of [args.create, args.update]) {
        expect(branch.nin).not.toBe(NIN);
        expect(branch.bvn).not.toBe(BVN);
        expect(repo.decryptIdentifier(branch.nin)).toBe(NIN);
        expect(repo.decryptIdentifier(branch.bvn)).toBe(BVN);
      }
    });

    // ── Task 1.1: the granted tier is threaded through, not hardcoded ────────

    it('persists input.tier on both User.kycTier and the KycProfile upsert (create + update branches) — a tier_2 grant is NOT downgraded to tier_1', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(ENC_KEY),
      );

      await repo.completeVerificationForUserAtomic({
        ...FOR_USER_INPUT,
        tier: 'tier_2',
      });

      const args = captured.kycProfileUpsert.mock.calls[0][0];
      expect(args.create.tier).toBe('tier_2');
      expect(args.update.tier).toBe('tier_2');
      expect(captured.userUpdate.mock.calls[0][0].data.kycTier).toBe('tier_2');
    });

    it('a tier_1 grant still persists tier_1 (behavior preservation for the mock provider)', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(ENC_KEY),
      );

      await repo.completeVerificationForUserAtomic({
        ...FOR_USER_INPUT,
        tier: 'tier_1',
      });

      const args = captured.kycProfileUpsert.mock.calls[0][0];
      expect(args.create.tier).toBe('tier_1');
      expect(args.update.tier).toBe('tier_1');
      expect(captured.userUpdate.mock.calls[0][0].data.kycTier).toBe('tier_1');
    });

    it('fails closed when a value is present but no key', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(undefined),
      );

      await expect(
        repo.completeVerificationForUserAtomic(FOR_USER_INPUT),
      ).rejects.toBeInstanceOf(FieldEncryptionKeyError);
      expect(captured.kycProfileUpsert).not.toHaveBeenCalled();
    });
  });

  describe('markKycNeedsInfo (Phase 9 request-info)', () => {
    /** Captures the atomic KycProfile + User updates the needs-info write performs. */
    interface NeedsInfoWrites {
      kycProfileUpdate: jest.Mock<Promise<void>, [unknown]>;
      userUpdate: jest.Mock<Promise<void>, [unknown]>;
      transaction: jest.Mock;
    }

    function makeNeedsInfoPrisma(): {
      prisma: PrismaService;
      writes: NeedsInfoWrites;
    } {
      const kycProfileUpdate = jest.fn<Promise<void>, [unknown]>();
      const userUpdate = jest.fn<Promise<void>, [unknown]>();
      const tx = {
        kycProfile: { update: kycProfileUpdate },
        user: { update: userUpdate },
      };
      const transaction = jest.fn((cb: (t: typeof tx) => Promise<unknown>) =>
        cb(tx),
      );
      return {
        prisma: { $transaction: transaction } as unknown as PrismaService,
        writes: { kycProfileUpdate, userUpdate, transaction },
      };
    }

    it('sets the profile to needs_info + reviewedByAdminId and mirrors kycStatus onto the User, in one $transaction', async () => {
      const { prisma, writes } = makeNeedsInfoPrisma();
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      await repo.markKycNeedsInfo('user-1', 'admin-9');

      expect(writes.transaction).toHaveBeenCalledTimes(1);

      expect(writes.kycProfileUpdate).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { status: 'needs_info', reviewedByAdminId: 'admin-9' },
      });

      expect(writes.userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { kycStatus: 'needs_info' },
      });
    });

    it('does not touch tier, verifiedAt, or rejectionReason (a paused review, not a decision)', async () => {
      const { prisma, writes } = makeNeedsInfoPrisma();
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      await repo.markKycNeedsInfo('user-1', 'admin-9');

      const profileData = (
        writes.kycProfileUpdate.mock.calls[0][0] as { data: object }
      ).data;
      expect(profileData).not.toHaveProperty('tier');
      expect(profileData).not.toHaveProperty('verifiedAt');
      expect(profileData).not.toHaveProperty('rejectionReason');

      const userData = (writes.userUpdate.mock.calls[0][0] as { data: object })
        .data;
      expect(userData).not.toHaveProperty('kycTier');
    });
  });

  describe('setSumsubApplicantId (task 3.4)', () => {
    /** Faked PrismaService exposing only `kycProfile.upsert` (no $transaction needed). */
    function makeUpsertPrisma(): {
      prisma: PrismaService;
      upsert: jest.Mock<Promise<void>, [unknown]>;
    } {
      const upsert = jest.fn<Promise<void>, [unknown]>();
      return {
        prisma: { kycProfile: { upsert } } as unknown as PrismaService,
        upsert,
      };
    }

    it('upserts KycProfile.sumsubApplicantId, touching neither status nor tier', async () => {
      const { prisma, upsert } = makeUpsertPrisma();
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      await repo.setSumsubApplicantId('user-1', 'sumsub-applicant-abc');

      expect(upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: { userId: 'user-1', sumsubApplicantId: 'sumsub-applicant-abc' },
        update: { sumsubApplicantId: 'sumsub-applicant-abc' },
      });
    });
  });

  describe('grantSumsubTier / markSumsubRejected / markSumsubPendingReview (task 3.6)', () => {
    interface SumsubWrites {
      userUpdateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
      userFindUnique: jest.Mock<Promise<{ id: string } | null>, [unknown]>;
      kycProfileUpsert: jest.Mock<Promise<void>, [unknown]>;
    }

    function makeSumsubPrisma(overrides: Partial<SumsubWrites> = {}): {
      prisma: PrismaService;
      writes: SumsubWrites;
    } {
      const writes: SumsubWrites = {
        userUpdateMany: jest
          .fn<Promise<{ count: number }>, [unknown]>()
          .mockResolvedValue({ count: 1 }),
        userFindUnique: jest
          .fn<Promise<{ id: string } | null>, [unknown]>()
          .mockResolvedValue({ id: 'user-1' }),
        kycProfileUpsert: jest
          .fn<Promise<void>, [unknown]>()
          .mockResolvedValue(undefined),
        ...overrides,
      };
      const tx = {
        user: {
          updateMany: writes.userUpdateMany,
          findUnique: writes.userFindUnique,
        },
        kycProfile: { upsert: writes.kycProfileUpsert },
      };
      const prisma = {
        $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) =>
          cb(tx),
        ),
      } as unknown as PrismaService;
      return { prisma, writes };
    }

    describe('grantSumsubTier', () => {
      it('grants when the guarded updateMany matches (strictly below target) — upserts the profile', async () => {
        const { prisma, writes } = makeSumsubPrisma();
        const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

        const result = await repo.grantSumsubTier({
          userId: 'user-1',
          tier: 'tier_2',
          applicantId: 'app-1',
        });

        expect(result).toEqual({ granted: true });
        const userArgs = writes.userUpdateMany.mock.calls[0][0] as {
          where: { id: string; kycTier: { in: string[] } };
          data: { kycStatus: string; kycTier: string };
        };
        expect(userArgs.where).toEqual({
          id: 'user-1',
          kycTier: { in: ['unverified', 'tier_1'] },
        });
        expect(userArgs.data.kycStatus).toBe('verified');
        expect(userArgs.data.kycTier).toBe('tier_2');
        const profileArgs = writes.kycProfileUpsert.mock.calls[0][0] as {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        };
        expect(profileArgs.update.tier).toBe('tier_2');
        expect(profileArgs.update.sumsubApplicantId).toBe('app-1');
        expect(profileArgs.update.livenessCheckResult).toBe('passed');
      });

      it('defaults livenessCheckResult to "passed" when omitted', async () => {
        const { prisma, writes } = makeSumsubPrisma();
        const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

        await repo.grantSumsubTier({ userId: 'user-1', tier: 'tier_3' });

        const profileArgs = writes.kycProfileUpsert.mock.calls[0][0] as {
          create: Record<string, unknown>;
        };
        expect(profileArgs.create.livenessCheckResult).toBe('passed');
        // A tier_3 target is strictly above unverified/tier_1/tier_2.
        const userArgs = writes.userUpdateMany.mock.calls[0][0] as {
          where: { id: string; kycTier: { in: string[] } };
        };
        expect(userArgs.where).toEqual({
          id: 'user-1',
          kycTier: { in: ['unverified', 'tier_1', 'tier_2'] },
        });
      });

      it('idempotent no-op: already at/above target tier → updateMany matches 0 rows, profile untouched (no tierChangedAt re-stamp)', async () => {
        const { prisma, writes } = makeSumsubPrisma({
          userUpdateMany: jest
            .fn<Promise<{ count: number }>, [unknown]>()
            .mockResolvedValue({ count: 0 }),
        });
        const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

        const result = await repo.grantSumsubTier({
          userId: 'user-1',
          tier: 'tier_2',
        });

        expect(result).toEqual({ granted: false });
        expect(writes.kycProfileUpsert).not.toHaveBeenCalled();
      });

      it('unknown user (no matching row) → same guarded updateMany, same no-op result', async () => {
        const { prisma, writes } = makeSumsubPrisma({
          userUpdateMany: jest
            .fn<Promise<{ count: number }>, [unknown]>()
            .mockResolvedValue({ count: 0 }),
        });
        const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

        const result = await repo.grantSumsubTier({
          userId: 'no-such-user',
          tier: 'tier_3',
        });

        expect(result).toEqual({ granted: false });
        const userArgs = writes.userUpdateMany.mock.calls[0][0] as {
          where: { id: string; kycTier: { in: string[] } };
        };
        expect(userArgs.where).toEqual({
          id: 'no-such-user',
          kycTier: { in: ['unverified', 'tier_1', 'tier_2'] },
        });
        expect(writes.kycProfileUpsert).not.toHaveBeenCalled();
      });
    });

    describe('markSumsubRejected', () => {
      it('sets kycStatus=rejected + rejectionReason, never touches tier', async () => {
        const { prisma, writes } = makeSumsubPrisma();
        const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

        const result = await repo.markSumsubRejected(
          'user-1',
          'DOCUMENT_TEMPLATE',
        );

        expect(result).toEqual({ found: true });
        const userArgs = writes.userUpdateMany.mock.calls[0][0] as {
          data: Record<string, unknown>;
        };
        expect(userArgs.data).not.toHaveProperty('kycTier');
        expect(userArgs.data.kycStatus).toBe('rejected');
        const profileArgs = writes.kycProfileUpsert.mock.calls[0][0] as {
          update: Record<string, unknown>;
        };
        expect(profileArgs.update.rejectionReason).toBe('DOCUMENT_TEMPLATE');
        expect(profileArgs.update).not.toHaveProperty('tier');
      });

      it('unknown user → found:false, no profile write', async () => {
        const { prisma, writes } = makeSumsubPrisma({
          userUpdateMany: jest
            .fn<Promise<{ count: number }>, [unknown]>()
            .mockResolvedValue({ count: 0 }),
        });
        const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

        const result = await repo.markSumsubRejected('no-such-user', 'reason');

        expect(result).toEqual({ found: false });
        expect(writes.kycProfileUpsert).not.toHaveBeenCalled();
      });
    });

    describe('markSumsubPendingReview', () => {
      it('sets kycStatus=pending_review when not already verified', async () => {
        const { prisma, writes } = makeSumsubPrisma();
        const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

        const result = await repo.markSumsubPendingReview('user-1');

        expect(result).toEqual({ found: true });
        expect(writes.userUpdateMany).toHaveBeenCalledWith({
          where: { id: 'user-1', kycStatus: { not: 'verified' } },
          data: { kycStatus: 'pending_review' },
        });
        expect(writes.kycProfileUpsert).toHaveBeenCalled();
      });

      it('guarded no-op: already verified → does not un-verify (existence check confirms found:true, no profile write)', async () => {
        const { prisma, writes } = makeSumsubPrisma({
          userUpdateMany: jest
            .fn<Promise<{ count: number }>, [unknown]>()
            .mockResolvedValue({ count: 0 }),
          userFindUnique: jest
            .fn<Promise<{ id: string } | null>, [unknown]>()
            .mockResolvedValue({ id: 'user-1' }),
        });
        const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

        const result = await repo.markSumsubPendingReview('user-1');

        expect(result).toEqual({ found: true });
        expect(writes.kycProfileUpsert).not.toHaveBeenCalled();
      });

      it('unknown user → found:false', async () => {
        const { prisma, writes } = makeSumsubPrisma({
          userUpdateMany: jest
            .fn<Promise<{ count: number }>, [unknown]>()
            .mockResolvedValue({ count: 0 }),
          userFindUnique: jest
            .fn<Promise<{ id: string } | null>, [unknown]>()
            .mockResolvedValue(null),
        });
        const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

        const result = await repo.markSumsubPendingReview('no-such-user');

        expect(result).toEqual({ found: false });
        expect(writes.kycProfileUpsert).not.toHaveBeenCalled();
      });
    });
  });

  describe('downgradeSumsubTier (RED auto-downgrade compliance policy)', () => {
    interface DowngradeWrites {
      userUpdateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
      kycProfileUpsert: jest.Mock<Promise<void>, [unknown]>;
    }

    /**
     * `downgradeSumsubTier` issues TWO `user.updateMany` calls in sequence
     * (the unconditional rejection, then the guarded tier downgrade) against
     * the SAME tx function — `mockResolvedValueOnce` chains their results in
     * call order.
     */
    function makeDowngradePrisma(
      rejectCount: number,
      downgradeCount: number,
    ): { prisma: PrismaService; writes: DowngradeWrites } {
      const userUpdateMany = jest
        .fn<Promise<{ count: number }>, [unknown]>()
        .mockResolvedValueOnce({ count: rejectCount })
        .mockResolvedValueOnce({ count: downgradeCount });
      const kycProfileUpsert = jest
        .fn<Promise<void>, [unknown]>()
        .mockResolvedValue(undefined);
      const tx = {
        user: { updateMany: userUpdateMany },
        kycProfile: { upsert: kycProfileUpsert },
      };
      const prisma = {
        $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) =>
          cb(tx),
        ),
      } as unknown as PrismaService;
      return { prisma, writes: { userUpdateMany, kycProfileUpsert } };
    }

    it('tier_2-level RED (targetTier tier_1): rejects status, downgrades tier, stamps tierChangedAt, upserts profile tier+status+reason', async () => {
      const { prisma, writes } = makeDowngradePrisma(1, 1);
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      const result = await repo.downgradeSumsubTier(
        'user-1',
        'tier_1',
        'ID_MISMATCH',
      );

      expect(result).toEqual({ found: true });
      expect(writes.userUpdateMany).toHaveBeenCalledTimes(2);

      const rejectArgs = writes.userUpdateMany.mock.calls[0][0] as {
        where: { id: string };
        data: { kycStatus: string };
      };
      expect(rejectArgs.where).toEqual({ id: 'user-1' });
      expect(rejectArgs.data.kycStatus).toBe('rejected');

      const downgradeArgs = writes.userUpdateMany.mock.calls[1][0] as {
        where: { id: string; kycTier: { in: string[] } };
        data: { kycTier: string; tierChangedAt: Date };
      };
      // tiersAbove(tier_1) — a tier_2 or tier_3 user both drop to tier_1.
      expect(downgradeArgs.where).toEqual({
        id: 'user-1',
        kycTier: { in: ['tier_2', 'tier_3'] },
      });
      expect(downgradeArgs.data.kycTier).toBe('tier_1');
      expect(downgradeArgs.data.tierChangedAt).toBeInstanceOf(Date);

      const profileArgs = writes.kycProfileUpsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(profileArgs.update.status).toBe('rejected');
      expect(profileArgs.update.rejectionReason).toBe('ID_MISMATCH');
      expect(profileArgs.update.tier).toBe('tier_1');
    });

    it('tier_3-level RED (targetTier tier_2): tiersAbove(tier_2) = [tier_3] only', async () => {
      const { prisma, writes } = makeDowngradePrisma(1, 1);
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      await repo.downgradeSumsubTier('user-1', 'tier_2', 'LIVENESS_FAILED');

      const downgradeArgs = writes.userUpdateMany.mock.calls[1][0] as {
        where: { kycTier: { in: string[] } };
        data: { kycTier: string };
      };
      expect(downgradeArgs.where.kycTier).toEqual({ in: ['tier_3'] });
      expect(downgradeArgs.data.kycTier).toBe('tier_2');
    });

    it('a tier_3 user hit by a tier_2-level RED (targetTier tier_1) drops all the way to tier_1', async () => {
      const { prisma, writes } = makeDowngradePrisma(1, 1);
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      await repo.downgradeSumsubTier('user-1', 'tier_1', 'DOC_MISMATCH');

      const downgradeArgs = writes.userUpdateMany.mock.calls[1][0] as {
        where: { kycTier: { in: string[] } };
        data: { kycTier: string };
      };
      expect(downgradeArgs.where.kycTier).toEqual({ in: ['tier_2', 'tier_3'] });
      expect(downgradeArgs.data.kycTier).toBe('tier_1');
    });

    it('idempotent no-op: already at/below target tier → guarded updateMany matches 0 rows, tier + tierChangedAt UNCHANGED, kycStatus still set to rejected', async () => {
      const { prisma, writes } = makeDowngradePrisma(1, 0);
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      const result = await repo.downgradeSumsubTier(
        'user-1',
        'tier_1',
        'ID_MISMATCH',
      );

      expect(result).toEqual({ found: true });
      expect(writes.userUpdateMany).toHaveBeenCalledTimes(2);

      const profileArgs = writes.kycProfileUpsert.mock.calls[0][0] as {
        update: Record<string, unknown>;
      };
      expect(profileArgs.update.status).toBe('rejected');
      expect(profileArgs.update.rejectionReason).toBe('ID_MISMATCH');
      expect(profileArgs.update).not.toHaveProperty('tier');
    });

    it('never RAISES a tier: a tier_1 user hit by a (hypothetical) tier_3-level RED (targetTier tier_2) is left untouched', async () => {
      const { prisma, writes } = makeDowngradePrisma(1, 0);
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      await repo.downgradeSumsubTier('user-1', 'tier_2', 'reason');

      const downgradeArgs = writes.userUpdateMany.mock.calls[1][0] as {
        where: { kycTier: { in: string[] } };
      };
      // tiersAbove(tier_2) = [tier_3] — a tier_1 user never matches.
      expect(downgradeArgs.where.kycTier).toEqual({ in: ['tier_3'] });
    });

    it('unknown user (no matching User row) → found:false, no profile write, no downgrade attempt', async () => {
      const { prisma, writes } = makeDowngradePrisma(0, 0);
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      const result = await repo.downgradeSumsubTier(
        'no-such-user',
        'tier_1',
        'reason',
      );

      expect(result).toEqual({ found: false });
      expect(writes.userUpdateMany).toHaveBeenCalledTimes(1);
      expect(writes.kycProfileUpsert).not.toHaveBeenCalled();
    });
  });

  describe('decryptIdentifier (read path)', () => {
    it('decrypts what completeVerificationAtomic wrote (round trip on read)', async () => {
      const captured = freshCaptured();
      const repo = new KycPrismaRepository(
        makePrisma(captured),
        makeConfig(ENC_KEY),
      );

      await repo.completeVerificationAtomic(ATOMIC_INPUT);
      const stored = captured.kycProfileCreate.mock.calls[0][0].data;

      expect(repo.decryptIdentifier(stored.nin)).toBe(NIN);
      expect(repo.decryptIdentifier(stored.bvn)).toBe(BVN);
    });

    it('returns null for null/empty stored values', () => {
      const repo = new KycPrismaRepository(
        makePrisma(freshCaptured()),
        makeConfig(ENC_KEY),
      );
      expect(repo.decryptIdentifier(null)).toBeNull();
      expect(repo.decryptIdentifier('')).toBeNull();
    });

    it('throws when reading a ciphertext with no key configured', () => {
      const repo = new KycPrismaRepository(
        makePrisma(freshCaptured()),
        makeConfig(''),
      );
      expect(() => repo.decryptIdentifier('v1.aaaa.bbbb.cccc')).toThrow(
        FieldEncryptionKeyError,
      );
    });
  });
});
