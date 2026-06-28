import { PrismaClient } from '../generated/prisma/client';
import { AuthUserPrismaRepository } from '../src/modules/auth/infrastructure/auth-user.prisma.repository';
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
  });

  it('loadMe projects kyc + hasPin', async () => {
    const { userId } = await repo.createSignup({
      email: 'm@test.com',
      phone: '+2348014444444',
    });
    const me = await repo.loadMe(userId);
    expect(me).toMatchObject({ userId, email: 'm@test.com', hasPin: false });
  });
});
