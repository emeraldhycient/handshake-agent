/**
 * Unit tests for IdentityPrismaRepository.resetKycToPending (Phase 9 admin
 * "Force re-KYC"). The reset moves User.kycStatus and any KycProfile back to
 * 'pending' in the SAME transaction so the server-side gate (§3.3) never sees a
 * partial reset, and it is a no-op on the profile when none exists.
 *
 * No Nest TestingModule — the repository is constructed directly with a faked
 * PrismaService whose $transaction invokes the callback with stub tx writers, so
 * the spec can inspect exactly what is persisted.
 */

import type { PrismaService } from '../../../core/prisma/prisma.service';
import { IdentityPrismaRepository } from './identity.prisma.repository';

const USER_ID = '11111111-1111-1111-1111-111111111111';

interface CapturedWrites {
  userUpdate: jest.Mock<Promise<void>, [unknown]>;
  kycProfileUpdateMany: jest.Mock<Promise<{ count: number }>, [unknown]>;
}

function makePrisma(captured: CapturedWrites): PrismaService {
  const tx = {
    user: { update: captured.userUpdate },
    kycProfile: { updateMany: captured.kycProfileUpdateMany },
  };
  return {
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;
}

function freshCaptured(): CapturedWrites {
  return {
    userUpdate: jest.fn<Promise<void>, [unknown]>(),
    kycProfileUpdateMany: jest
      .fn<Promise<{ count: number }>, [unknown]>()
      .mockResolvedValue({ count: 1 }),
  };
}

describe('IdentityPrismaRepository.resetKycToPending', () => {
  it('sets User.kycStatus = pending for the target user', async () => {
    const captured = freshCaptured();
    const repo = new IdentityPrismaRepository(makePrisma(captured));

    await repo.resetKycToPending(USER_ID);

    expect(captured.userUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { kycStatus: 'pending' },
    });
  });

  it('mirrors the KycProfile status to pending via updateMany (no-op when absent)', async () => {
    const captured = freshCaptured();
    const repo = new IdentityPrismaRepository(makePrisma(captured));

    await repo.resetKycToPending(USER_ID);

    // updateMany scoped by userId => a no-op (count 0) when no profile exists,
    // so the reset never throws for a user without a KycProfile row.
    expect(captured.kycProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { status: 'pending' },
    });
  });

  it('performs both writes inside a single transaction', async () => {
    const captured = freshCaptured();
    const prisma = makePrisma(captured);
    const repo = new IdentityPrismaRepository(prisma);

    await repo.resetKycToPending(USER_ID);

    expect(
      (prisma as unknown as { $transaction: jest.Mock }).$transaction,
    ).toHaveBeenCalledTimes(1);
    expect(captured.userUpdate).toHaveBeenCalledTimes(1);
    expect(captured.kycProfileUpdateMany).toHaveBeenCalledTimes(1);
  });
});
