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

  it('upsert replaces the prior active otp_email challenge hash but PRESERVES attemptCount', async () => {
    // Security invariant: re-issuing a login OTP must not reset the guess
    // counter — otherwise repeated login/request calls each grant a fresh
    // 5-attempt window, bypassing the brute-force guard.
    const userId = await seedUser();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);

    // First issue
    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'old',
      expiresAt,
    });

    // Simulate two wrong guesses (bumps counter to 2)
    const first = await repo.findActiveByUserAndType(userId, 'otp_email', now);
    await repo.incrementAttempt(first!.id);
    await repo.incrementAttempt(first!.id);
    const afterGuesses = await repo.findActiveByUserAndType(
      userId,
      'otp_email',
      now,
    );
    expect(afterGuesses?.attemptCount).toBe(2);

    // Re-issue (user requests a new OTP)
    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'new',
      expiresAt,
    });

    const reissued = await repo.findActiveByUserAndType(
      userId,
      'otp_email',
      now,
    );
    // New hash is active
    expect(reissued?.challengeHash).toBe('new');
    // Guess budget carries over — NOT reset to 0
    expect(reissued?.attemptCount).toBe(2);
  });

  it('upsert for otp_email RESETS attemptCount when re-issued after the prior EXPIRED', async () => {
    // C2 regression: preserving attemptCount across an EXPIRED challenge lets an
    // attacker permanently lock out any known email — exhaust the 5-guess budget
    // on one OTP, wait for it to expire, and every OTP the victim re-issues is
    // born already at the cap (findActiveByUserAndType returns it, attemptCount
    // >= max → InvalidOtp forever). The guess budget must only carry over while
    // the window is still ACTIVE; an expired window resets to 0.
    const userId = await seedUser();
    const now = new Date();

    // Issue an OTP that is already expired, then exhaust its guess budget.
    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'expired',
      expiresAt: new Date(now.getTime() - 1_000),
    });
    const expiredRow = await prisma.authChallenge.findUnique({
      where: { userId_type: { userId, type: 'otp_email' } },
      select: { id: true },
    });
    await repo.incrementAttempt(expiredRow!.id);
    await repo.incrementAttempt(expiredRow!.id);
    await repo.incrementAttempt(expiredRow!.id);

    // Victim re-issues a fresh login OTP after the prior window has expired.
    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'fresh',
      expiresAt: new Date(now.getTime() + 60_000),
    });

    const reissued = await repo.findActiveByUserAndType(
      userId,
      'otp_email',
      now,
    );
    expect(reissued?.challengeHash).toBe('fresh');
    // Budget reset — the prior window had expired, so this is a clean window.
    expect(reissued?.attemptCount).toBe(0);
  });

  it('upsert for otp_email RESETS attemptCount when re-issued after the prior was CONSUMED', async () => {
    // A consumed challenge (successful login) must not bleed its counter into the
    // next login attempt — only a still-active, unconsumed window preserves it.
    const userId = await seedUser();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000);

    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'c1',
      expiresAt,
    });
    const active = await repo.findActiveByUserAndType(userId, 'otp_email', now);
    await repo.incrementAttempt(active!.id);
    await repo.consume(active!.id, now);

    await repo.upsert({
      userId,
      type: 'otp_email',
      challengeHash: 'c2',
      expiresAt,
    });
    const reissued = await repo.findActiveByUserAndType(
      userId,
      'otp_email',
      now,
    );
    expect(reissued?.challengeHash).toBe('c2');
    expect(reissued?.attemptCount).toBe(0);
  });

  it('upsert for email_verification resets attemptCount to 0 on re-issue', async () => {
    // email_verification tokens are opaque + long-lived (not short numeric OTPs),
    // so resetting the counter on re-issue is safe and expected.
    const userId = await seedUser();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86_400_000);

    await repo.upsert({
      userId,
      type: 'email_verification',
      challengeHash: 'h-ev-old',
      expiresAt,
    });
    const first = await repo.findActiveByHashAndType(
      'h-ev-old',
      'email_verification',
      now,
    );
    // Bump counter to confirm it exists
    await repo.incrementAttempt(first!.id);

    // Re-issue
    await repo.upsert({
      userId,
      type: 'email_verification',
      challengeHash: 'h-ev-new',
      expiresAt,
    });
    const reissued = await repo.findActiveByHashAndType(
      'h-ev-new',
      'email_verification',
      now,
    );
    expect(reissued).not.toBeNull();
    // Counter was reset (email_verification policy)
    const full = await repo.findActiveByUserAndType(
      userId,
      'email_verification',
      now,
    );
    expect(full?.attemptCount).toBe(0);
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
