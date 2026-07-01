import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { IdentityPrismaRepository } from '../src/modules/identity/infrastructure/identity.prisma.repository';
import { KycPrismaRepository } from '../src/modules/identity/infrastructure/kyc.prisma.repository';

import { startTestPostgres } from './helpers/pg-testcontainer';

let prisma: PrismaClient;
let stop: () => Promise<void>;
let identityRepo: IdentityPrismaRepository;
let kycRepo: KycPrismaRepository;

function email(): string {
  return `${randomUUID()}@user.test`;
}

interface SeedUserOptions {
  status?: string;
  kycStatus?: string;
  kycTier?: string;
  emailAddress?: string | null;
  simSwapDetectedAt?: Date | null;
  createdAt?: Date;
}

async function seedUser(opts: SeedUserOptions = {}): Promise<string> {
  const user = await prisma.user.create({
    data: {
      status: (opts.status ?? 'active') as never,
      kycStatus: (opts.kycStatus ?? 'verified') as never,
      kycTier: (opts.kycTier ?? 'tier_1') as never,
      email: opts.emailAddress === undefined ? email() : opts.emailAddress,
      simSwapDetectedAt: opts.simSwapDetectedAt ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
    select: { id: true },
  });
  return user.id;
}

beforeAll(async () => {
  const t = await startTestPostgres();
  prisma = t.prisma;
  stop = t.stop;
  identityRepo = new IdentityPrismaRepository(
    prisma as unknown as PrismaService,
  );
  kycRepo = new KycPrismaRepository(prisma as unknown as PrismaService, {
    get: (k: string) =>
      k === 'KYC_ENCRYPTION_KEY'
        ? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        : undefined,
  } as never);
}, 180_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  // Order matters: children before parents (FK constraints).
  await prisma.kycProfile.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.updateMany({ data: { pinnedDeviceId: null } });
  await prisma.device.deleteMany();
  await prisma.channelIdentity.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.user.deleteMany();
});

