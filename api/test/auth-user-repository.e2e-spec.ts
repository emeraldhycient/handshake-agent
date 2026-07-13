import { PrismaClient } from '../generated/prisma/client';
import { AuthUserPrismaRepository } from '../src/modules/auth/infrastructure/auth-user.prisma.repository';
import { DeviceAlreadyBoundError } from '../src/modules/auth/domain/auth-errors';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('AuthUserPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: AuthUserPrismaRepository;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    repo = new AuthUserPrismaRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await stop?.();
  });

  it('createSignup creates a provisional user + pending whatsapp CI; idempotent on email', async () => {
    const a = await repo.createSignup({
      email: 'New@Test.com',
      phone: '+2348011111111',
    });
    expect(a.created).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: a.userId } });
    expect(user?.email).toBe('new@test.com'); // lowercased
    expect(user?.status).toBe('provisional');

    const ci = await prisma.channelIdentity.findFirst({
      where: { userId: a.userId, channel: 'whatsapp' },
    });
    expect(ci?.verificationStatus).toBe('pending');

    const again = await repo.createSignup({
      email: 'new@test.com',
      phone: '+2348011111111',
    });
    expect(again.created).toBe(false);
    expect(again.userId).toBe(a.userId);
  });

  it('createSignup with no phone creates a provisional user and NO WhatsApp ChannelIdentity', async () => {
    const a = await repo.createSignup({ email: 'NoPhone@Test.com' });
    expect(a.created).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: a.userId } });
    expect(user?.email).toBe('nophone@test.com'); // lowercased
    expect(user?.status).toBe('provisional');

    const ci = await prisma.channelIdentity.findFirst({
      where: { userId: a.userId, channel: 'whatsapp' },
    });
    expect(ci).toBeNull();
  });

  it('findByEmail is case-insensitive on the stored lowercase; markEmailVerified sets it', async () => {
    const { userId } = await repo.createSignup({
      email: 'v@test.com',
      phone: '+2348012222222',
    });
    expect((await repo.findByEmail('V@test.com'))?.emailVerifiedAt).toBeNull();
    await repo.markEmailVerified(userId, new Date());
    expect(
      (await repo.findByEmail('v@test.com'))?.emailVerifiedAt,
    ).not.toBeNull();
  });

  it('markEmailVerified grants kycTier=tier_1 + status=active + tierChangedAt on a fresh unverified user (Task 2.1)', async () => {
    const { userId } = await repo.createSignup({
      email: 'fresh-verify@test.com',
      phone: '+2348012222233',
    });
    const before = await prisma.user.findUnique({ where: { id: userId } });
    expect(before?.kycTier).toBe('unverified');
    expect(before?.status).toBe('provisional');
    expect(before?.tierChangedAt).toBeNull();

    const now = new Date();
    await repo.markEmailVerified(userId, now);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.kycTier).toBe('tier_1');
    expect(after?.status).toBe('active');
    expect(after?.tierChangedAt?.getTime()).toBe(now.getTime());
    expect(after?.emailVerifiedAt?.getTime()).toBe(now.getTime());
  });

  it('markEmailVerified does NOT downgrade or re-stamp tierChangedAt for a user already at tier_2 (guarded, no cooling-off restart)', async () => {
    const { userId } = await repo.createSignup({
      email: 're-verify@test.com',
      phone: '+2348012222244',
    });
    const originalTierChangedAt = new Date(Date.now() - 60_000);
    await prisma.user.update({
      where: { id: userId },
      data: { kycTier: 'tier_2', tierChangedAt: originalTierChangedAt },
    });

    // Simulate the user re-hitting a (still-valid) verification link.
    await repo.markEmailVerified(userId, new Date());

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.kycTier).toBe('tier_2'); // unchanged — no downgrade
    expect(after?.tierChangedAt?.getTime()).toBe(
      originalTierChangedAt.getTime(),
    ); // NOT re-stamped — cooling-off window must not restart
    expect(after?.emailVerifiedAt).not.toBeNull(); // still (re)stamped, that's fine
  });

  it('bindDevice upserts by fingerprint and pins on first bind', async () => {
    const { userId } = await repo.createSignup({
      email: 'd@test.com',
      phone: '+2348013333333',
    });
    const first = await repo.bindDevice({ userId, fingerprint: 'fp-xyz' });
    const second = await repo.bindDevice({ userId, fingerprint: 'fp-xyz' });
    expect(second.deviceId).toBe(first.deviceId); // upsert, not duplicate
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.pinnedDeviceId).toBe(first.deviceId);

    // Binding a DIFFERENT device must NOT overwrite the existing pin (§3.4).
    const third = await repo.bindDevice({ userId, fingerprint: 'fp-abc' });
    expect(third.deviceId).not.toBe(first.deviceId); // a new device row was created
    const userAfter = await prisma.user.findUnique({ where: { id: userId } });
    expect(userAfter?.pinnedDeviceId).toBe(first.deviceId); // pin survives — not overwritten
  });

  it('bindDevice throws DeviceAlreadyBoundError when the fingerprint is already pinned to another user (§3.4)', async () => {
    // User A signs up + binds a device on a shared browser → that device is
    // pinned to A. When user B signs up on the SAME browser, re-binding the same
    // fingerprint trips the User.pinnedDeviceId UNIQUE constraint (P2002). It must
    // surface as a mapped domain error, not a raw Prisma error → opaque 500.
    const a = await repo.createSignup({
      email: 'shared-a@test.com',
      phone: '+2348015555555',
    });
    await repo.bindDevice({ userId: a.userId, fingerprint: 'fp-shared' });

    const b = await repo.createSignup({
      email: 'shared-b@test.com',
      phone: '+2348016666666',
    });
    await expect(
      repo.bindDevice({ userId: b.userId, fingerprint: 'fp-shared' }),
    ).rejects.toBeInstanceOf(DeviceAlreadyBoundError);

    // B's pin stays unset — the failed bind left no partial state.
    const userB = await prisma.user.findUnique({ where: { id: b.userId } });
    expect(userB?.pinnedDeviceId).toBeNull();
  });

  it('loadMe projects kyc + hasPin, and emailVerified:false for a fresh unverified user', async () => {
    const { userId } = await repo.createSignup({
      email: 'm@test.com',
      phone: '+2348014444444',
    });
    const me = await repo.loadMe(userId);
    expect(me).toMatchObject({
      userId,
      email: 'm@test.com',
      hasPin: false,
      emailVerified: false,
    });
  });

  it('loadMe returns emailVerified:true once markEmailVerified has stamped emailVerifiedAt (Task 4.1)', async () => {
    const { userId } = await repo.createSignup({
      email: 'me-verified@test.com',
      phone: '+2348014444455',
    });
    await repo.markEmailVerified(userId, new Date());

    const me = await repo.loadMe(userId);
    expect(me).toMatchObject({ userId, emailVerified: true });
  });
});
