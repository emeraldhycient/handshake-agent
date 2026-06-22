/**
 * Integration test for DirectivePrismaRepository (task 4.2, ADR-0005/0006).
 *
 * Verifies atomicity of `consumeIfIssued` (at-most-once) and the full
 * lifecycle against a real Postgres schema via Testcontainers. Requires Docker.
 *
 * Each test seeds its own Proposal row to avoid the @@unique([proposalId, directiveRef])
 * constraint when multiple tests use the same directiveRef against a shared proposal.
 *
 * Runs in the `test:e2e` lane (jest-e2e.json), NOT the default unit lane.
 */

import { createHash, randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '../generated/prisma/client';
import { DirectivePrismaRepository } from '../src/modules/transactions/infrastructure/directive.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function makeNonce(): string {
  return randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('DirectivePrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let repo: DirectivePrismaRepository;

  let userId: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());
    repo = new DirectivePrismaRepository(prisma as unknown as PrismaService);

    // Seed one User row (FK required by all DirectiveGrant rows and Proposals).
    const user = await prisma.user.create({ data: {} });
    userId = user.id;
  });

  afterAll(async () => {
    await stop?.();
  });

  /**
   * Seeds a fresh Proposal row and returns its id. Each test that inserts a
   * DirectiveGrant must call this to avoid the @@unique([proposalId, directiveRef])
   * constraint when multiple tests share the same directiveRef.
   */
  async function seedProposal(): Promise<string> {
    const proposal = await prisma.proposal.create({
      data: {
        userId,
        type: 'buy',
        status: 'pending',
        parameters: {},
        parametersChecksum: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    return proposal.id;
  }

  // ── create + consumeIfIssued (happy path) ──────────────────────────────────

  it('create() inserts a grant and consumeIfIssued() succeeds once', async () => {
    const proposalId = await seedProposal();
    const directiveId = randomUUID();
    const nonce = makeNonce();
    const nonceHash = sha256Hex(nonce);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 300_000); // 5 minutes

    await repo.create({
      directiveId,
      proposalId,
      userId,
      directiveRef: 'show_confirmation',
      origin: 'engine',
      nonceHash,
      signatureValue: 'sig-placeholder-'.repeat(4),
      issuedAt: now,
      expiresAt,
    });

    // Verify the row was inserted with status=issued.
    const raw = await prisma.directiveGrant.findUnique({
      where: { directiveId },
    });
    expect(raw).not.toBeNull();
    expect(raw!.status).toBe('issued');
    expect(raw!.nonceHash).toBe(nonceHash);

    // First consume: should succeed.
    const consumedAt = new Date();
    const result = await repo.consumeIfIssued({
      directiveId,
      consumedAt,
      consumedProposalId: proposalId,
    });

    expect(result).not.toBeNull();
    expect(result!.grant.directiveId).toBe(directiveId);
    expect(result!.grant.status).toBe('consumed');
    expect(result!.grant.consumedProposalId).toBe(proposalId);
    expect(result!.grant.nonceHash).toBe(nonceHash);
  });

  // ── at-most-once: second consume returns null ──────────────────────────────

  it('consumeIfIssued() returns null on a second attempt (at-most-once)', async () => {
    const proposalId = await seedProposal();
    const directiveId = randomUUID();
    const nonce = makeNonce();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 300_000);

    await repo.create({
      directiveId,
      proposalId,
      userId,
      directiveRef: 'request_pin',
      origin: 'engine',
      nonceHash: sha256Hex(nonce),
      signatureValue: 'sig-placeholder',
      issuedAt: now,
      expiresAt,
    });

    // First consume succeeds.
    const first = await repo.consumeIfIssued({
      directiveId,
      consumedAt: new Date(),
      consumedProposalId: proposalId,
    });
    expect(first).not.toBeNull();

    // Second consume must return null — replay rejected.
    const second = await repo.consumeIfIssued({
      directiveId,
      consumedAt: new Date(),
      consumedProposalId: proposalId,
    });
    expect(second).toBeNull();
  });

  // ── findById reflects consumed status ─────────────────────────────────────

  it('findById() reflects the consumed status after a successful consume', async () => {
    const proposalId = await seedProposal();
    const directiveId = randomUUID();
    const nonce = makeNonce();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 300_000);

    await repo.create({
      directiveId,
      proposalId,
      userId,
      directiveRef: 'show_confirmation',
      origin: 'engine',
      nonceHash: sha256Hex(nonce),
      signatureValue: 'sig',
      issuedAt: now,
      expiresAt,
    });

    await repo.consumeIfIssued({
      directiveId,
      consumedAt: new Date(),
      consumedProposalId: proposalId,
    });

    const found = await repo.findById(directiveId);
    expect(found).not.toBeNull();
    expect(found!.status).toBe('consumed');
    expect(found!.consumedProposalId).toBe(proposalId);
  });

  // ── consumeIfIssued returns null for an expired grant ─────────────────────

  it('consumeIfIssued() returns null for a grant that is already expired (expiresAt in the past)', async () => {
    const proposalId = await seedProposal();
    const directiveId = randomUUID();
    const nonce = makeNonce();
    const now = new Date();
    // Already expired.
    const expiresAt = new Date(now.getTime() - 1000);

    await repo.create({
      directiveId,
      proposalId,
      userId,
      directiveRef: 'show_confirmation',
      origin: 'engine',
      nonceHash: sha256Hex(nonce),
      signatureValue: 'sig',
      issuedAt: now,
      expiresAt,
    });

    const result = await repo.consumeIfIssued({
      directiveId,
      consumedAt: new Date(),
      consumedProposalId: proposalId,
    });
    expect(result).toBeNull();
  });

  // ── findById returns null for an unknown directiveId ──────────────────────

  it('findById() returns null for an unknown directiveId', async () => {
    const result = await repo.findById(randomUUID());
    expect(result).toBeNull();
  });

  // ── recordFailure increments failureCount ─────────────────────────────────

  it('recordFailure() increments failureCount and sets status=failed when grant is in issued state', async () => {
    const proposalId = await seedProposal();
    const directiveId = randomUUID();
    const nonce = makeNonce();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 300_000);

    await repo.create({
      directiveId,
      proposalId,
      userId,
      directiveRef: 'show_confirmation',
      origin: 'engine',
      nonceHash: sha256Hex(nonce),
      signatureValue: 'sig',
      issuedAt: now,
      expiresAt,
    });

    await repo.recordFailure(directiveId, 'signature mismatch');

    const found = await repo.findById(directiveId);
    expect(found).not.toBeNull();
    expect(found!.failureCount).toBe(1);
    expect(found!.failureReason).toBe('signature mismatch');
    expect(found!.status).toBe('failed');
  });

  // ── recordFailure on consumed grant does NOT change status to failed ───────

  it('recordFailure() increments failureCount on a consumed grant without changing status to failed', async () => {
    const proposalId = await seedProposal();
    const directiveId = randomUUID();
    const nonce = makeNonce();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 300_000);

    await repo.create({
      directiveId,
      proposalId,
      userId,
      directiveRef: 'show_confirmation',
      origin: 'engine',
      nonceHash: sha256Hex(nonce),
      signatureValue: 'sig',
      issuedAt: now,
      expiresAt,
    });

    // Consume first.
    await repo.consumeIfIssued({
      directiveId,
      consumedAt: new Date(),
      consumedProposalId: proposalId,
    });

    // Now record a failure (HMAC mismatch discovered post-consume).
    await repo.recordFailure(directiveId, 'HMAC mismatch post-consume');

    const found = await repo.findById(directiveId);
    expect(found).not.toBeNull();
    expect(found!.failureCount).toBe(1);
    // Status must stay 'consumed' — recordFailure skips terminal states.
    expect(found!.status).toBe('consumed');
  });
});
