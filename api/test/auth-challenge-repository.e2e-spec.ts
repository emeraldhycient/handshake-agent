import { PrismaClient } from '../generated/prisma/client';
import { AuthChallengePrismaRepository } from '../src/modules/auth/infrastructure/auth-challenge.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('AuthChallengePrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: AuthChallengePrismaRepository;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    // PrismaClient → PrismaService boundary cast (same API surface) — matches
    // the identity-repository.e2e-spec.ts pattern.
    repo = new AuthChallengePrismaRepository(
      prisma as unknown as PrismaService,
    );
  });

  afterAll(async () => {
    await stop?.();
  });

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({ data: {} });
    return user.id;
  }

  it('upsert then findActiveByHashAndType returns the row; consume makes it inactive', async () => {
    const userId = await seedUser();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    await repo.upsert({
      userId,
      type: 'email_verification',
      challengeHash: 'h1',
      expiresAt,
    });

    const found = await repo.findActiveByHashAndType(
      'h1',
      'email_verification',
      now,
    );
    expect(found).toMatchObject({ userId });

    await repo.consume(found!.id, now);
    expect(
      await repo.findActiveByHashAndType('h1', 'email_verification', now),
    ).toBeNull();
  });

  it('upsert replaces the prior active challenge for the same (user,type)', async () => {
    const userId = await seedUser();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);
    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'old',
      expiresAt,
    });
    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'new',
      expiresAt,
    });
    const byUser = await repo.findActiveByUserAndType(userId, 'otp_email', now);
    expect(byUser?.challengeHash).toBe('new');
    expect(byUser?.attemptCount).toBe(0);
  });

  it('expired challenges are not returned', async () => {
    const userId = await seedUser();
    const past = new Date(Date.now() - 1000);
    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'h',
      expiresAt: past,
    });
    expect(
      await repo.findActiveByUserAndType(userId, 'otp_email', new Date()),
    ).toBeNull();
  });

  it('incrementAttempt bumps the counter', async () => {
    const userId = await seedUser();
    const now = new Date();
    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'h',
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const c = await repo.findActiveByUserAndType(userId, 'otp_email', now);
    await repo.incrementAttempt(c!.id);
    const after = await repo.findActiveByUserAndType(userId, 'otp_email', now);
    expect(after?.attemptCount).toBe(1);
  });
});
