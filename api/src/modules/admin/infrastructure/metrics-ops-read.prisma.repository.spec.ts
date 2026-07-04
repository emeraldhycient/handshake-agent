import { MetricsOpsReadPrismaRepository } from './metrics-ops-read.prisma.repository';
import type { PrismaService } from '../../../core/prisma/prisma.service';
import type { IProviderConnectivity } from '../application/ports/provider-connectivity.port';

/** A completed outbox row → statusOf() 'ok', latencyOf() 150ms. */
const completedRow = {
  status: 'completed',
  createdAt: new Date('2026-07-04T00:00:00.000Z'),
  lastAttemptAt: null,
  completedAt: new Date('2026-07-04T00:00:00.150Z'),
};

function makePrisma(): PrismaService {
  return {
    settlementOutbox: {
      findMany: jest.fn().mockResolvedValue([completedRow]),
      count: jest.fn().mockResolvedValue(3),
    },
    compensationRecord: { count: jest.fn().mockResolvedValue(2) },
  } as unknown as PrismaService;
}

function makeConnectivity(): jest.Mocked<IProviderConnectivity> {
  return {
    statusFor: jest.fn((key: string) => {
      if (key === 'resend')
        return Promise.resolve({
          status: 'degraded' as const,
          latencyMs: 900,
          observed: true,
        });
      if (key === 'whatsapp')
        return Promise.resolve({
          status: 'down' as const,
          latencyMs: null,
          observed: true,
        });
      if (key === 'anthropic')
        return Promise.resolve({
          status: 'ok' as const,
          latencyMs: null,
          observed: false,
        });
      return Promise.resolve(null);
    }),
  };
}

describe('MetricsOpsReadPrismaRepository.systemHealth', () => {
  it('derives settling providers from the outbox and never consults connectivity for them', async () => {
    const connectivity = makeConnectivity();
    const repo = new MetricsOpsReadPrismaRepository(makePrisma(), connectivity);

    const { providers } = await repo.systemHealth();
    const byKey = Object.fromEntries(providers.map((p) => [p.key, p]));

    expect(byKey.blockradar).toMatchObject({
      status: 'ok',
      lastLatencyMs: 150,
    });
    expect(byKey.flutterwave).toMatchObject({
      status: 'ok',
      lastLatencyMs: 150,
    });
    const consulted = connectivity.statusFor.mock.calls.map((c) => c[0]);
    expect(consulted).not.toContain('blockradar');
    expect(consulted).not.toContain('flutterwave');
  });

  it('overlays observed probe status + latency onto non-settling providers', async () => {
    const repo = new MetricsOpsReadPrismaRepository(
      makePrisma(),
      makeConnectivity(),
    );
    const { providers } = await repo.systemHealth();
    const byKey = Object.fromEntries(providers.map((p) => [p.key, p]));

    expect(byKey.resend).toMatchObject({
      status: 'degraded',
      lastLatencyMs: 900,
    });
    expect(byKey.whatsapp).toMatchObject({
      status: 'down',
      lastLatencyMs: null,
    });
  });

  it('keeps the ok/null placeholder when a non-settling provider is unobserved', async () => {
    const repo = new MetricsOpsReadPrismaRepository(
      makePrisma(),
      makeConnectivity(),
    );
    const { providers } = await repo.systemHealth();
    const anthropic = providers.find((p) => p.key === 'anthropic');

    expect(anthropic).toMatchObject({ status: 'ok', lastLatencyMs: null });
  });

  it('reports the pending queue depth and recon drift from counts', async () => {
    const repo = new MetricsOpsReadPrismaRepository(
      makePrisma(),
      makeConnectivity(),
    );
    const health = await repo.systemHealth();
    expect(health.webhookQueueDepth).toBe(3);
    expect(health.reconDriftCount).toBe(2);
  });
});
