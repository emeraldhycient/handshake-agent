import { PrismaClient } from '../generated/prisma/client';
import { AuthSessionPrismaRepository } from '../src/modules/auth/infrastructure/auth-session.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('AuthSessionPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: AuthSessionPrismaRepository;
  let userId: string;
  let deviceId: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    repo = new AuthSessionPrismaRepository(prisma as unknown as PrismaService);
    const user = await prisma.user.create({ data: {} });
    userId = user.id;
    const device = await prisma.device.create({
      data: { userId, fingerprint: 'fp-session-test', trustState: 'bound' },
    });
    deviceId = device.id;
  });

  afterAll(async () => {
    await stop?.();
  });

  it('create then findActiveByAccessHash / findActiveByRefreshHash return the session', async () => {
    const now = new Date();
    const { sessionId } = await repo.create({
      userId,
      deviceId,
      accessTokenHash: 'ah',
      refreshTokenHash: 'rh',
      expiresAt: new Date(now.getTime() + 60_000),
    });
    expect((await repo.findActiveByAccessHash('ah', now))?.id).toBe(sessionId);
    expect((await repo.findActiveByRefreshHash('rh', now))?.userId).toBe(
      userId,
    );
  });

  it('rotate swaps the hashes; old hashes no longer resolve', async () => {
    const now = new Date();
    const { sessionId } = await repo.create({
      userId,
      deviceId,
      accessTokenHash: 'a1',
      refreshTokenHash: 'r1',
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await repo.rotate(sessionId, {
      accessTokenHash: 'a2',
      refreshTokenHash: 'r2',
      now,
    });
    expect(await repo.findActiveByRefreshHash('r1', now)).toBeNull();
    expect((await repo.findActiveByRefreshHash('r2', now))?.id).toBe(sessionId);
  });

  it('revoke makes the session inactive', async () => {
    const now = new Date();
    const { sessionId } = await repo.create({
      userId,
      deviceId,
      accessTokenHash: 'a',
      refreshTokenHash: 'r',
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await repo.revoke(sessionId, now, 'logout');
    expect(await repo.findActiveByAccessHash('a', now)).toBeNull();
  });

  it('expired sessions do not resolve', async () => {
    const past = new Date(Date.now() - 1000);
    await repo.create({
      userId,
      deviceId,
      accessTokenHash: 'x',
      refreshTokenHash: 'y',
      expiresAt: past,
    });
    expect(await repo.findActiveByAccessHash('x', new Date())).toBeNull();
  });
});
