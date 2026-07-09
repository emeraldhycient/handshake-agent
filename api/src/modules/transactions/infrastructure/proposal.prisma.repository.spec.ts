/**
 * Unit tests for ProposalPrismaRepository.listPendingForUser (Wave C — MCP).
 *
 * TDD: written before the implementation. The read backs the MCP
 * `list_pending_proposals` tool and is STRICTLY read-only (§3.1): it lists the
 * caller's own still-actionable proposals (pending/confirmed, unexpired),
 * newest first, bounded — it never mutates status and never executes.
 */

import { ProposalPrismaRepository } from './proposal.prisma.repository';
import type { PrismaService } from '../../../core/prisma/prisma.service';

const NOW = new Date('2026-07-08T12:00:00.000Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '018f6b3a-0000-7000-8000-000000000001',
    userId: 'user-1',
    conversationId: null,
    type: 'buy',
    status: 'pending',
    parameters: { fiatAmount: '5000' },
    parametersChecksum: 'abc',
    quoteId: null,
    expiresAt: new Date('2026-07-08T12:05:00.000Z'),
    confirmedAt: null,
    createdAt: new Date('2026-07-08T11:59:00.000Z'),
    ...overrides,
  };
}

function makeRepo(rows: unknown[] = []) {
  const findManyMock = jest.fn().mockResolvedValue(rows);
  const prisma = {
    proposal: { findMany: findManyMock },
  } as unknown as PrismaService;
  return { repo: new ProposalPrismaRepository(prisma), findManyMock };
}

describe('ProposalPrismaRepository.listPendingForUser', () => {
  it('filters to the user + executable statuses + unexpired, newest first, bounded', async () => {
    const { repo, findManyMock } = makeRepo([makeRow()]);

    await repo.listPendingForUser('user-1', NOW);

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          status: { in: ['pending', 'confirmed'] },
          expiresAt: { gt: NOW },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
  });

  it('maps rows to ProposalRecord shape', async () => {
    const row = makeRow();
    const { repo } = makeRepo([row]);

    const out = await repo.listPendingForUser('user-1', NOW);

    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: row.id,
      userId: 'user-1',
      conversationId: null,
      type: 'buy',
      status: 'pending',
      parameters: { fiatAmount: '5000' },
      parametersChecksum: 'abc',
      quoteId: null,
      expiresAt: row.expiresAt,
      confirmedAt: null,
      createdAt: row.createdAt,
    });
  });

  it('returns an empty array when the user has no actionable proposals', async () => {
    const { repo } = makeRepo([]);
    await expect(repo.listPendingForUser('user-1', NOW)).resolves.toEqual([]);
  });
});
