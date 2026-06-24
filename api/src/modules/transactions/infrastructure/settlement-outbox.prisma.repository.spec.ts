/**
 * Unit tests for SettlementOutboxPrismaRepository (Fix F — new methods).
 *
 * TDD: tests written before implementation.
 *
 * Verifies:
 *   - findPending: only returns rows with status=pending AND createdAt < cutoff.
 *   - findPending: excludes completed rows.
 *   - findPending: respects the limit.
 *   - markAttempt: increments attempt and sets lastAttemptAt.
 *   - complete: sets status=completed and completedAt.
 */

import { SettlementOutboxPrismaRepository } from './settlement-outbox.prisma.repository';
import type { PrismaService } from '../../../core/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Stub PrismaService
// ---------------------------------------------------------------------------

function buildMockPrisma(
  overrides: {
    create?: jest.Mock;
    findMany?: jest.Mock;
    update?: jest.Mock;
  } = {},
): PrismaService {
  return {
    settlementOutbox: {
      create: overrides.create ?? jest.fn(),
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
      update: overrides.update ?? jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
}

function makeDbRow(
  overrides: Partial<{
    id: string;
    transactionId: string;
    settlementType: string;
    payload: unknown;
    idempotencyKey: string | null;
    status: string;
    processorRef: string | null;
    attempt: number;
    lastAttemptAt: Date | null;
    createdAt: Date;
  }> = {},
) {
  return {
    id: 'row-1',
    transactionId: 'txn-1',
    settlementType: 'processor_payout',
    payload: { reference: 'ref-1' },
    idempotencyKey: 'ref-1',
    status: 'pending',
    processorRef: null,
    attempt: 1,
    lastAttemptAt: null,
    createdAt: new Date(Date.now() - 300_000),
    ...overrides,
  };
}

describe('SettlementOutboxPrismaRepository', () => {
  let findManyMock: jest.Mock;
  let updateMock: jest.Mock;
  let repo: SettlementOutboxPrismaRepository;

  beforeEach(() => {
    findManyMock = jest.fn().mockResolvedValue([]);
    updateMock = jest.fn().mockResolvedValue({});
    repo = new SettlementOutboxPrismaRepository(
      buildMockPrisma({ findMany: findManyMock, update: updateMock }),
    );
  });

  // ── findPending ───────────────────────────────────────────────────────────

  it('calls findMany with status=pending and createdAt < cutoff', async () => {
    const before = Date.now();

    await repo.findPending({ olderThanSec: 120, limit: 10 });

    const after = Date.now();
    expect(findManyMock).toHaveBeenCalledTimes(1);
    // mock.calls[0] is the array of arguments for the first call; [0] is the first arg.
    const callArg = (
      findManyMock.mock.calls[0] as [
        {
          where: { status: string; createdAt: { lt: Date } };
          take: number;
          orderBy: { createdAt: string };
        },
      ]
    )[0];
    expect(callArg.where.status).toBe('pending');
    // cutoff should be between (before - 120s) and (after - 120s)
    const cutoffMs = callArg.where.createdAt.lt.getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 120_000 - 50);
    expect(cutoffMs).toBeLessThanOrEqual(after - 120_000 + 50);
    expect(callArg.take).toBe(10);
    expect(callArg.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('maps db rows to SettlementOutboxRecord including attempt and lastAttemptAt', async () => {
    const lastAttempt = new Date();
    findManyMock.mockResolvedValue([
      makeDbRow({ attempt: 3, lastAttemptAt: lastAttempt }),
    ]);

    const results = await repo.findPending({ olderThanSec: 60, limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].attempt).toBe(3);
    expect(results[0].lastAttemptAt).toEqual(lastAttempt);
    expect(results[0].status).toBe('pending');
  });

  it('returns empty array when no pending rows exist', async () => {
    findManyMock.mockResolvedValue([]);

    const results = await repo.findPending({ olderThanSec: 120, limit: 20 });

    expect(results).toEqual([]);
  });

  // ── markAttempt ───────────────────────────────────────────────────────────

  it('calls update with attempt increment and lastAttemptAt', async () => {
    const before = Date.now();
    await repo.markAttempt('row-abc');
    const after = Date.now();

    expect(updateMock).toHaveBeenCalledTimes(1);
    const callArg = (
      updateMock.mock.calls[0] as [
        {
          where: { id: string };
          data: { attempt: { increment: number }; lastAttemptAt: Date };
        },
      ]
    )[0];
    expect(callArg.where).toEqual({ id: 'row-abc' });
    expect(callArg.data.attempt).toEqual({ increment: 1 });
    const ts = callArg.data.lastAttemptAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  // ── complete ─────────────────────────────────────────────────────────────

  it('calls update with status=completed and completedAt', async () => {
    const before = Date.now();
    await repo.complete('row-xyz');
    const after = Date.now();

    expect(updateMock).toHaveBeenCalledTimes(1);
    const callArg = (
      updateMock.mock.calls[0] as [
        { where: { id: string }; data: { status: string; completedAt: Date } },
      ]
    )[0];
    expect(callArg.where).toEqual({ id: 'row-xyz' });
    expect(callArg.data.status).toBe('completed');
    const ts = callArg.data.completedAt.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
