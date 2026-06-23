/**
 * Integration test for HandoffTokenPrismaRepository (K3).
 *
 * Runs against a real Postgres via Testcontainers — exercises all DB constraints,
 * atomic consume-on-redeem, sibling-token invalidation, and expiry filtering.
 * Requires Docker.
 */

import { PrismaClient } from '../generated/prisma/client';
import { HandoffTokenPrismaRepository } from '../src/modules/identity/infrastructure/handoff-token.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';
import { createHash, randomBytes } from 'node:crypto';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function futureDate(offsetMs: number = 30 * 60 * 1000): Date {
  return new Date(Date.now() + offsetMs);
}

function pastDate(offsetMs: number = 60 * 1000): Date {
  return new Date(Date.now() - offsetMs);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('HandoffTokenPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: HandoffTokenPrismaRepository;
  let userId: string;
  let channelAddress: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    repo = new HandoffTokenPrismaRepository(prisma as unknown as PrismaService);

    // Seed a User row (needed for userId FK — optional but present for real usage).
    const user = await prisma.user.create({
      data: { status: 'active', kycStatus: 'verified', kycTier: 'tier_1' },
    });
    userId = user.id;
    channelAddress = '+2348099990001';
  });

  afterAll(async () => {
    await stop?.();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  it('creates a token row with status=issued and returns the record', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);

    const record = await repo.create({
      tokenHash,
      userId,
      channelAddress,
      purpose: 'kyc',
      expiresAt: futureDate(),
    });

    expect(record.id).toBeTruthy();
    expect(record.tokenHash).toBe(tokenHash);
    expect(record.userId).toBe(userId);
    expect(record.channelAddress).toBe(channelAddress);
    expect(record.purpose).toBe('kyc');
    expect(record.status).toBe('issued');
    expect(record.redeemedAt).toBeNull();
  });

  it('creates a token row without userId (for unlinked contacts)', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);

    const record = await repo.create({
      tokenHash,
      channelAddress: '+2348099990002',
      purpose: 'kyc',
      expiresAt: futureDate(),
    });

    expect(record.userId).toBeNull();
    expect(record.channelAddress).toBe('+2348099990002');
    expect(record.status).toBe('issued');
  });

  // ---------------------------------------------------------------------------
  // findAndConsume: happy path
  // ---------------------------------------------------------------------------

  it('findAndConsume: valid token → returns pre-consume record, marks it redeemed', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);

    await repo.create({
      tokenHash,
      channelAddress,
      purpose: 'kyc',
      expiresAt: futureDate(),
    });

    const now = new Date();
    const result = await repo.findAndConsume({
      tokenHash,
      purpose: 'kyc',
      now,
    });

    expect(result).not.toBeNull();
    expect(result!.tokenHash).toBe(tokenHash);
    expect(result!.channelAddress).toBe(channelAddress);

    // Verify the DB row is now redeemed.
    const row = await prisma.handoffToken.findFirst({ where: { tokenHash } });
    expect(row?.status).toBe('redeemed');
    expect(row?.redeemedAt).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // findAndConsume: replay prevention
  // ---------------------------------------------------------------------------

  it('findAndConsume: second consume of the same token returns null (replay prevented)', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);

    await repo.create({
      tokenHash,
      channelAddress,
      purpose: 'kyc',
      expiresAt: futureDate(),
    });

    const now = new Date();
    // First consume: success
    const first = await repo.findAndConsume({ tokenHash, purpose: 'kyc', now });
    expect(first).not.toBeNull();

    // Second consume: returns null
    const second = await repo.findAndConsume({
      tokenHash,
      purpose: 'kyc',
      now,
    });
    expect(second).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // findAndConsume: sibling-token invalidation
  // ---------------------------------------------------------------------------

  it('findAndConsume: sibling tokens for the same channelAddress+purpose are revoked', async () => {
    const siblingChannel = '+2348099990099';
    const rawToken1 = randomBytes(32).toString('hex');
    const tokenHash1 = sha256(rawToken1);
    const rawToken2 = randomBytes(32).toString('hex');
    const tokenHash2 = sha256(rawToken2);

    // Mint two tokens for the same channel address.
    await repo.create({
      tokenHash: tokenHash1,
      channelAddress: siblingChannel,
      purpose: 'kyc',
      expiresAt: futureDate(),
    });
    await repo.create({
      tokenHash: tokenHash2,
      channelAddress: siblingChannel,
      purpose: 'kyc',
      expiresAt: futureDate(),
    });

    // Consume the first token.
    const now = new Date();
    const result = await repo.findAndConsume({
      tokenHash: tokenHash1,
      purpose: 'kyc',
      now,
    });
    expect(result).not.toBeNull();

    // The sibling (token2) must now be 'revoked'.
    const sibling = await prisma.handoffToken.findFirst({
      where: { tokenHash: tokenHash2 },
    });
    expect(sibling?.status).toBe('revoked');

    // token2 can no longer be consumed.
    const revokedConsume = await repo.findAndConsume({
      tokenHash: tokenHash2,
      purpose: 'kyc',
      now,
    });
    expect(revokedConsume).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // findAndConsume: expired token
  // ---------------------------------------------------------------------------

  it('findAndConsume: expired token returns null', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);

    await repo.create({
      tokenHash,
      channelAddress,
      purpose: 'kyc',
      expiresAt: pastDate(), // already expired
    });

    const now = new Date();
    const result = await repo.findAndConsume({
      tokenHash,
      purpose: 'kyc',
      now,
    });
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // findAndConsume: wrong purpose
  // ---------------------------------------------------------------------------

  it('findAndConsume: token with wrong purpose returns null', async () => {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);

    await repo.create({
      tokenHash,
      channelAddress,
      purpose: 'kyc',
      expiresAt: futureDate(),
    });

    const now = new Date();
    // Search with 'confirmation' purpose — should not find the 'kyc' token.
    const result = await repo.findAndConsume({
      tokenHash,
      purpose: 'confirmation',
      now,
    });
    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // findActiveForChannel
  // ---------------------------------------------------------------------------

  it('findActiveForChannel: returns issued, non-expired tokens for the given channelAddress', async () => {
    const testChannel = '+2348099990050';
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);

    await repo.create({
      tokenHash,
      channelAddress: testChannel,
      purpose: 'kyc',
      expiresAt: futureDate(),
    });

    const now = new Date();
    const results = await repo.findActiveForChannel({
      channelAddress: testChannel,
      purpose: 'kyc',
      now,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.status === 'issued')).toBe(true);
    expect(results.every((r) => r.channelAddress === testChannel)).toBe(true);
  });
});
