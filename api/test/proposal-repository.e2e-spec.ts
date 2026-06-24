/**
 * Integration test for QuotePrismaRepository + ProposalPrismaRepository (task 4.1).
 *
 * Verifies that both repositories persist rows to a REAL Postgres schema and
 * read them back with the correct field values.
 *
 * Requires Docker (Testcontainers). Runs in the `test:e2e` lane only.
 */

import { PrismaClient } from '../generated/prisma/client';
import { QuotePrismaRepository } from '../src/modules/transactions/infrastructure/quote.prisma.repository';
import { ProposalPrismaRepository } from '../src/modules/transactions/infrastructure/proposal.prisma.repository';
import type { PrismaService } from '../src/core/prisma/prisma.service';
import { startTestPostgres } from './helpers/pg-testcontainer';

jest.setTimeout(180_000);

describe('QuotePrismaRepository + ProposalPrismaRepository (integration, Testcontainers Postgres)', () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let quoteRepo: QuotePrismaRepository;
  let proposalRepo: ProposalPrismaRepository;

  // Shared userId seeded once for FK compliance
  let userId: string;

  beforeAll(async () => {
    ({ prisma, stop } = await startTestPostgres());

    // Boundary cast: PrismaClient → PrismaService (same API surface; safe at runtime).
    quoteRepo = new QuotePrismaRepository(prisma as unknown as PrismaService);
    proposalRepo = new ProposalPrismaRepository(
      prisma as unknown as PrismaService,
    );

    // Seed a User row (FK required by both Quote and Proposal).
    const user = await prisma.user.create({ data: {} });
    userId = user.id;
  });

  afterAll(async () => {
    await stop?.();
  });

  // ── QuotePrismaRepository ─────────────────────────────────────────────────

  describe('QuotePrismaRepository', () => {
    it('create() persists a Quote row and returns an id', async () => {
      const now = new Date('2024-06-01T12:00:00.000Z');
      const expiresAt = new Date(now.getTime() + 60_000);

      const { id } = await quoteRepo.create({
        userId,
        type: 'buy',
        asset: 'USDT',
        fiatCurrency: 'NGN',
        fiatAmount: '10000',
        cryptoAmount: '6.123456',
        fxRate: '1600.123456',
        baseRate: '1600.123456',
        spreadBps: 100,
        processingFeeBps: 50,
        processingFeeAmount: '50.00',
        quotedAt: now,
        expiresAt,
      });

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');

      // Read back directly via PrismaClient to verify persisted values.
      const row = await prisma.quote.findUnique({ where: { id } });
      expect(row).not.toBeNull();
      expect(row!.userId).toBe(userId);
      expect(row!.type).toBe('buy');
      expect(row!.asset).toBe('USDT');
      expect(row!.fiatCurrency).toBe('NGN');
      expect(row!.fiatAmount.toString()).toBe('10000');
      expect(row!.cryptoAmount).toBe('6.123456');
      expect(row!.fxRate).toBe('1600.123456');
      expect(row!.spreadBps).toBe(100);
      expect(row!.processingFeeBps).toBe(50);
      expect(row!.processingFeeAmount.toString()).toBe('50');
      expect(row!.status).toBe('valid');
      expect(row!.expiresAt).toEqual(expiresAt);
    });

    it('create() generates a unique id for each Quote', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 60_000);

      const data = {
        userId,
        type: 'buy',
        asset: 'USDT',
        fiatCurrency: 'NGN',
        fiatAmount: '5000',
        cryptoAmount: '3.0',
        fxRate: '1600',
        baseRate: '1600',
        spreadBps: 100,
        processingFeeBps: 50,
        processingFeeAmount: '25.00',
        quotedAt: now,
        expiresAt,
      } as const;

      const { id: id1 } = await quoteRepo.create(data);
      const { id: id2 } = await quoteRepo.create(data);

      expect(id1).not.toBe(id2);
    });
  });

  // ── ProposalPrismaRepository ──────────────────────────────────────────────

  describe('ProposalPrismaRepository', () => {
    it('create() persists a Proposal row linked to a Quote and returns an id', async () => {
      // First create a Quote so we have a valid quoteId FK.
      const now = new Date('2024-06-01T12:00:00.000Z');
      const expiresAt = new Date(now.getTime() + 60_000);

      const { id: quoteId } = await quoteRepo.create({
        userId,
        type: 'buy',
        asset: 'USDT',
        fiatCurrency: 'NGN',
        fiatAmount: '10000',
        cryptoAmount: '6.123456',
        fxRate: '1600.123456',
        baseRate: '1600.123456',
        spreadBps: 100,
        processingFeeBps: 50,
        processingFeeAmount: '50.00',
        quotedAt: now,
        expiresAt,
      });

      const parameters = {
        asset: 'USDT',
        fiatAmount: '10000',
        fiatCurrency: 'NGN',
        cryptoAmount: '6.123456',
        fxRate: '1600.123456',
        quoteId,
      };
      const checksum = 'a'.repeat(64); // placeholder checksum for this test

      const { id } = await proposalRepo.create({
        userId,
        type: 'buy',
        parameters,
        parametersChecksum: checksum,
        quoteId,
        expiresAt,
      });

      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');

      // Read back directly.
      const row = await prisma.proposal.findUnique({ where: { id } });
      expect(row).not.toBeNull();
      expect(row!.userId).toBe(userId);
      expect(row!.type).toBe('buy');
      expect(row!.status).toBe('pending');
      expect(row!.quoteId).toBe(quoteId);
      expect(row!.parametersChecksum).toBe(checksum);
      expect(row!.expiresAt).toEqual(expiresAt);
      expect(row!.conversationId).toBeNull();
    });

    it('findById() returns the persisted Proposal', async () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 120_000);

      const { id: quoteId } = await quoteRepo.create({
        userId,
        type: 'buy',
        asset: 'USDT',
        fiatCurrency: 'NGN',
        fiatAmount: '2000',
        cryptoAmount: '1.25',
        fxRate: '1600',
        baseRate: '1600',
        spreadBps: 100,
        processingFeeBps: 50,
        processingFeeAmount: '10.00',
        quotedAt: now,
        expiresAt,
      });

      const parameters = {
        asset: 'USDT',
        fiatAmount: '2000',
        fiatCurrency: 'NGN',
      };
      const checksum = 'b'.repeat(64);

      const { id } = await proposalRepo.create({
        userId,
        type: 'buy',
        parameters,
        parametersChecksum: checksum,
        quoteId,
        expiresAt,
      });

      const found = await proposalRepo.findById(id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(id);
      expect(found!.userId).toBe(userId);
      expect(found!.type).toBe('buy');
      expect(found!.status).toBe('pending');
      expect(found!.parametersChecksum).toBe(checksum);
      expect(found!.quoteId).toBe(quoteId);
    });

    it('findById() returns null for an unknown id', async () => {
      const result = await proposalRepo.findById(
        '00000000-0000-7000-8000-000000000099',
      );
      expect(result).toBeNull();
    });

    it('create() works without conversationId (nullable FK)', async () => {
      const expiresAt = new Date(Date.now() + 60_000);

      const { id: quoteId } = await quoteRepo.create({
        userId,
        type: 'buy',
        asset: 'USDT',
        fiatCurrency: 'NGN',
        fiatAmount: '1000',
        cryptoAmount: '0.625',
        fxRate: '1600',
        baseRate: '1600',
        spreadBps: 100,
        processingFeeBps: 50,
        processingFeeAmount: '5.00',
        quotedAt: new Date(),
        expiresAt,
      });

      const { id } = await proposalRepo.create({
        userId,
        type: 'buy',
        parameters: { asset: 'USDT' },
        parametersChecksum: 'c'.repeat(64),
        quoteId,
        expiresAt,
      });

      const found = await proposalRepo.findById(id);
      expect(found).not.toBeNull();
      expect(found!.conversationId).toBeNull();
    });
  });
});
