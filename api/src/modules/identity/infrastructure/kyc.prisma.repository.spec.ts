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

import {
  encryptField,
  FieldEncryptionKeyError,
} from '../../../core/crypto/field-encryption';
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

describe('KycPrismaRepository — NIN/BVN encryption at rest (NFR-1)', () => {
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

    it('a user with NO existing KycProfile (upsert create branch) where the downgrade applies → create payload also carries tier: target, mirroring the update branch', async () => {
      const { prisma, writes } = makeDowngradePrisma(1, 1);
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      const result = await repo.downgradeSumsubTier(
        'user-1',
        'tier_1',
        'ID_MISMATCH',
      );

      expect(result).toEqual({ found: true });
      const profileArgs = writes.kycProfileUpsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
      };
      expect(profileArgs.create.userId).toBe('user-1');
      expect(profileArgs.create.status).toBe('rejected');
      expect(profileArgs.create.rejectionReason).toBe('ID_MISMATCH');
      expect(profileArgs.create.tier).toBe('tier_1');
    });

    it('a user with NO existing KycProfile (upsert create branch) where the downgrade is a no-op (count 0) → create payload omits tier, matching the update branch', async () => {
      const { prisma, writes } = makeDowngradePrisma(1, 0);
      const repo = new KycPrismaRepository(prisma, makeConfig(ENC_KEY));

      await repo.downgradeSumsubTier('user-1', 'tier_1', 'ID_MISMATCH');

      const profileArgs = writes.kycProfileUpsert.mock.calls[0][0] as {
        create: Record<string, unknown>;
      };
      expect(profileArgs.create).not.toHaveProperty('tier');
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
    it('decrypts a stored ciphertext back to the original plaintext (round trip)', () => {
      const repo = new KycPrismaRepository(
        makePrisma(freshCaptured()),
        makeConfig(ENC_KEY),
      );

      const ninCiphertext = encryptField(NIN, ENC_KEY);
      const bvnCiphertext = encryptField(BVN, ENC_KEY);

      expect(repo.decryptIdentifier(ninCiphertext)).toBe(NIN);
      expect(repo.decryptIdentifier(bvnCiphertext)).toBe(BVN);
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