describe('IdentityPrismaRepository — admin reads (integration)', () => {
  describe('listUsers', () => {
    it('filters by email substring (case-insensitive contains)', async () => {
      await seedUser({ emailAddress: 'alice.smith@user.test' });
      await seedUser({ emailAddress: 'bob.jones@user.test' });

      const page = await identityRepo.listUsers(
        { query: 'ALICE' },
        { limit: 10 },
      );

      expect(page.items).toHaveLength(1);
      expect(page.items[0].email).toBe('alice.smith@user.test');
    });

    it('filters by status and kycTier', async () => {
      await seedUser({ status: 'active', kycTier: 'tier_1' });
      await seedUser({ status: 'suspended', kycTier: 'tier_1' });
      await seedUser({ status: 'active', kycTier: 'tier_2' });

      const page = await identityRepo.listUsers(
        { status: 'active', kycTier: 'tier_1' },
        { limit: 10 },
      );

      expect(page.items).toHaveLength(1);
      expect(page.items[0].status).toBe('active');
      expect(page.items[0].kycTier).toBe('tier_1');
    });

    it('paginates by cursor, newest-first', async () => {
      const base = new Date('2026-01-01T00:00:00.000Z');
      for (let i = 0; i < 3; i++) {
        await seedUser({ createdAt: new Date(base.getTime() + i * 1000) });
      }

      const page1 = await identityRepo.listUsers({}, { limit: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await identityRepo.listUsers(
        {},
        { limit: 2, cursor: page1.nextCursor! },
      );
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();

      const ids = [...page1.items, ...page2.items].map((x) => x.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('maps the full AdminUserListRecord shape', async () => {
      const swapAt = new Date('2026-02-02T00:00:00.000Z');
      const userId = await seedUser({
        emailAddress: 'mapcheck@user.test',
        status: 'active',
        kycStatus: 'verified',
        kycTier: 'tier_1',
        simSwapDetectedAt: swapAt,
      });

      const page = await identityRepo.listUsers({}, { limit: 10 });
      const row = page.items.find((x) => x.id === userId);

      expect(row).toMatchObject({
        id: userId,
        email: 'mapcheck@user.test',
        status: 'active',
        kycStatus: 'verified',
        kycTier: 'tier_1',
      });
      expect(row?.simSwapDetectedAt?.getTime()).toBe(swapAt.getTime());
      expect(row?.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('listUsersPendingKycReview', () => {
    it('returns only users with kycStatus pending_review', async () => {
      const pendingId = await seedUser({ kycStatus: 'pending_review' });
      await seedUser({ kycStatus: 'verified' });

      const page = await identityRepo.listUsersPendingKycReview({ limit: 10 });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(pendingId);
      expect(page.items[0].kycStatus).toBe('pending_review');
    });
  });

  describe('loadUserWithKycAndDevices', () => {
    it('returns null for an unknown user', async () => {
      expect(
        await identityRepo.loadUserWithKycAndDevices(randomUUID()),
      ).toBeNull();
    });

    it('composes user + kyc profile + devices', async () => {
      const userId = await seedUser({ emailAddress: 'composite@user.test' });

      const dob = new Date('1990-05-05T00:00:00.000Z');
      await prisma.kycProfile.create({
        data: {
          userId,
          status: 'verified' as never,
          tier: 'tier_1' as never,
          nin: '12345678901',
          bvn: '22222222222',
          idDocumentType: 'passport' as never,
          firstName: 'Ada',
          lastName: 'Lovelace',
          dateOfBirth: dob,
          rejectionReason: null,
        },
      });

      const device = await prisma.device.create({
        data: {
          userId,
          fingerprint: `fp-${randomUUID()}`,
          trustState: 'bound' as never,
          boundAt: new Date('2026-03-03T00:00:00.000Z'),
          lastUsedAt: new Date('2026-03-04T00:00:00.000Z'),
        },
        select: { id: true },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { pinnedDeviceId: device.id },
      });

      const detail = await identityRepo.loadUserWithKycAndDevices(userId);

      expect(detail).not.toBeNull();
      expect(detail?.id).toBe(userId);
      expect(detail?.email).toBe('composite@user.test');
      expect(detail?.pinnedDeviceId).toBe(device.id);

      expect(detail?.kyc).toMatchObject({
        firstName: 'Ada',
        lastName: 'Lovelace',
        nin: '12345678901',
        bvn: '22222222222',
        idDocumentType: 'passport',
        livenessCheckResult: 'not_attempted',
        status: 'verified',
        tier: 'tier_1',
        rejectionReason: null,
      });
      expect(detail?.kyc?.dateOfBirth?.getTime()).toBe(dob.getTime());

      expect(detail?.devices).toHaveLength(1);
      expect(detail?.devices[0]).toMatchObject({
        id: device.id,
        trustState: 'bound',
      });
      expect(detail?.devices[0].boundAt).toBeInstanceOf(Date);
      expect(detail?.devices[0].lastUsedAt).toBeInstanceOf(Date);
    });

    it('returns kyc null when no profile exists', async () => {
      const userId = await seedUser();
      const detail = await identityRepo.loadUserWithKycAndDevices(userId);
      expect(detail?.kyc).toBeNull();
      expect(detail?.devices).toEqual([]);
    });
  });

  describe('listDevicesForUser', () => {
    it('returns the user devices as DeviceRecords', async () => {
      const userId = await seedUser();
      await prisma.device.create({
        data: {
          userId,
          fingerprint: `fp-${randomUUID()}`,
          trustState: 'bound' as never,
        },
      });

      const devices = await identityRepo.listDevicesForUser(userId);
      expect(devices).toHaveLength(1);
      expect(devices[0].trustState).toBe('bound');
    });
  });

  describe('mutations', () => {
    it('setUserStatus updates status', async () => {
      const userId = await seedUser({ status: 'active' });
      await identityRepo.setUserStatus(userId, 'suspended');
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(row.status).toBe('suspended');
    });

    it('setKycTier updates kycTier', async () => {
      const userId = await seedUser({ kycTier: 'tier_1' });
      await identityRepo.setKycTier(userId, 'tier_2');
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(row.kycTier).toBe('tier_2');
    });

    it('setSimSwapDetectedAt sets and clears the flag', async () => {
      const userId = await seedUser({ simSwapDetectedAt: null });
      const at = new Date('2026-04-04T00:00:00.000Z');

      await identityRepo.setSimSwapDetectedAt(userId, at);
      let row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(row.simSwapDetectedAt?.getTime()).toBe(at.getTime());

      await identityRepo.setSimSwapDetectedAt(userId, null);
      row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(row.simSwapDetectedAt).toBeNull();
    });

    it('revokeDevice sets the device trustState to revoked', async () => {
      const userId = await seedUser();
      const device = await prisma.device.create({
        data: {
          userId,
          fingerprint: `fp-${randomUUID()}`,
          trustState: 'bound' as never,
        },
        select: { id: true },
      });

      await identityRepo.revokeDevice(device.id);
      const row = await prisma.device.findUniqueOrThrow({
        where: { id: device.id },
      });
      expect(row.trustState).toBe('revoked');
    });

    it('unpinDevice clears the user pinnedDeviceId', async () => {
      const userId = await seedUser();
      const device = await prisma.device.create({
        data: {
          userId,
          fingerprint: `fp-${randomUUID()}`,
          trustState: 'bound' as never,
        },
        select: { id: true },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { pinnedDeviceId: device.id },
      });

      await identityRepo.unpinDevice(userId);
      const row = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(row.pinnedDeviceId).toBeNull();
    });
  });
});

describe('KycPrismaRepository — admin decision (integration)', () => {
  it('updateKycProfileDecision (verified) updates KycProfile AND User atomically', async () => {
    const userId = await seedUser({
      kycStatus: 'pending_review',
      kycTier: 'unverified',
    });
    await prisma.kycProfile.create({
      data: {
        userId,
        status: 'pending_review' as never,
        tier: 'unverified' as never,
        firstName: 'Grace',
        lastName: 'Hopper',
      },
    });

    const adminId = randomUUID();
    await kycRepo.updateKycProfileDecision(userId, {
      status: 'verified',
      tier: 'tier_2',
      reviewedByAdminId: adminId,
    });

    const profile = await prisma.kycProfile.findUniqueOrThrow({
      where: { userId },
    });
    expect(profile.status).toBe('verified');
    expect(profile.tier).toBe('tier_2');
    expect(profile.reviewedByAdminId).toBe(adminId);
    expect(profile.rejectionReason).toBeNull();
    expect(profile.verifiedAt).not.toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.kycStatus).toBe('verified');
    expect(user.kycTier).toBe('tier_2');
  });

  it('updateKycProfileDecision (rejected) persists the rejection reason and leaves verifiedAt null', async () => {
    const userId = await seedUser({
      kycStatus: 'pending_review',
      kycTier: 'unverified',
    });
    await prisma.kycProfile.create({
      data: {
        userId,
        status: 'pending_review' as never,
        tier: 'unverified' as never,
        firstName: 'Alan',
        lastName: 'Turing',
      },
    });

    await kycRepo.updateKycProfileDecision(userId, {
      status: 'rejected',
      tier: 'unverified',
      rejectionReason: 'document mismatch',
      reviewedByAdminId: randomUUID(),
    });

    const profile = await prisma.kycProfile.findUniqueOrThrow({
      where: { userId },
    });
    expect(profile.status).toBe('rejected');
    expect(profile.rejectionReason).toBe('document mismatch');
    expect(profile.verifiedAt).toBeNull();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.kycStatus).toBe('rejected');
    expect(user.kycTier).toBe('unverified');
  });
});
